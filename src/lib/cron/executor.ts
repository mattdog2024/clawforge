/**
 * Execute a cron task: run through the Claude Agent SDK and optionally notify via IM.
 * Each execution creates a new Session visible in the chat list.
 */

import { getDb } from '@/lib/db'
import crypto from 'crypto'
import { createForgeQuery } from '@/lib/sdk/client'
import { readWorkspaceFile } from '@/lib/workspace-fs'
import { getBridgeManager } from '@/lib/im/bridge-manager'
import { emitImEvent } from '@/lib/im/im-events'
import type { CronTaskRow } from '@/lib/types'

interface TaskConfig {
  check_interval?: string
  notify_channel?: string
  checklist_path?: string
}

interface TaskResult {
  status: 'ok' | 'alert' | 'error'
  result: string
  sessionId: string
}

export async function executeTask(task: CronTaskRow): Promise<TaskResult> {
  try {
    if (task.is_heartbeat) {
      return await executeHeartbeat(task)
    }

    const actionType = task.action_type || 'custom-prompt'

    switch (actionType) {
      case 'run-agent':
        return await executeRunAgent(task)
      case 'run-skill':
        return await executeRunSkill(task)
      case 'custom-prompt':
      default:
        return await executeCustomPrompt(task)
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    return { status: 'error', result: errorMsg, sessionId: '' }
  }
}

/**
 * Resolve the workspace_id to use for this task.
 * For heartbeat: uses the task's workspace_id or falls back to most recently opened.
 * For others: uses the task's workspace_id (required).
 */
function resolveWorkspaceId(task: CronTaskRow): string | null {
  if (task.workspace_id) return task.workspace_id

  // Fallback for heartbeat: use most recently opened workspace
  if (task.is_heartbeat) {
    const db = getDb()
    const recentWs = db.prepare('SELECT id FROM workspaces ORDER BY last_opened_at DESC LIMIT 1').get() as { id: string } | undefined
    return recentWs?.id || null
  }

  return null
}

async function executeHeartbeat(task: CronTaskRow): Promise<TaskResult> {
  const config = parseConfig(task.config)
  const workspaceId = resolveWorkspaceId(task)
  if (!workspaceId) {
    return { status: 'ok', result: 'No workspace configured', sessionId: '' }
  }

  // Load HEARTBEAT.md checklist
  const checklistPath = config.checklist_path || 'HEARTBEAT.md'
  const checklist = readWorkspaceFile(workspaceId, checklistPath)
  if (!checklist || !checklist.trim()) {
    return { status: 'ok', result: 'HEARTBEAT_OK (no checklist configured)', sessionId: '' }
  }

  const systemPrompt = [
    'You are a heartbeat agent performing routine checks.',
    'Execute each item in the checklist below using the available tools.',
    'After checking all items, summarize your findings.',
    'If everything is normal, respond with exactly: HEARTBEAT_OK',
    'If you find issues or items that need attention, list them clearly.',
    'Be concise — your output will be automatically delivered via IM notification.',
    'Do NOT try to send messages yourself or ask for API credentials.',
  ].join('\n')

  const userMessage = `Run the following heartbeat checklist:\n\n${checklist}`
  const sessionTitle = `[Scheduled] ${task.name}`

  const { text, sessionId } = await runAgentTask(systemPrompt, userMessage, workspaceId, sessionTitle)

  const isOk = text.includes('HEARTBEAT_OK')
  const status = isOk ? 'ok' : 'alert'

  if (!isOk && config.notify_channel) {
    await notifyIm(config.notify_channel, `📢 Heartbeat Alert\n\n${text}`)
  }

  return { status, result: text.slice(0, 500), sessionId }
}

async function executeRunAgent(task: CronTaskRow): Promise<TaskResult> {
  const config = parseConfig(task.config)
  const workspaceId = resolveWorkspaceId(task)
  if (!workspaceId) {
    return { status: 'error', result: 'No workspace configured for this task', sessionId: '' }
  }

  // Load the agent's AGENT.md (or CLAUDE.md) from workspace or global
  const agentName = task.agent_name
  if (!agentName) {
    return { status: 'error', result: 'No agent specified', sessionId: '' }
  }

  // Try loading agent file from project, then global
  let agentPrompt = readWorkspaceFile(workspaceId, `agents/${agentName}/AGENT.md`)
  if (!agentPrompt) {
    agentPrompt = readWorkspaceFile(workspaceId, `agents/${agentName}/CLAUDE.md`)
  }

  const systemPrompt = agentPrompt
    ? `You are running as the "${agentName}" agent.\n\n${agentPrompt}`
    : `You are running as the "${agentName}" scheduled agent. Execute the task and report results concisely.`

  const userMessage = task.action || `Execute the ${agentName} agent task.`
  const sessionTitle = `[Scheduled] ${task.name}`

  const { text, sessionId } = await runAgentTask(systemPrompt, userMessage, workspaceId, sessionTitle)

  if (config.notify_channel) {
    await notifyIm(config.notify_channel, `⏰ ${task.name}\n\n${text.slice(0, 1000)}`)
  }

  return { status: 'ok', result: text.slice(0, 500), sessionId }
}

async function executeRunSkill(task: CronTaskRow): Promise<TaskResult> {
  const config = parseConfig(task.config)
  const workspaceId = resolveWorkspaceId(task)
  if (!workspaceId) {
    return { status: 'error', result: 'No workspace configured for this task', sessionId: '' }
  }

  const skillName = task.skill_name
  if (!skillName) {
    return { status: 'error', result: 'No skill specified', sessionId: '' }
  }

  // Load skill file
  const skillContent = readWorkspaceFile(workspaceId, `skills/${skillName}/SKILL.md`)

  const systemPrompt = skillContent
    ? `You are executing the "${skillName}" skill.\n\n${skillContent}`
    : `You are executing the "${skillName}" scheduled skill. Execute the task and report results concisely.`

  const userMessage = task.action || `Execute the ${skillName} skill.`
  const sessionTitle = `[Scheduled] ${task.name}`

  const { text, sessionId } = await runAgentTask(systemPrompt, userMessage, workspaceId, sessionTitle)

  if (config.notify_channel) {
    await notifyIm(config.notify_channel, `⏰ ${task.name}\n\n${text.slice(0, 1000)}`)
  }

  return { status: 'ok', result: text.slice(0, 500), sessionId }
}

async function executeCustomPrompt(task: CronTaskRow): Promise<TaskResult> {
  const config = parseConfig(task.config)
  const workspaceId = resolveWorkspaceId(task)
  if (!workspaceId) {
    return { status: 'error', result: 'No workspace configured for this task', sessionId: '' }
  }

  const notifyTarget = config.notify_channel ? ` Your output will be automatically delivered to the user via ${config.notify_channel} — do NOT try to send messages yourself, just produce the content.` : ''
  const systemPrompt = [
    'You are a scheduled task agent running on behalf of the user.',
    'Execute the following action and report the result concisely.',
    `IMPORTANT: Your text output IS the deliverable.${notifyTarget}`,
    'Do NOT ask for API credentials, webhooks, or try to call any IM APIs.',
    'If the task is to send a message, just output that message directly.',
  ].join('\n')

  const sessionTitle = `[Scheduled] ${task.name}`
  const { text, sessionId } = await runAgentTask(systemPrompt, task.action, workspaceId, sessionTitle)

  if (config.notify_channel) {
    await notifyIm(config.notify_channel, `⏰ ${task.name}\n\n${text.slice(0, 1000)}`)
  }

  return { status: 'ok', result: text.slice(0, 500), sessionId }
}

/**
 * Run a task via the Claude Agent SDK.
 * Creates a persistent session (visible in chat list) with [Scheduled] prefix.
 */
async function runAgentTask(
  systemPrompt: string,
  userMessage: string,
  workspaceId: string,
  sessionTitle: string,
): Promise<{ text: string; sessionId: string }> {
  const db = getDb()
  const sessionId = crypto.randomUUID()

  // Create a persistent session in the database so it appears in the chat list
  db.prepare(
    "INSERT INTO sessions (id, title, workspace, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))"
  ).run(sessionId, sessionTitle, workspaceId, 'claude-sonnet-4-6')

  // Store the user message
  const userMsgId = crypto.randomUUID()
  db.prepare(
    "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, 'user', ?, datetime('now'))"
  ).run(userMsgId, sessionId, JSON.stringify([{ type: 'text', text: userMessage }]))

  const q = createForgeQuery({
    prompt: userMessage,
    sessionId,
    model: 'claude-sonnet-4-6',
    workspaceId,
    bypassPermissions: true,
    customSystemPrompt: systemPrompt,
  })

  const allTextBlocks: string[] = []

  for await (const msg of q) {
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'text') allTextBlocks.push(block.text)
      }
    }
  }

  const resultText = allTextBlocks.join('\n\n') || '(no output)'

  // Store the assistant response
  const assistantMsgId = crypto.randomUUID()
  db.prepare(
    "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, datetime('now'))"
  ).run(assistantMsgId, sessionId, JSON.stringify([{ type: 'text', text: resultText }]))

  // Notify desktop UI to refresh session list via SSE
  emitImEvent('im:session-changed', { sessionId, workspaceId })

  return { text: resultText, sessionId }
}

/**
 * Send a notification message through IM.
 * Resolves the target chat from channel_bindings:
 *   1. Prefer DM (p2p) bindings for that channel
 *   2. Fall back to any bound chat (group)
 */
async function notifyIm(channelId: string, message: string): Promise<void> {
  const manager = getBridgeManager()
  if (!manager.isConnected(channelId)) {
    console.log(`[Cron] IM channel ${channelId} not connected, skipping notification`)
    return
  }

  // Find target chat from bindings
  const db = getDb()
  const bindings = db.prepare(
    'SELECT chat_id FROM channel_bindings WHERE channel_id = ? ORDER BY created_at DESC',
  ).all(channelId) as { chat_id: string }[]

  if (bindings.length === 0) {
    console.log(`[Cron] No chat bindings for channel ${channelId}, skipping notification`)
    return
  }

  // Send to the first (most recent) bound chat
  const targetChatId = bindings[0].chat_id

  try {
    const { DeliveryLayer } = await import('@/lib/im/delivery')
    const delivery = new DeliveryLayer()
    const adapters = manager.getAdapters()
    const adapter = adapters.get(channelId)
    if (!adapter) {
      console.log(`[Cron] No adapter for channel ${channelId}`)
      return
    }

    await delivery.deliver(adapter, targetChatId, message)
    console.log(`[Cron] Notification sent to ${channelId}:${targetChatId}: ${message.slice(0, 80)}`)
  } catch (err) {
    console.error(`[Cron] Failed to send notification to ${channelId}:`, err instanceof Error ? err.message : err)
  }
}

function parseConfig(configStr: string): TaskConfig {
  try {
    return JSON.parse(configStr) as TaskConfig
  } catch {
    return {}
  }
}
