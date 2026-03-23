/**
 * Telegram adapter — long polling via getUpdates.
 * All outbound connections, no public endpoint needed.
 */

import { ChannelAdapter } from './base'
import { registerAdapter } from './registry'
import type { ChannelType, IncomingMessage, OutboundMessage, ImPermissionRequest } from '../types'

const API_BASE = 'https://api.telegram.org/bot'

// ---------------------------------------------------------------------------
// Telegram API types
// ---------------------------------------------------------------------------

interface TgUpdate {
  update_id: number
  message?: {
    message_id: number
    from?: { id: number; first_name?: string; username?: string }
    chat: { id: number; type: string }
    text?: string
    caption?: string
    entities?: { type: string; offset: number; length: number }[]
    photo?: { file_id: string; file_size?: number; width?: number; height?: number }[]
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
    video?: unknown
    voice?: unknown
    sticker?: unknown
    audio?: unknown
  }
  callback_query?: {
    id: string
    from: { id: number }
    message?: { chat: { id: number }; message_id: number }
    data?: string
  }
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export class TelegramAdapter extends ChannelAdapter {
  readonly channelType: ChannelType = 'telegram'

  private token = ''
  private running = false
  private offset = 0
  private botUsername = ''

  // Internal message queue: pollLoop fills, consumeOne drains
  private messageQueue: IncomingMessage[] = []
  private messageWaiter: ((msg: IncomingMessage | null) => void) | null = null

  // Permission response callback (set by Bridge Manager)
  private permissionCallback: ((requestId: string, decision: 'allow' | 'deny') => void) | null = null

  // Polling internals
  private pollAbortController: AbortController | null = null

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(config: Record<string, string>): Promise<void> {
    const token = config.bot_token
    if (!token) throw new Error('Telegram bot_token is required')

    this.token = token

    // Verify token
    const me = await this.apiCall('getMe') as { result?: { username?: string } }
    this.botUsername = me.result?.username || ''

    this.running = true
    this.pollAbortController = new AbortController()

    // Start background polling loop (fills message queue)
    this.pollLoop()
  }

  async stop(): Promise<void> {
    this.running = false
    this.pollAbortController?.abort()
    this.pollAbortController = null

    // Drain waiters
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
        await this.apiCall('deleteMessage', {
          chat_id: msg.chatId,
          message_id: parseInt(msg.deleteMessageId, 10),
        })
      } catch { /* ignore delete errors */ }
      return undefined
    }

    if (msg.editMessageId) {
      const msgId = parseInt(msg.editMessageId, 10)
      try {
        await this.apiCall('editMessageText', {
          chat_id: msg.chatId,
          message_id: msgId,
          text: msg.text || '...',
          parse_mode: msg.parseMode === 'plain' ? undefined : 'Markdown',
        })
        return msg.editMessageId
      } catch {
        // Markdown parse error — retry as plain text before falling through
        try {
          await this.apiCall('editMessageText', {
            chat_id: msg.chatId,
            message_id: msgId,
            text: msg.text || '...',
          })
          return msg.editMessageId
        } catch {
          // Both failed (e.g. "message is not modified") — fall through to new send
        }
      }
    }

    const result = await this.apiCall('sendMessage', {
      chat_id: msg.chatId,
      text: msg.text,
      parse_mode: msg.parseMode === 'plain' ? undefined : 'Markdown',
      reply_to_message_id: msg.replyToMessageId ? parseInt(msg.replyToMessageId, 10) : undefined,
    }) as { result?: { message_id?: number } }

    return result.result?.message_id?.toString()
  }

  async sendImage(chatId: string, imageBuffer: Buffer, caption?: string): Promise<void> {
    const formData = new FormData()
    formData.append('chat_id', chatId)
    formData.append('photo', new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }), 'image.png')
    if (caption) formData.append('caption', caption)

    const res = await fetch(`${API_BASE}${this.token}/sendPhoto`, {
      method: 'POST',
      body: formData,
    })
    if (!res.ok) {
      // Fallback: send as text if photo upload fails
      console.warn(`[Telegram] sendPhoto failed (${res.status}), falling back to text`)
      if (caption) await this.send({ chatId, text: `[Image] ${caption}` })
    }
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    try {
      await this.apiCall('sendChatAction', { chat_id: chatId, action: 'typing' })
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Permission UI
  // ---------------------------------------------------------------------------

  async sendPermissionPrompt(req: ImPermissionRequest): Promise<void> {
    const inputSummary = Object.entries(req.toolInput)
      .map(([k, v]) => `${k}: ${String(v).slice(0, 50)}`)
      .join('\n')

    await this.apiCall('sendMessage', {
      chat_id: req.chatId,
      text: `⚠️ *Permission Required*\n\nTool: \`${req.toolName}\`\n${inputSummary}\n\nAllow this action?`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Allow', callback_data: `perm:allow:${req.requestId}` },
          { text: '❌ Deny', callback_data: `perm:deny:${req.requestId}` },
        ]],
      },
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
  // Internal: Telegram API
  // ---------------------------------------------------------------------------

  private async apiCall(method: string, body?: Record<string, unknown>, usePollSignal = false): Promise<Record<string, unknown>> {
    const url = `${API_BASE}${this.token}/${method}`
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      // Only use the poll abort signal for polling requests (getUpdates).
      // Outbound send/edit/delete calls must NOT be aborted when the poll loop stops.
      signal: usePollSignal ? this.pollAbortController?.signal : undefined,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Telegram API ${method} failed: ${res.status} ${text}`)
    }

    return res.json() as Promise<Record<string, unknown>>
  }

  // ---------------------------------------------------------------------------
  // Internal: Polling loop
  // ---------------------------------------------------------------------------

  private async pollLoop(): Promise<void> {
    let consecutiveErrors = 0
    while (this.running) {
      try {
        const data = await this.apiCall('getUpdates', {
          offset: this.offset,
          timeout: 30,
          allowed_updates: ['message', 'callback_query'],
        }, true) as { result?: TgUpdate[] }

        consecutiveErrors = 0 // Reset on success
        const updates = data.result || []
        for (const update of updates) {
          this.offset = update.update_id + 1
          this.processUpdate(update)
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') break
        consecutiveErrors++
        // Exponential backoff: 2s, 4s, 8s, 16s, max 60s (P10 fix)
        const delay = Math.min(2000 * Math.pow(2, consecutiveErrors - 1), 60_000)
        console.error(`[Telegram] Poll error (attempt ${consecutiveErrors}, retry in ${delay}ms):`, err)
        // Too many consecutive errors — mark as disconnected for Bridge Manager reconnection
        if (consecutiveErrors >= 5) {
          console.error(`[Telegram] Too many consecutive poll errors, stopping adapter`)
          this.running = false
          if (this.messageWaiter) {
            this.messageWaiter(null)
            this.messageWaiter = null
          }
          break
        }
        await sleep(delay)
      }
    }
  }

  private processUpdate(update: TgUpdate): void {
    // Handle permission callback query
    if (update.callback_query) {
      this.handleCallbackQuery(update.callback_query)
      return
    }

    const msg = update.message
    if (!msg?.from) return

    const isDm = msg.chat.type === 'private'
    const chatId = String(msg.chat.id)
    const senderId = String(msg.from.id)
    const senderName = msg.from.first_name || msg.from.username || 'Unknown'

    // Unsupported message types → reply with hint
    if (msg.video || msg.voice || msg.sticker || msg.audio) {
      this.apiCall('sendMessage', { chat_id: chatId, text: '⚠️ This message type is not supported yet. Please send text, images, or files.' }).catch(() => {})
      return
    }

    // Photo message
    if (msg.photo && msg.photo.length > 0) {
      const bestPhoto = msg.photo[msg.photo.length - 1] // Largest size
      this.downloadTelegramFile(bestPhoto.file_id).then(({ data, mimeType }) => {
        const isGroupMention = !isDm && (msg.caption ? this.isBotMentioned(msg) : true) // Photos in groups without caption: treat as mention
        const incoming: IncomingMessage = {
          channelType: 'telegram', channelId: 'telegram', chatId, senderId, senderName,
          text: msg.caption ? this.stripBotMention(msg.caption) : '',
          isDm, isGroupMention,
          images: [{ data: data.toString('base64'), mimeType, name: 'photo.jpg' }],
        }
        this.enqueueMessage(incoming)
      }).catch(err => console.error('[Telegram] Failed to download photo:', err))
      return
    }

    // Document/file message
    if (msg.document) {
      this.downloadTelegramFile(msg.document.file_id).then(({ data, mimeType }) => {
        const isGroupMention = !isDm && (msg.caption ? this.isBotMentioned(msg) : true)
        const incoming: IncomingMessage = {
          channelType: 'telegram', channelId: 'telegram', chatId, senderId, senderName,
          text: msg.caption ? this.stripBotMention(msg.caption) : '',
          isDm, isGroupMention,
          files: [{ data, name: msg.document!.file_name || 'file', mimeType: mimeType || msg.document!.mime_type || 'application/octet-stream', size: msg.document!.file_size || data.length }],
        }
        this.enqueueMessage(incoming)
      }).catch(err => console.error('[Telegram] Failed to download document:', err))
      return
    }

    // Text message
    if (!msg.text) return

    const isGroupMention = !isDm && this.isBotMentioned(msg)

    const incoming: IncomingMessage = {
      channelType: 'telegram', channelId: 'telegram', chatId, senderId, senderName,
      text: this.stripBotMention(msg.text), isDm, isGroupMention,
    }
    this.enqueueMessage(incoming)
  }

  /** Download a file from Telegram servers */
  private async downloadTelegramFile(fileId: string): Promise<{ data: Buffer; mimeType: string }> {
    const fileInfo = await this.apiCall('getFile', { file_id: fileId }) as { result?: { file_path?: string } }
    const filePath = fileInfo.result?.file_path
    if (!filePath) throw new Error('No file_path in getFile response')

    const url = `https://api.telegram.org/file/bot${this.token}/${filePath}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Download failed: ${res.status}`)

    const buffer = Buffer.from(await res.arrayBuffer())
    const mimeType = res.headers.get('content-type') || 'application/octet-stream'
    return { data: buffer, mimeType }
  }

  private handleCallbackQuery(cb: NonNullable<TgUpdate['callback_query']>): void {
    if (!cb.data?.startsWith('perm:')) return

    const parts = cb.data.split(':')
    if (parts.length < 3) return

    const decision = parts[1] as 'allow' | 'deny'
    const requestId = parts.slice(2).join(':')

    // Forward to permission broker via callback
    this.permissionCallback?.(requestId, decision)

    // Answer the callback to remove loading state
    this.apiCall('answerCallbackQuery', {
      callback_query_id: cb.id,
      text: decision === 'allow' ? 'Allowed' : 'Denied',
    }).catch(() => { /* ignore */ })

    // Edit the permission message to show result
    if (cb.message) {
      this.apiCall('editMessageText', {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: decision === 'allow' ? '✅ Permission granted' : '❌ Permission denied',
      }).catch(() => { /* ignore */ })
    }
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
  // Internal: Mention handling
  // ---------------------------------------------------------------------------

  private isBotMentioned(msg: NonNullable<TgUpdate['message']>): boolean {
    if (!msg.entities || !msg.text) return false
    return msg.entities.some(e => {
      if (e.type !== 'mention') return false
      const mention = msg.text!.slice(e.offset, e.offset + e.length)
      return mention === `@${this.botUsername}`
    })
  }

  private stripBotMention(text: string): string {
    if (!this.botUsername) return text
    return text.replace(new RegExp(`@${this.botUsername}\\s*`, 'g'), '').trim()
  }
}

// Self-register
registerAdapter('telegram', TelegramAdapter)

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
