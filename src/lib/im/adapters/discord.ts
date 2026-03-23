/**
 * Discord adapter — Gateway WebSocket (v10).
 * Flow: get gateway URL → connect → IDENTIFY → handle dispatches.
 * All outbound connections, no public endpoint needed.
 */

import { ChannelAdapter } from './base'
import { registerAdapter } from './registry'
import type { ChannelType, IncomingMessage, OutboundMessage, ImPermissionRequest } from '../types'

const DISCORD_API = 'https://discord.com/api/v10'

// Gateway opcodes
const OP_DISPATCH = 0
const OP_HEARTBEAT = 1
const OP_IDENTIFY = 2
const OP_RESUME = 6
const OP_HEARTBEAT_ACK = 11

// Intents
const GUILD_MESSAGES = 1 << 9
const MESSAGE_CONTENT = 1 << 15  // privileged
const DIRECT_MESSAGES = 1 << 12

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export class DiscordAdapter extends ChannelAdapter {
  readonly channelType: ChannelType = 'discord'

  private token = ''
  private ws: WebSocket | null = null
  private running = false
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatInterval = 0
  private lastSequence: number | null = null
  private gatewaySessionId = ''
  private resumeGatewayUrl = ''
  private botUserId = ''

  // Internal message queue
  private messageQueue: IncomingMessage[] = []
  private messageWaiter: ((msg: IncomingMessage | null) => void) | null = null

  // Permission response callback
  private permissionCallback: ((requestId: string, decision: 'allow' | 'deny') => void) | null = null

  // Track permission request originators for sender verification (P30 fix)
  private permissionSenders = new Map<string, string>() // requestId → senderId

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(config: Record<string, string>): Promise<void> {
    if (!config.bot_token) throw new Error('Discord bot_token is required')

    this.token = config.bot_token

    // Get gateway URL
    const gatewayRes = await fetch(`${DISCORD_API}/gateway/bot`, {
      headers: { 'Authorization': `Bot ${this.token}` },
    })
    if (!gatewayRes.ok) throw new Error(`Discord gateway fetch failed: ${gatewayRes.status}`)
    const gatewayData = await gatewayRes.json() as { url: string }

    await this.connectWs(`${gatewayData.url}?v=10&encoding=json`)
    this.running = true
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.ws) {
      this.ws.close(1000, 'Disconnecting')
      this.ws = null
    }

    if (this.messageWaiter) {
      this.messageWaiter(null)
      this.messageWaiter = null
    }
    this.messageQueue = []
  }

  isRunning(): boolean {
    return this.running
  }

  // ---------------------------------------------------------------------------
  // Message consumption (pull model)
  // ---------------------------------------------------------------------------

  async consumeOne(signal: AbortSignal): Promise<IncomingMessage | null> {
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!
    }

    if (signal.aborted) return null

    return new Promise<IncomingMessage | null>((resolve) => {
      let resolved = false

      this.messageWaiter = (msg) => {
        if (resolved) return
        resolved = true
        signal.removeEventListener('abort', onAbort)
        this.messageWaiter = null
        resolve(msg)
      }

      const onAbort = () => {
        if (resolved) return
        resolved = true
        this.messageWaiter = null
        resolve(null)
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  // ---------------------------------------------------------------------------
  // Outbound messaging
  // ---------------------------------------------------------------------------

  async send(msg: OutboundMessage): Promise<string | undefined> {
    if (msg.deleteMessageId) {
      try {
        await this.discordApi('DELETE', `/channels/${msg.chatId}/messages/${msg.deleteMessageId}`, null)
      } catch { /* ignore */ }
      return undefined
    }

    if (msg.editMessageId) {
      try {
        await this.discordApi('PATCH', `/channels/${msg.chatId}/messages/${msg.editMessageId}`, {
          content: msg.text,
        })
        return msg.editMessageId
      } catch {
        // Fall through to send new if edit fails
      }
    }

    const body: Record<string, unknown> = { content: msg.text }
    if (msg.components) body.components = msg.components

    const result = await this.discordApi('POST', `/channels/${msg.chatId}/messages`, body) as { id?: string }
    return result.id
  }

  async sendImage(chatId: string, imageBuffer: Buffer, caption?: string): Promise<void> {
    try {
      const formData = new FormData()
      if (caption) formData.append('payload_json', JSON.stringify({ content: caption }))
      formData.append('files[0]', new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }), 'image.png')

      const res = await fetch(`${DISCORD_API}/channels/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bot ${this.token}` },
        body: formData,
      })
      if (!res.ok) {
        console.warn(`[Discord] sendImage failed (${res.status}), falling back to text`)
        if (caption) await this.send({ chatId, text: `[Image] ${caption}` })
      }
    } catch (err) {
      console.warn('[Discord] sendImage error:', err instanceof Error ? err.message : err)
      if (caption) await this.send({ chatId, text: `[Image] ${caption}` })
    }
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    try {
      await this.discordApi('POST', `/channels/${chatId}/typing`, null)
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Permission UI
  // ---------------------------------------------------------------------------

  async sendPermissionPrompt(req: ImPermissionRequest): Promise<void> {
    // Track who initiated this permission request (P30 fix)
    this.permissionSenders.set(req.requestId, req.senderId)

    const inputSummary = Object.entries(req.toolInput)
      .map(([k, v]) => `${k}: ${String(v).slice(0, 50)}`)
      .join('\n')

    await this.discordApi('POST', `/channels/${req.chatId}/messages`, {
      content: `⚠️ **Permission Required**\n\nTool: \`${req.toolName}\`\n\`\`\`\n${inputSummary}\n\`\`\``,
      components: [{
        type: 1, // ACTION_ROW
        components: [
          {
            type: 2, // BUTTON
            style: 3, // SUCCESS
            label: 'Allow',
            custom_id: `perm:allow:${req.requestId}`,
          },
          {
            type: 2, // BUTTON
            style: 4, // DANGER
            label: 'Deny',
            custom_id: `perm:deny:${req.requestId}`,
          },
        ],
      }],
    })
  }

  onPermissionResponse(callback: (requestId: string, decision: 'allow' | 'deny') => void): void {
    this.permissionCallback = callback
  }

  // ---------------------------------------------------------------------------
  // Config validation
  // ---------------------------------------------------------------------------

  validateConfig(config: Record<string, string>): { valid: boolean; error?: string } {
    if (!config.bot_token) return { valid: false, error: 'bot_token is required' }
    return { valid: true }
  }

  // ---------------------------------------------------------------------------
  // Internal: WebSocket
  // ---------------------------------------------------------------------------

  private connectWs(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('Discord WebSocket connection timeout'))
      }, 15_000)

      ws.addEventListener('open', () => {
        this.ws = ws
      })

      ws.addEventListener('message', (event) => {
        let data: { op: number; d: Record<string, unknown> | null; s: number | null; t: string | null }
        try {
          data = JSON.parse(String(event.data))
        } catch {
          console.warn('[Discord] Failed to parse WebSocket message')
          return
        }

        if (data.s !== null) this.lastSequence = data.s

        switch (data.op) {
          case 10: {
            // HELLO — start heartbeating and identify
            clearTimeout(timeout)
            const d = data.d as { heartbeat_interval: number }
            this.heartbeatInterval = d.heartbeat_interval
            this.startHeartbeat()
            this.identify()
            resolve()
            break
          }
          case OP_HEARTBEAT_ACK:
            break
          case OP_DISPATCH:
            if (data.t && data.d) this.handleDispatch(data.t, data.d)
            break
        }
      })

      ws.addEventListener('close', () => {
        // Clear heartbeat timer to prevent leaks across reconnects
        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer)
          this.heartbeatTimer = null
        }
        if (this.running) {
          console.log('[Discord] WebSocket closed, will be reconnected by Bridge Manager')
        }
        this.running = false
        // Always wake the messageWaiter to prevent deadlock (P8 fix)
        // Without this, a consumeOne() call between stop() and close event would hang forever
        if (this.messageWaiter) {
          this.messageWaiter(null)
          this.messageWaiter = null
        }
      })

      ws.addEventListener('error', (err) => {
        clearTimeout(timeout)
        console.error('[Discord] WebSocket error:', err)
        if (!this.ws) reject(new Error('Discord WebSocket connection failed'))
      })
    })
  }

  private identify(): void {
    this.ws?.send(JSON.stringify({
      op: OP_IDENTIFY,
      d: {
        token: this.token,
        intents: GUILD_MESSAGES | MESSAGE_CONTENT | DIRECT_MESSAGES,
        properties: {
          os: 'darwin',
          browser: 'forge',
          device: 'forge',
        },
      },
    }))
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      this.ws?.send(JSON.stringify({ op: OP_HEARTBEAT, d: this.lastSequence }))
    }, this.heartbeatInterval)
  }

  /** Attempt to resume gateway session (used by Bridge Manager on reconnect). */
  async tryResume(): Promise<boolean> {
    if (!this.resumeGatewayUrl || !this.gatewaySessionId) return false
    try {
      await this.connectWs(`${this.resumeGatewayUrl}?v=10&encoding=json`)
      this.ws?.send(JSON.stringify({
        op: OP_RESUME,
        d: {
          token: this.token,
          session_id: this.gatewaySessionId,
          seq: this.lastSequence,
        },
      }))
      this.running = true
      return true
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Dispatch handler
  // ---------------------------------------------------------------------------

  private handleDispatch(eventType: string, data: Record<string, unknown>): void {
    switch (eventType) {
      case 'READY': {
        const user = data.user as { id: string }
        this.botUserId = user.id
        this.gatewaySessionId = data.session_id as string
        this.resumeGatewayUrl = data.resume_gateway_url as string
        console.log(`[Discord] Ready as ${this.botUserId}`)
        break
      }
      case 'MESSAGE_CREATE':
        this.handleMessage(data)
        break
      case 'INTERACTION_CREATE':
        this.handleInteraction(data)
        break
    }
  }

  private handleMessage(data: Record<string, unknown>): void {
    const author = data.author as { id: string; username: string; bot?: boolean }
    if (author.bot) return

    const content = (data.content as string) || ''
    const attachments = data.attachments as Array<{ url: string; filename: string; content_type?: string; size?: number }> | undefined

    const channelId = data.channel_id as string
    const guildId = data.guild_id as string | undefined
    const isDm = !guildId

    const mentions = data.mentions as Array<{ id: string }> | undefined
    const isGroupMention = !isDm && (mentions?.some(m => m.id === this.botUserId) || false)

    const cleanText = content.replace(new RegExp(`<@!?${this.botUserId}>\\s*`, 'g'), '').trim()

    // No text and no attachments → skip
    if (!cleanText && (!attachments || attachments.length === 0)) return

    // Download attachments
    if (attachments && attachments.length > 0) {
      this.downloadDiscordAttachments(attachments).then(({ images, files }) => {
        const incoming: IncomingMessage = {
          channelType: 'discord', channelId: 'discord', chatId: channelId,
          senderId: author.id, senderName: author.username, text: cleanText, isDm, isGroupMention,
          ...(images.length > 0 ? { images } : {}),
          ...(files.length > 0 ? { files } : {}),
        }
        this.enqueueMessage(incoming)
      }).catch(err => {
        console.error('[Discord] Failed to download attachments:', err)
        // Still process text if download fails
        if (cleanText) {
          this.enqueueMessage({ channelType: 'discord', channelId: 'discord', chatId: channelId, senderId: author.id, senderName: author.username, text: cleanText, isDm, isGroupMention })
        }
      })
      return
    }

    const incoming: IncomingMessage = {
      channelType: 'discord', channelId: 'discord', chatId: channelId,
      senderId: author.id, senderName: author.username, text: cleanText, isDm, isGroupMention,
    }
    this.enqueueMessage(incoming)
  }

  /** Download Discord attachments and classify as images or files */
  private async downloadDiscordAttachments(attachments: Array<{ url: string; filename: string; content_type?: string; size?: number }>): Promise<{
    images: Array<{ data: string; mimeType: string; name: string }>;
    files: Array<{ data: Buffer; name: string; mimeType: string; size: number }>;
  }> {
    const images: Array<{ data: string; mimeType: string; name: string }> = []
    const files: Array<{ data: Buffer; name: string; mimeType: string; size: number }> = []

    for (const att of attachments) {
      if ((att.size || 0) > 20 * 1024 * 1024) continue // Skip > 20MB
      try {
        const res = await fetch(att.url, { signal: AbortSignal.timeout(30_000) })
        if (!res.ok) continue
        const buffer = Buffer.from(await res.arrayBuffer())
        const mime = att.content_type || res.headers.get('content-type') || 'application/octet-stream'

        if (mime.startsWith('image/') && !mime.includes('svg')) {
          images.push({ data: buffer.toString('base64'), mimeType: mime, name: att.filename })
        } else {
          files.push({ data: buffer, name: att.filename, mimeType: mime, size: buffer.length })
        }
      } catch { /* skip failed downloads */ }
    }

    return { images, files }
  }

  private handleInteraction(data: Record<string, unknown>): void {
    const interactionType = data.type as number
    if (interactionType !== 3) return // MESSAGE_COMPONENT only

    const interactionData = data.data as { custom_id?: string } | undefined
    const customId = interactionData?.custom_id
    if (!customId?.startsWith('perm:')) return

    const parts = customId.split(':')
    if (parts.length < 3) return

    const decision = parts[1] as 'allow' | 'deny'
    const requestId = parts.slice(2).join(':')

    // Verify the interaction user is the original message sender (P30 fix)
    const member = data.member as { user?: { id?: string } } | undefined
    const user = data.user as { id?: string } | undefined
    const interactingUserId = member?.user?.id || user?.id || ''
    const expectedSenderId = this.permissionSenders.get(requestId)

    const interactionId = data.id as string
    const interactionToken = data.token as string

    if (expectedSenderId && interactingUserId !== expectedSenderId) {
      // Reject: wrong user clicked the button
      console.log(`[Discord] Permission button clicked by wrong user: expected=${expectedSenderId}, got=${interactingUserId}`)
      fetch(`${DISCORD_API}/interactions/${interactionId}/${interactionToken}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 4, // CHANNEL_MESSAGE_WITH_SOURCE (ephemeral)
          data: { content: '⚠️ Only the original requester can respond to this permission prompt.', flags: 64 },
        }),
      }).catch(() => { /* ignore */ })
      return
    }

    this.permissionSenders.delete(requestId)
    this.permissionCallback?.(requestId, decision)

    // Respond to interaction
    fetch(`${DISCORD_API}/interactions/${interactionId}/${interactionToken}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 7, // UPDATE_MESSAGE
        data: {
          content: decision === 'allow' ? '✅ Permission granted' : '❌ Permission denied',
          components: [],
        },
      }),
    }).catch(() => { /* ignore */ })
  }

  // ---------------------------------------------------------------------------
  // Internal: Message queue
  // ---------------------------------------------------------------------------

  private enqueueMessage(msg: IncomingMessage): void {
    if (this.messageWaiter) {
      const waiter = this.messageWaiter
      this.messageWaiter = null
      waiter(msg)
    } else {
      this.messageQueue.push(msg)
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Discord API
  // ---------------------------------------------------------------------------

  private async discordApi(method: string, path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${DISCORD_API}${path}`, {
      method,
      headers: {
        'Authorization': `Bot ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body !== null ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Discord API ${path} failed: ${res.status} ${text}`)
    }

    if (res.status === 204) return {}
    return res.json() as Promise<Record<string, unknown>>
  }
}

// Self-register
registerAdapter('discord', DiscordAdapter)
