import { getDb } from '@/lib/db'
import crypto from 'crypto'
import fs from 'fs'
import { createForgeQuery } from '@/lib/sdk/client'
import type { ForgeAttachment } from '@/lib/sdk/client'
import path from 'path'
import { getUploadsDir } from '@/lib/forge-data'
import { MessageMapper } from '@/lib/sdk/message-mapper'
import { createPermissionBridge, cleanupStaleSessionAllowances } from '@/lib/sdk/permission-bridge'
import { archiveOldMemories } from '@/lib/workspace-fs'
import { resolveProvider } from '@/lib/provider'
import { runSessionCleanup } from '@/lib/session-cleanup'
import { maybeFlushMemory } from '@/lib/memory-flush'
import { extractFilePaths, resolveFileAttachments, parseMediaProtocol } from '@/lib/im/conversation-engine'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { parseCustomModelId } from '@/lib/models'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let lastArchiveTime = 0

// ── Helpers ────────────────────────────────────────────────────

/** Drain an SDK query into SSE events via a mapper. */
async function drainQuery(
  q: Query,
  mapper: MessageMapper,
  emit: (data: Record<string, unknown>) => void | Promise<void>,
) {
  for await (const msg of q) {
    const events = mapper.mapMessage(msg)
    for (const event of events) {
      await emit(event as Record<string, unknown>)
    }
  }
}

/**
 * Build a prompt that includes recent conversation history as context.
 * Used as fallback when SDK session resume fails.
 */
function buildPromptWithHistory(
  newMessage: string,
  recentMessages: Array<{ role: string; content: string }>,
): string {
  if (recentMessages.length === 0) return newMessage

  const history = recentMessages
    .slice(-20) // Last 20 messages for context
    .map((m) => {
      const role = m.role === 'user' ? 'Human' : 'Assistant'
      // For assistant messages stored as JSON blocks, summarize
      let content = m.content
      if (content.startsWith('[{') || content.startsWith('[')) {
        try {
          const blocks = JSON.parse(content)
          content = blocks
            .filter((b: Record<string, unknown>) => b.type === 'text' && b.text)
            .map((b: Record<string, unknown>) => b.text)
            .join(' ')
          if (!content) content = '[tool usage]'
        } catch {
          content = content.slice(0, 200)
        }
      }
      return `${role}: ${content}`
    })
    .join('\n\n')

  return `<conversation_history>\n${history}\n</conversation_history>\n\n${newMessage}`
}

/**
 * Build messages array for custom provider direct HTTP calls.
 * Includes conversation history from DB for multi-turn context.
 */
function buildMessagesForCustomProvider(
  newMessage: string,
  recentMessages: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = []

  for (const m of recentMessages.slice(-20)) {
    let content = m.content
    // For assistant messages stored as JSON blocks, extract text
    if (content.startsWith('[{') || content.startsWith('[')) {
      try {
        const blocks = JSON.parse(content)
        content = blocks
          .filter((b: Record<string, unknown>) => b.type === 'text' && b.text)
          .map((b: Record<string, unknown>) => b.text)
          .join('\n')
        if (!content) content = '[tool usage]'
      } catch {
        content = content.slice(0, 500)
      }
    }
    messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content })
  }

  messages.push({ role: 'user', content: newMessage })
  return messages
}

/**
 * Direct HTTP streaming call to custom provider (Anthropic-compatible or OpenAI-compatible).
 * Bypasses Claude Code CLI entirely — no model name validation, no subprocess.
 *
 * Emits SSE events compatible with the frontend use-chat.ts handler:
 *   { type: 'text_delta', text: '...' }
 *   { type: 'done', messageId, userMessageId, inputTokens, outputTokens }
 *   { type: 'error', error: '...' }
 */
async function streamCustomProvider(opts: {
  protocol: 'anthropic-compatible' | 'openai-compatible'
  baseUrl: string
  apiKey: string
  modelName: string
  messages: Array<{ role: string; content: string }>
  abortSignal: AbortSignal
  emit: (data: Record<string, unknown>) => Promise<void>
}): Promise<{ inputTokens: number; outputTokens: number; fullText: string }> {
  const { protocol, baseUrl, apiKey, modelName, messages, abortSignal, emit } = opts
  const cleanBase = baseUrl.replace(/\/+$/, '')

  let inputTokens = 0
  let outputTokens = 0
  let fullText = ''

  if (protocol === 'anthropic-compatible') {
    // Build URL: strip trailing /v1 or /v1/messages, then append /v1/messages
    const url = cleanBase.includes('/v1/messages')
      ? cleanBase
      : `${cleanBase.replace(/\/v1$/, '')}/v1/messages`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 8096,
        stream: true,
        messages,
      }),
      signal: abortSignal,
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      let errMsg = `HTTP ${res.status}`
      try {
        const parsed = JSON.parse(errBody)
        errMsg = parsed?.error?.message || errMsg
      } catch { /* ignore */ }
      throw new Error(errMsg)
    }

    // Parse Anthropic SSE stream
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const event = JSON.parse(data)
          // content_block_delta: text delta
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const text = event.delta.text || ''
            if (text) {
              fullText += text
              await emit({ type: 'text_delta', text })
            }
          }
          // message_delta: usage info
          if (event.type === 'message_delta' && event.usage) {
            outputTokens = event.usage.output_tokens || 0
          }
          // message_start: input usage
          if (event.type === 'message_start' && event.message?.usage) {
            inputTokens = event.message.usage.input_tokens || 0
          }
        } catch { /* skip malformed lines */ }
      }
    }

  } else {
    // OpenAI-compatible: /chat/completions
    const url = cleanBase.includes('/chat/completions')
      ? cleanBase
      : `${cleanBase}/chat/completions`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 8096,
        stream: true,
        messages,
      }),
      signal: abortSignal,
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      let errMsg = `HTTP ${res.status}`
      try {
        const parsed = JSON.parse(errBody)
        errMsg = parsed?.error?.message || errMsg
      } catch { /* ignore */ }
      throw new Error(errMsg)
    }

    // Parse OpenAI SSE stream
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const event = JSON.parse(data)
          const delta = event.choices?.[0]?.delta
          if (delta?.content) {
            fullText += delta.content
            await emit({ type: 'text_delta', text: delta.content })
          }
          // Usage (some providers include in last chunk)
          if (event.usage) {
            inputTokens = event.usage.prompt_tokens || 0
            outputTokens = event.usage.completion_tokens || 0
          }
        } catch { /* skip malformed lines */ }
      }
    }
  }

  return { inputTokens, outputTokens, fullText }
}

export async function POST(req: Request) {
  let body: { sessionId?: string; message?: string; permissionMode?: string; thinkingMode?: string; attachments?: Array<{ name: string; filename: string; mimeType: string; tier: string }> }
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const { sessionId, message } = body

  // Map raw attachment data to typed ForgeAttachment[]
  // Reconstruct serverPath from filename (never trust absolute paths from client)
  const uploadsDir = getUploadsDir()
  const attachments: ForgeAttachment[] = (body.attachments || []).map(a => {
    const safeFilename = a.filename.replace(/\.\./g, '').replace(/[/\\]/g, '_') // sanitize: strip path traversal + slashes, preserve dots in extensions
    return {
      name: a.name,
      serverPath: path.join(uploadsDir, safeFilename),
      mimeType: a.mimeType,
      tier: a.tier as ForgeAttachment['tier'],
    }
  })
  if (!sessionId || (!message && attachments.length === 0)) return jsonError('sessionId and message (or attachments) required', 400)

  const db = getDb()

  // Get session
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as {
    id: string; model: string; workspace: string
  } | undefined
  if (!session) return jsonError('Session not found', 404)

  // Permission mode: per-session override from request body takes priority over global Settings
  const permModeSetting = db.prepare("SELECT value FROM settings WHERE key = 'desktop_permission_mode'").get() as { value: string } | undefined
  const permissionMode = body.permissionMode || permModeSetting?.value || 'confirm'

  // Resolve provider type for thinking mode mapping
  const resolved = resolveProvider(session.model)
  const providerType = resolved.provider

  // Get thinking mode: per-request override > provider-specific setting > global default
  const providerThinkingKey = `thinking_mode_${providerType}`
  const providerThinkingSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get(providerThinkingKey) as { value: string } | undefined
  const globalThinkingSetting = db.prepare("SELECT value FROM settings WHERE key = 'thinking_mode'").get() as { value: string } | undefined
  const thinkingMode = body.thinkingMode || providerThinkingSetting?.value || globalThinkingSetting?.value || 'auto'

  // Check if this session already has messages (for resume)
  const existingMsgCount = (db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?').get(sessionId) as { count: number }).count

  // Resolve effective message: if empty but has attachments, use file names
  const effectiveMessage = message || (attachments.length > 0
    ? attachments.map(a => `[${a.name}]`).join(' ')
    : '')

  // Save user message
  const userMsgId = crypto.randomUUID()
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
    userMsgId, sessionId, 'user', effectiveMessage
  )

  // Archive old daily memories (throttled: max once per hour)
  const now = Date.now()
  if (now - lastArchiveTime > 3600_000) {
    lastArchiveTime = now
    const retentionSetting = db.prepare("SELECT value FROM settings WHERE key = 'memory_retention_days'").get() as { value: string } | undefined
    const retentionDays = parseInt(retentionSetting?.value || '7', 10)
    archiveOldMemories(session.workspace, retentionDays)
  }

  // Auto-clean old sessions (throttled shared function) + stale permission allowances
  runSessionCleanup()
  cleanupStaleSessionAllowances()

  const encoder = new TextEncoder()
  const abortController = new AbortController()

  // Use TransformStream for immediate chunk flushing — ReadableStream's async start()
  // can cause Next.js to buffer the entire response before sending.
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()

  const emit = async (data: Record<string, unknown>) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
    } catch { /* writer closed (client disconnected) */ }
  }

  // Run the stream processing in the background — Response is returned immediately
  ;(async () => {
    // ── Custom Provider Direct HTTP Mode ──────────────────────────────────────
    // When using a custom provider (e.g. relay station), bypass Claude Code CLI entirely.
    // Claude Code CLI validates model names against Anthropic's official list and rejects
    // custom model names like "claude-sonnet-4-6". Direct HTTP avoids this validation.
    const isCustomProvider = resolved.provider === 'custom' && resolved.apiKey && resolved.baseUrl
    const customModelParsed = isCustomProvider ? parseCustomModelId(session.model) : null
    const customModelName = customModelParsed?.modelName || session.model

    if (isCustomProvider) {
      try {
        // Load conversation history for multi-turn context
        const recentMsgs = db
          .prepare('SELECT role, content FROM messages WHERE session_id = ? AND id != ? ORDER BY created_at ASC')
          .all(sessionId, userMsgId) as Array<{ role: string; content: string }>

        const messages = buildMessagesForCustomProvider(effectiveMessage, recentMsgs)
        const protocol = resolved.protocol || 'anthropic-compatible'

        console.log(`[forge-chat] Custom provider direct mode: ${protocol}, model=${customModelName}, baseUrl=${resolved.baseUrl}`)

        const { inputTokens, outputTokens, fullText } = await streamCustomProvider({
          protocol,
          baseUrl: resolved.baseUrl!,
          apiKey: resolved.apiKey,
          modelName: customModelName,
          messages,
          abortSignal: abortController.signal,
          emit,
        })

        // Build blocks from full text
        const blocks: Record<string, unknown>[] = fullText
          ? [{ type: 'text', text: fullText }]
          : []

        // Save assistant message to SQLite
        const assistantMsgId = crypto.randomUUID()
        db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
          assistantMsgId, sessionId, 'assistant', JSON.stringify(blocks)
        )

        // Update session title
        const msgCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?').get(sessionId) as { count: number }
        if (msgCount.count <= 2) {
          const title = effectiveMessage.length > 50 ? effectiveMessage.slice(0, 47) + '...' : effectiveMessage
          db.prepare("UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, sessionId)
        } else {
          db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId)
        }

        await emit({
          type: 'done',
          messageId: assistantMsgId,
          userMessageId: userMsgId,
          inputTokens,
          outputTokens,
        })

        // Background memory flush
        maybeFlushMemory(sessionId, session.workspace, session.model, effectiveMessage, fullText.slice(0, 200))
      } catch (err) {
        db.prepare('DELETE FROM messages WHERE id = ?').run(userMsgId)
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        console.error('[forge-chat] Custom provider error:', errorMessage)
        await emit({ type: 'error', error: errorMessage })
      } finally {
        try { await writer.close() } catch { /* already closed */ }
      }
      return
    }

    // ── Standard Claude Code CLI Mode ─────────────────────────────────────────
    let mapper = new MessageMapper()

    try {
      // Create permission bridge (only for 'confirm' mode)
      const canUseTool = permissionMode === 'confirm'
        ? createPermissionBridge(sessionId, emit as (data: Record<string, unknown>) => void)
        : undefined

      const isResume = existingMsgCount > 0

      const q = createForgeQuery({
        prompt: effectiveMessage,
        sessionId,
        model: session.model,
        workspaceId: session.workspace,
        abortController,
        canUseTool,
        bypassPermissions: permissionMode === 'full',
        resumeSession: isResume,
        thinkingMode,
        providerType,
        attachments: attachments.length > 0 ? attachments : undefined,
      })

      // Consume SDK message stream, with resume failure recovery.
      // Two fallback triggers:
      //   A) drainQuery throws (exception path)
      //   B) drainQuery completes but produced zero blocks (silent error path —
      //      SDK returned an error result like "Session ID already in use"
      //      without throwing an exception)
      let needsFallback = false
      try {
        await drainQuery(q, mapper, emit)
        // Silent failure check: resume completed but SDK returned error result only
        if (isResume && mapper.getBlocks().length === 0) {
          needsFallback = true
          console.warn('[forge-chat] Resume produced zero blocks (likely SDK error result), will retry with fresh session')
        }
      } catch (queryErr) {
        const isResumeFailure = isResume && mapper.getBlocks().length === 0
        if (!isResumeFailure) throw queryErr
        needsFallback = true
        const errMsg = queryErr instanceof Error ? queryErr.message : String(queryErr)
        console.warn(`[forge-chat] Resume threw error, will retry with fresh session:`, errMsg)
      }

      if (needsFallback) {
        // Load recent conversation history from DB (excluding the message we just inserted)
        const recentMsgs = db
          .prepare(
            'SELECT role, content FROM messages WHERE session_id = ? AND id != ? ORDER BY created_at ASC',
          )
          .all(sessionId, userMsgId) as Array<{ role: string; content: string }>

        const historyPrompt = buildPromptWithHistory(effectiveMessage, recentMsgs)

        // Reset mapper for the retry
        mapper = new MessageMapper()

        // Use a fresh UUID to avoid SDK session lock conflicts
        // (the original sessionId may still be locked by a stale process)
        const retryQ = createForgeQuery({
          prompt: historyPrompt,
          sessionId: crypto.randomUUID(),
          model: session.model,
          workspaceId: session.workspace,
          abortController,
          canUseTool,
          bypassPermissions: permissionMode === 'full',
          resumeSession: false,
          thinkingMode,
          providerType,
        })

        await drainQuery(retryQ, mapper, emit)
      }

      // Detect file/image attachments from two sources:
      // 1. MEDIA: protocol lines in text blocks (explicit, preferred)
      // 2. Tool use heuristics (fallback)
      const blocks = mapper.getBlocks()

      // Parse MEDIA: lines from text blocks and strip them from displayed text
      const mediaPaths: string[] = []
      for (const block of blocks) {
        if ((block as Record<string, unknown>).type === 'text') {
          const b = block as { type: string; text: string }
          const parsed = parseMediaProtocol(b.text)
          mediaPaths.push(...parsed.mediaPaths)
          b.text = parsed.text // Strip MEDIA: lines from stored text
        }
      }

      // Merge MEDIA: paths with heuristic-detected paths, dedup
      const mediaAttachments = resolveFileAttachments(mediaPaths)
      const heuristicAttachments = resolveFileAttachments(extractFilePaths(blocks as Record<string, unknown>[]))
      const seenPaths = new Set(mediaAttachments.map(a => a.filePath))
      const detectedFiles = [...mediaAttachments, ...heuristicAttachments.filter(a => !seenPaths.has(a.filePath))]

      const uploadsDir = getUploadsDir()
      for (const att of detectedFiles) {
        try {
          // Copy to uploads dir so it's accessible via /api/upload/
          const destName = `agent_${Date.now()}_${att.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
          const destPath = path.join(uploadsDir, destName)
          fs.copyFileSync(att.filePath, destPath)
          if (att.isImage) {
            blocks.push({ type: 'image_attachment', url: `/api/upload/${destName}`, name: att.name })
          } else {
            blocks.push({ type: 'file_attachment', url: `/api/upload/${destName}`, name: att.name, size: att.size, mimeType: att.mimeType })
          }
          // Emit SSE event so frontend renders immediately
          await emit({ type: 'attachment', attachment: att.isImage
            ? { type: 'image_attachment', url: `/api/upload/${destName}`, name: att.name }
            : { type: 'file_attachment', url: `/api/upload/${destName}`, name: att.name, size: att.size, mimeType: att.mimeType }
          })
        } catch { /* skip unreadable files */ }
      }

      // Save assistant message to SQLite (dual persistence)
      const assistantMsgId = crypto.randomUUID()
      db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
        assistantMsgId, sessionId, 'assistant', JSON.stringify(blocks)
      )

      // Update session title
      const msgCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?').get(sessionId) as { count: number }
      if (msgCount.count <= 2) {
        const title = effectiveMessage.length > 50 ? effectiveMessage.slice(0, 47) + '...' : effectiveMessage
        db.prepare("UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, sessionId)
      } else {
        db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId)
      }

      await emit({
        type: 'done',
        messageId: assistantMsgId,
        userMessageId: userMsgId,
        inputTokens: mapper.inputTokens,
        outputTokens: mapper.outputTokens,
      })

      // Background memory flush — remind Agent to write memory if needed (every N messages)
      // Fire-and-forget: user doesn't wait for this
      const assistantText = blocks.filter((b: Record<string, unknown>) => b.type === 'text').map((b: Record<string, unknown>) => b.text).join(' ')
      maybeFlushMemory(sessionId, session.workspace, session.model, effectiveMessage, assistantText.slice(0, 200))
    } catch (err) {
      // Save partial response if any blocks were generated
      const blocks = mapper.getBlocks()
      if (blocks.length > 0) {
        const assistantMsgId = crypto.randomUUID()
        db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
          assistantMsgId, sessionId, 'assistant', JSON.stringify(blocks)
        )
      } else {
        db.prepare('DELETE FROM messages WHERE id = ?').run(userMsgId)
      }

      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      await emit({ type: 'error', error: errorMessage })
    } finally {
      try { await writer.close() } catch { /* already closed */ }
    }
  })()

  // Handle client disconnect
  req.signal.addEventListener('abort', () => {
    abortController.abort()
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function jsonError(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
