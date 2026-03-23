'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { Message, ContentBlock, AgentSubBlock } from '@/lib/types'

interface DbMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

function parseBlocks(content: string): ContentBlock[] {
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) return parsed
  } catch { /* plain text */ }
  return [{ type: 'text', text: content }]
}

function mapMessage(row: DbMessage): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    blocks: parseBlocks(row.content),
    createdAt: row.created_at,
  }
}

/** Cache entry for sessions with active streams */
interface StreamCacheEntry {
  messages: Message[]
}

export function useChat(sessionId: string | null) {
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // ── Session state caching: preserve streaming state across session switches ──
  // Streams run in the background; this cache keeps their accumulated messages
  // so switching back to a streaming session restores the latest progress.
  const streamCacheRef = useRef<Map<string, StreamCacheEntry>>(new Map())
  const streamingForSessionRef = useRef<string | null>(null)
  const currentSessionRef = useRef<string | null>(null)

  useEffect(() => { currentSessionRef.current = sessionId }, [sessionId])

  const loadMessages = useCallback(async (sid: string) => {
    // If this session has cached streaming state, restore it
    const cached = streamCacheRef.current.get(sid)
    if (cached) {
      setMessages(cached.messages)
      setStreaming(true)
      setError(null)
      return
    }
    // Load from DB
    try {
      const res = await fetch(`/api/sessions/${sid}/messages`)
      const data = (await res.json()) as DbMessage[]
      setMessages(data.map(mapMessage))
      setStreaming(false)
      setError(null)
    } catch (err) {
      console.error('Failed to load messages:', err)
    }
  }, [])

  const sendMessage = useCallback(async (content: string, permissionMode?: string, thinkingMode?: string, attachments?: Array<{ name: string; filename: string; mimeType: string; tier: string }>) => {
    if (!sessionId || (!content.trim() && (!attachments || attachments.length === 0))) return
    // Block only if THIS session is already streaming (allows other sessions to stream)
    if (streamingForSessionRef.current === sessionId) return

    const streamSessionId = sessionId
    streamingForSessionRef.current = streamSessionId

    setError(null)

    // Clean up orphaned temp messages from previously interrupted streams.
    // Empty temp assistant messages are removed; non-empty ones get stable IDs.
    setMessages((prev) => {
      const hasOrphans = prev.some((m) => m.id.startsWith('temp-'))
      if (!hasOrphans) return prev
      return prev.reduce<Message[]>((acc, m) => {
        if (m.id.startsWith('temp-')) {
          if (m.blocks.length > 0) {
            acc.push({ ...m, id: `orphan-${Date.now()}-${acc.length}` })
          }
          // Drop empty temp messages entirely
        } else {
          acc.push(m)
        }
        return acc
      }, [])
    })

    // Build user message blocks (text + attachment blocks for display)
    const userBlocks: ContentBlock[] = []
    if (content.trim()) {
      userBlocks.push({ type: 'text', text: content.trim() })
    }
    if (attachments && attachments.length > 0) {
      for (const a of attachments) {
        if (a.tier === 'image') {
          userBlocks.push({ type: 'image_attachment', url: `/api/upload/${a.filename}`, name: a.name })
        } else {
          userBlocks.push({ type: 'file_attachment', url: `/api/upload/${a.filename}`, name: a.name, size: 0, mimeType: a.mimeType })
        }
      }
    }
    if (userBlocks.length === 0) {
      userBlocks.push({ type: 'text', text: content.trim() })
    }

    // Optimistically add user message
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      sessionId,
      role: 'user',
      content: content.trim(),
      blocks: userBlocks,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMsg])

    // Add placeholder assistant message with empty blocks
    const tempAssistantId = `temp-assistant-${Date.now()}`
    const tempAssistantMsg: Message = {
      id: tempAssistantId,
      sessionId,
      role: 'assistant',
      content: '',
      blocks: [],
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempAssistantMsg])

    setStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller

    // Initialize stream cache with a snapshot of current messages.
    // This ensures the cache has the right base for updates even when user switches away.
    setMessages((prev) => {
      streamCacheRef.current.set(streamSessionId, {
        messages: prev,
      })
      return prev // No actual state change
    })

    // ── Helpers: update both React state AND stream cache ──
    // When user switches to another session, setMessages updates are no-ops
    // (tempAssistantId not found in the other session's messages), but the
    // cache always gets updated so we can restore when user switches back.

    const updateMessages = (updater: (prev: Message[]) => Message[]) => {
      setMessages(updater)
      const cache = streamCacheRef.current.get(streamSessionId)
      if (cache) {
        cache.messages = updater(cache.messages)
      }
    }

    // ── Turn-level timing ──
    // Timer starts when the first SSE chunk arrives (not at sendMessage call),
    // matching the Spec: "流的第一个 chunk 到达时启动"
    let turnStartTime = 0
    let turnTimer: ReturnType<typeof setInterval> | null = null
    const startTurnTimer = () => {
      if (turnTimer) return // Already started
      turnStartTime = Date.now()
      turnTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - turnStartTime) / 1000)
        updateMessages((prev) =>
          prev.map((m) => m.id === tempAssistantId ? { ...m, elapsedSeconds: elapsed } : m)
        )
      }, 1000)
    }

    // Track which text block we're appending to
    let currentTextBlockIdx = -1
    // Track which thinking block we're appending to
    let currentThinkingBlockIdx = -1

    // ── Smooth streaming: accumulate text deltas, flush at 60fps ──
    let pendingText = ''
    let pendingThinking = ''
    let pendingRaf: number | null = null

    const flushPendingText = () => {
      if (!pendingText && !pendingThinking) return
      const text = pendingText
      const thinking = pendingThinking
      pendingText = ''
      pendingThinking = ''
      if (pendingRaf !== null) {
        cancelAnimationFrame(pendingRaf)
        pendingRaf = null
      }
      updateMessages((prev) =>
        prev.map((m) => {
          if (m.id !== tempAssistantId) return m
          const blocks = [...m.blocks]
          // Flush thinking text
          if (thinking) {
            if (currentThinkingBlockIdx < 0 || blocks[currentThinkingBlockIdx]?.type !== 'thinking') {
              blocks.push({ type: 'thinking', text: '' })
              currentThinkingBlockIdx = blocks.length - 1
            }
            const tBlock = blocks[currentThinkingBlockIdx]
            if (tBlock.type === 'thinking') {
              blocks[currentThinkingBlockIdx] = { ...tBlock, text: tBlock.text + thinking }
            }
          }
          // Flush regular text
          if (text) {
            if (currentTextBlockIdx < 0 || blocks[currentTextBlockIdx]?.type !== 'text') {
              blocks.push({ type: 'text', text: '' })
              currentTextBlockIdx = blocks.length - 1
            }
            const block = blocks[currentTextBlockIdx]
            if (block.type === 'text') {
              blocks[currentTextBlockIdx] = { ...block, text: block.text + text }
            }
          }
          return { ...m, blocks }
        })
      )
    }

    // ── Per-agent text accumulation for sub-agent streaming ──
    // Keyed by parent_tool_use_id. Each entry tracks pending text/thinking deltas
    // and the index of the current text/thinking sub-block within that agent's blocks.
    const agentPending = new Map<string, {
      pendingText: string
      pendingThinking: string
      currentTextIdx: number
      currentThinkingIdx: number
    }>()

    const flushAgentText = () => {
      for (const [parentId, state] of agentPending) {
        if (!state.pendingText && !state.pendingThinking) continue
        const text = state.pendingText
        const thinking = state.pendingThinking
        state.pendingText = ''
        state.pendingThinking = ''

        updateMessages((prev) =>
          prev.map((m) => {
            if (m.id !== tempAssistantId) return m
            const blocks = [...m.blocks]
            // Find or create the agent_content block for this parent
            let acIdx = blocks.findIndex(
              (b) => b.type === 'agent_content' && (b as { parent_tool_use_id: string }).parent_tool_use_id === parentId
            )
            if (acIdx < 0) {
              blocks.push({ type: 'agent_content', parent_tool_use_id: parentId, blocks: [] } as ContentBlock)
              acIdx = blocks.length - 1
            }
            const acBlock = blocks[acIdx] as { type: 'agent_content'; parent_tool_use_id: string; blocks: AgentSubBlock[] }
            const subBlocks = [...acBlock.blocks]

            if (thinking) {
              if (state.currentThinkingIdx < 0 || subBlocks[state.currentThinkingIdx]?.type !== 'thinking') {
                subBlocks.push({ type: 'thinking', text: '' })
                state.currentThinkingIdx = subBlocks.length - 1
              }
              const tb = subBlocks[state.currentThinkingIdx]
              if (tb.type === 'thinking') {
                subBlocks[state.currentThinkingIdx] = { ...tb, text: tb.text + thinking }
              }
            }

            if (text) {
              if (state.currentTextIdx < 0 || subBlocks[state.currentTextIdx]?.type !== 'text') {
                subBlocks.push({ type: 'text', text: '' })
                state.currentTextIdx = subBlocks.length - 1
              }
              const tb = subBlocks[state.currentTextIdx]
              if (tb.type === 'text') {
                subBlocks[state.currentTextIdx] = { ...tb, text: tb.text + text }
              }
            }

            blocks[acIdx] = { ...acBlock, blocks: subBlocks } as ContentBlock
            return { ...m, blocks }
          })
        )
      }
    }

    // Combined flush: main text + per-agent text in a single RAF cycle
    const combinedFlush = () => {
      flushPendingText()
      flushAgentText()
    }
    const scheduleCombinedFlush = () => {
      if (pendingRaf === null) {
        pendingRaf = requestAnimationFrame(() => {
          pendingRaf = null
          combinedFlush()
        })
      }
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: content.trim(),
          permissionMode,
          thinkingMode,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        if (turnTimer) clearInterval(turnTimer)
        let errorMsg = 'Request failed'
        try { const errData = await res.json(); errorMsg = errData.error || errorMsg } catch { /* non-JSON response */ }
        setError(errorMsg)
        setMessages((prev) => prev.filter((m) => m.id !== tempAssistantId))
        streamCacheRef.current.delete(streamSessionId)
        setStreaming(false)
        streamingForSessionRef.current = null
        return
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let buffer = ''

      const processEvent = (event: Record<string, unknown>) => {
        // Start turn timer on the very first SSE event
        startTurnTimer()
        // Handle thinking_start — model entered extended thinking
        if (event.type === 'thinking_start') {
          setIsThinking(true)
          return
        }

        // ── thinking_delta: accumulate and flush at 60fps (same as text_delta) ──
        if (event.type === 'thinking_delta') {
          pendingThinking += (event.text as string) || ''
          scheduleCombinedFlush()
          return
        }

        // ── text_delta: accumulate and flush at 60fps for smooth streaming ──
        if (event.type === 'text_delta') {
          setIsThinking(false)
          pendingText += (event.text as string) || ''
          scheduleCombinedFlush()
          return
        }

        // ── agent_content: sub-agent intermediate content ──
        if (event.type === 'agent_content') {
          const parentId = event.parent_tool_use_id as string
          const blockType = event.block_type as string

          if (blockType === 'text_delta') {
            let state = agentPending.get(parentId)
            if (!state) {
              state = { pendingText: '', pendingThinking: '', currentTextIdx: -1, currentThinkingIdx: -1 }
              agentPending.set(parentId, state)
            }
            state.pendingText += (event.text as string) || ''
            scheduleCombinedFlush()
            return
          }

          if (blockType === 'thinking_delta') {
            let state = agentPending.get(parentId)
            if (!state) {
              state = { pendingText: '', pendingThinking: '', currentTextIdx: -1, currentThinkingIdx: -1 }
              agentPending.set(parentId, state)
            }
            state.pendingThinking += (event.text as string) || ''
            scheduleCombinedFlush()
            return
          }

          // For non-delta agent events (tool_use, tool_result, thinking, tool_progress),
          // flush pending text first then push the block
          combinedFlush()

          updateMessages((prev) =>
            prev.map((m) => {
              if (m.id !== tempAssistantId) return m
              const blocks = [...m.blocks]
              let acIdx = blocks.findIndex(
                (b) => b.type === 'agent_content' && (b as { parent_tool_use_id: string }).parent_tool_use_id === parentId
              )
              if (acIdx < 0) {
                blocks.push({ type: 'agent_content', parent_tool_use_id: parentId, blocks: [] } as ContentBlock)
                acIdx = blocks.length - 1
              }
              const acBlock = blocks[acIdx] as { type: 'agent_content'; parent_tool_use_id: string; blocks: AgentSubBlock[] }
              const subBlocks = [...acBlock.blocks]

              // Reset text block tracking for the agent after non-text blocks
              const agState = agentPending.get(parentId)

              if (blockType === 'tool_use') {
                subBlocks.push({
                  type: 'tool_use',
                  id: event.id as string,
                  name: event.name as string,
                  input: event.input as Record<string, unknown>,
                })
                if (agState) { agState.currentTextIdx = -1; agState.currentThinkingIdx = -1 }
              } else if (blockType === 'tool_result') {
                subBlocks.push({
                  type: 'tool_result',
                  tool_use_id: event.tool_use_id as string,
                  content: event.content as string,
                  is_error: event.is_error as boolean,
                })
              } else if (blockType === 'tool_progress') {
                const tuId = event.tool_use_id as string
                const existIdx = subBlocks.findIndex((b) => b.type === 'tool_progress' && b.tool_use_id === tuId)
                const pb: AgentSubBlock = {
                  type: 'tool_progress',
                  tool_use_id: tuId,
                  tool_name: event.tool_name as string,
                  elapsed_time_seconds: event.elapsed_time_seconds as number,
                }
                if (existIdx >= 0) {
                  subBlocks[existIdx] = pb
                } else {
                  subBlocks.push(pb)
                }
              } else if (blockType === 'thinking') {
                subBlocks.push({ type: 'thinking', text: event.text as string })
                if (agState) agState.currentThinkingIdx = -1
              } else if (blockType === 'text') {
                subBlocks.push({ type: 'text', text: event.text as string })
                if (agState) agState.currentTextIdx = -1
              }

              blocks[acIdx] = { ...acBlock, blocks: subBlocks } as ContentBlock
              return { ...m, blocks }
            })
          )
          return
        }

        // For all other events, flush any pending text first to maintain order
        combinedFlush()

        // Handle done event separately — it needs to update both user and assistant message ids
        if (event.type === 'done') {
          if (turnTimer) clearInterval(turnTimer)
          const finalElapsed = turnStartTime > 0 ? Math.floor((Date.now() - turnStartTime) / 1000) : 0
          const userMsgId = event.userMessageId as string | undefined
          const inTokens = (event.inputTokens as number) || 0
          const outTokens = (event.outputTokens as number) || 0
          updateMessages((prev) =>
            prev.map((m) => {
              if (m.id === tempAssistantId) {
                return {
                  ...m,
                  id: event.messageId as string,
                  elapsedSeconds: finalElapsed,
                  inputTokens: inTokens,
                  outputTokens: outTokens,
                }
              }
              if (userMsgId && m.id === tempUserMsg.id) return { ...m, id: userMsgId }
              return m
            })
          )
          // Stream complete — clear cache. If user is on another session,
          // next switch back will load the saved result from DB.
          streamCacheRef.current.delete(streamSessionId)
          // Notify file tree to refresh after conversation turn completes
          window.dispatchEvent(new CustomEvent('forge:files-changed'))
          return
        }

        if (event.type === 'error') {
          setError(event.error as string)
          return
        }

        updateMessages((prev) =>
          prev.map((m) => {
            if (m.id !== tempAssistantId) return m
            const blocks = [...m.blocks]

            switch (event.type) {
              case 'tool_use': {
                setIsThinking(false)
                const toolName = event.name as string
                const toolInput = event.input as Record<string, unknown>
                const toolId = event.id as string
                // Deduplicate: SDK may send the same tool_use via multiple message paths
                if (!blocks.some((b) => b.type === 'tool_use' && b.id === toolId)) {
                  blocks.push({
                    type: 'tool_use',
                    id: toolId,
                    name: toolName,
                    input: toolInput,
                  })
                }
                currentTextBlockIdx = -1 // Next text_delta starts a new text block
                break
              }
              case 'tool_raw_result': {
                // Deduplicate by tool_use_id
                if (!blocks.some((b) => b.type === 'tool_raw_result' && b.tool_use_id === (event.tool_use_id as string))) {
                  blocks.push({
                    type: 'tool_raw_result',
                    tool_use_id: event.tool_use_id as string,
                    tool_name: event.tool_name as string,
                    raw_content: event.raw_content as import('@/lib/types').ToolRawContent,
                  })
                }
                break
              }
              case 'tool_result': {
                // Deduplicate: both mapUserMessage and mapToolUseSummary may emit tool_result for the same tool
                if (!blocks.some((b) => b.type === 'tool_result' && b.tool_use_id === (event.tool_use_id as string))) {
                  blocks.push({
                    type: 'tool_result',
                    tool_use_id: event.tool_use_id as string,
                    content: event.result as string,
                    is_error: event.is_error as boolean,
                  })
                }
                // If tool execution failed, mark the associated permission block as toolFailed
                // so the UI can show that the tool failed despite permission being granted
                const toolUseId = event.tool_use_id as string
                const isErr = event.is_error as boolean
                if (isErr) {
                  const permIdx = blocks.findIndex(
                    (b) => b.type === 'permission_request' && b.toolUseId === toolUseId
                  )
                  if (permIdx >= 0) {
                    const pb = blocks[permIdx]
                    if (pb.type === 'permission_request') {
                      blocks[permIdx] = { ...pb, toolFailed: true }
                    }
                  }
                }
                // Notify file tree when file-modifying tools complete (deferred to escape React update cycle)
                const matchedTool = blocks.find((b) => b.type === 'tool_use' && b.id === toolUseId)
                if (matchedTool?.type === 'tool_use') {
                  const FILE_TOOLS = ['Write', 'Edit', 'Bash', 'NotebookEdit', 'write_file', 'run_command']
                  if (FILE_TOOLS.includes(matchedTool.name)) {
                    setTimeout(() => window.dispatchEvent(new CustomEvent('forge:files-changed')), 0)
                  }
                }
                break
              }
              case 'permission_request': {
                blocks.push({
                  type: 'permission_request',
                  requestId: event.requestId as string,
                  toolName: event.toolName as string,
                  toolInput: event.toolInput as Record<string, unknown>,
                  status: 'pending',
                  toolUseId: event.toolUseId as string | undefined,
                })
                break
              }
              case 'tool_progress': {
                const progressToolUseId = event.tool_use_id as string
                // Upsert: update existing progress block or add new one
                const existingProgressIdx = blocks.findIndex(
                  (b) => b.type === 'tool_progress' && b.tool_use_id === progressToolUseId
                )
                const progressBlock: ContentBlock = {
                  type: 'tool_progress',
                  tool_use_id: progressToolUseId,
                  tool_name: event.tool_name as string,
                  elapsed_time_seconds: event.elapsed_time_seconds as number,
                }
                if (existingProgressIdx >= 0) {
                  blocks[existingProgressIdx] = progressBlock
                } else {
                  blocks.push(progressBlock)
                }
                break
              }
              case 'permission_resolved': {
                const reqId = event.requestId as string
                const decision = event.decision as string
                const statusMap: Record<string, string> = {
                  allow: 'allowed',
                  allow_session: 'allowed_session',
                  deny: 'denied',
                  timeout: 'timeout',
                }
                const idx = blocks.findIndex(
                  (b) => b.type === 'permission_request' && b.requestId === reqId
                )
                if (idx >= 0) {
                  const b = blocks[idx]
                  if (b.type === 'permission_request') {
                    blocks[idx] = { ...b, status: (statusMap[decision] || 'denied') as 'allowed' | 'allowed_session' | 'denied' | 'timeout' }
                  }
                }
                break
              }
            }

            return { ...m, blocks }
          })
        )
      }

      const processLines = (lines: string[]) => {
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            processEvent(JSON.parse(line.slice(6)))
          } catch { /* skip malformed */ }
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''
        processLines(lines)
      }

      if (buffer.trim()) processLines([buffer])
      combinedFlush() // Flush any remaining accumulated text (main + agent)
    } catch (err) {
      // Cancel timers on error
      if (turnTimer) clearInterval(turnTimer)
      if (pendingRaf !== null) cancelAnimationFrame(pendingRaf)
      combinedFlush()
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled — no additional action needed
      } else {
        setError(err instanceof Error ? err.message : 'Failed to send message')
      }
      updateMessages((prev) => prev.filter((m) => m.id !== tempAssistantId || m.blocks.length > 0))
      streamCacheRef.current.delete(streamSessionId)
    } finally {
      streamingForSessionRef.current = null
      // Only update UI streaming state if this session is still displayed
      if (currentSessionRef.current === streamSessionId) {
        setStreaming(false)
        setIsThinking(false)
      }
      abortRef.current = null
    }
  }, [sessionId])

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const sendPermissionDecision = useCallback(async (requestId: string, decision: 'allow' | 'allow_session' | 'deny') => {
    try {
      const res = await fetch('/api/chat/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, decision }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        console.error('Permission decision failed:', res.status, data)
      }
    } catch (err) {
      console.error('Failed to send permission decision:', err)
    }
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return { messages, streaming, isThinking, error, sendMessage, loadMessages, stopStreaming, clearMessages, sendPermissionDecision }
}
