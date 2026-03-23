/**
 * Permission bridge: connects SDK's canUseTool callback to the SSE stream
 * and the frontend's permission decision endpoint.
 *
 * Flow:
 * 1. SDK calls canUseTool(toolName, input)
 * 2. Bridge emits 'permission_request' via SSE to frontend
 * 3. Frontend shows modal, user clicks allow/deny
 * 4. Frontend POSTs to /api/chat/permission
 * 5. resolvePermission() resolves the Promise
 * 6. canUseTool returns PermissionResult to SDK
 */

import crypto from 'crypto'
import type { CanUseTool, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { SseEvent } from './message-mapper'

export type PermissionDecision = 'allow' | 'allow_session' | 'deny' | 'timeout'

interface PendingRequest {
  resolve: (decision: PermissionDecision) => void
  toolName: string
  toolInput: Record<string, unknown>
  sessionId: string
  createdAt: number
  /** SDK-provided permission suggestions to pass back when allowing */
  suggestions?: PermissionUpdate[]
}

interface PermissionLogEntry {
  sessionId: string
  toolName: string
  toolUseId: string
  decision: PermissionDecision
  timestamp: number
}

// Use globalThis to ensure state is shared across route handlers.
// Turbopack creates separate module instances for different route handlers,
// so module-level Maps would be isolated between /api/chat and /api/chat/permission.
const g = globalThis as unknown as {
  __forge_pendingRequests?: Map<string, PendingRequest>
  __forge_sessionAllowances?: Map<string, Set<string>>
  __forge_sessionActivity?: Map<string, number>
  __forge_permissionLog?: PermissionLogEntry[]
}

if (!g.__forge_pendingRequests) g.__forge_pendingRequests = new Map()
if (!g.__forge_sessionAllowances) g.__forge_sessionAllowances = new Map()
if (!g.__forge_sessionActivity) g.__forge_sessionActivity = new Map()
if (!g.__forge_permissionLog) g.__forge_permissionLog = []

const pendingRequests = g.__forge_pendingRequests
const sessionAllowances = g.__forge_sessionAllowances

const PERMISSION_TIMEOUT_MS = 120_000

/**
 * Create a canUseTool callback that bridges SDK permission requests
 * to the SSE stream for frontend interaction.
 */
export function createPermissionBridge(
  sessionId: string,
  emit: (event: SseEvent) => void | Promise<void>,
): CanUseTool {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; suggestions?: PermissionUpdate[]; toolUseID: string; agentID?: string; blockedPath?: string; decisionReason?: string },
  ): Promise<PermissionResult> => {
    // Debug: log every canUseTool call with full context
    console.log(`[forge-permission] canUseTool called:`, JSON.stringify({
      toolName,
      toolUseID: options.toolUseID,
      agentID: options.agentID,
      hasSuggestions: !!options.suggestions,
      suggestionsCount: options.suggestions?.length ?? 0,
      suggestions: options.suggestions,
      blockedPath: options.blockedPath,
      decisionReason: options.decisionReason,
      inputKeys: Object.keys(input),
    }, null, 2))

    // Build updatedPermissions: use SDK suggestions if available, otherwise construct
    // a fallback that adds the tool to the session allow list. Without this, Claude Code's
    // internal permission state won't be updated and tools like WebSearch/WebFetch may fail
    // even after canUseTool returns 'allow'.
    const updatedPermissions: PermissionUpdate[] = options.suggestions ?? [{
      type: 'addRules',
      rules: [{ toolName }],
      behavior: 'allow',
      destination: 'session',
    } as PermissionUpdate]

    // Check if this tool is already allowed for this session
    if (isToolAllowedForSession(sessionId, toolName)) {
      touchSessionActivity(sessionId)
      const result: PermissionResult = { behavior: 'allow', updatedInput: input, updatedPermissions }
      console.log(`[forge-permission] Auto-allowed (session): ${toolName}`)
      return result
    }

    // Create a pending permission request
    const requestId = crypto.randomUUID()

    // Emit permission_request via SSE to the frontend.
    // If emit fails (client disconnected, writer closed), deny immediately
    // instead of hanging until the 120s timeout.
    try {
      await Promise.resolve(emit({
        type: 'permission_request',
        requestId,
        toolName,
        toolInput: input,
        toolUseId: options.toolUseID,
      }))
    } catch (err) {
      console.warn(`[forge-permission] Failed to emit permission_request for ${toolName}:`, err)
      return { behavior: 'deny', message: `Permission request failed: SSE connection lost` }
    }

    // Wait for the frontend to respond
    const decision = await waitForDecision(requestId, sessionId, toolName, input, options.suggestions)

    // Emit permission_resolved via SSE (best-effort, don't block on failure)
    try {
      await Promise.resolve(emit({
        type: 'permission_resolved',
        requestId,
        decision,
      }))
    } catch {
      // Client may have disconnected — decision is still processed
    }

    // Log permission decision for audit trail
    logPermissionDecision(sessionId, toolName, options.toolUseID, decision)

    // Map to SDK PermissionResult
    // IMPORTANT: Pass updatedPermissions back to the SDK so it updates its internal
    // permission state. Without this, tools like WebSearch/WebFetch may fail because
    // the SDK's internal permission rules aren't updated to allow them.
    if (decision === 'allow' || decision === 'allow_session') {
      touchSessionActivity(sessionId)
      const result: PermissionResult = { behavior: 'allow', updatedInput: input, updatedPermissions }
      console.log(`[forge-permission] Returning ALLOW for ${toolName}, decision=${decision}`)
      return result
    }
    console.log(`[forge-permission] Returning DENY for ${toolName}: decision=${decision}`)
    return { behavior: 'deny', message: `Permission denied for ${toolName}` }
  }
}

function isToolAllowedForSession(sessionId: string, toolName: string): boolean {
  return sessionAllowances.get(sessionId)?.has(toolName) ?? false
}

function waitForDecision(
  requestId: string,
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  suggestions?: PermissionUpdate[],
): Promise<PermissionDecision> {
  return new Promise<PermissionDecision>((resolve) => {
    pendingRequests.set(requestId, {
      resolve,
      toolName,
      toolInput,
      sessionId,
      createdAt: Date.now(),
      suggestions,
    })

    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId)
        resolve('timeout')
      }
    }, PERMISSION_TIMEOUT_MS)
  })
}

/**
 * Resolve a pending permission request (called from /api/chat/permission).
 */
export function resolvePermission(requestId: string, decision: PermissionDecision): boolean {
  const pending = pendingRequests.get(requestId)
  if (!pending) return false

  pendingRequests.delete(requestId)

  if (decision === 'allow_session') {
    let allowed = sessionAllowances.get(pending.sessionId)
    if (!allowed) {
      allowed = new Set()
      sessionAllowances.set(pending.sessionId, allowed)
    }
    allowed.add(pending.toolName)

    // Auto-resolve all other pending requests for the same tool + session.
    // This prevents the user from having to click Allow for each individual
    // request when they already granted session-wide permission.
    for (const [id, req] of pendingRequests) {
      if (req.sessionId === pending.sessionId && req.toolName === pending.toolName) {
        pendingRequests.delete(id)
        req.resolve('allow_session')
      }
    }
  }

  pending.resolve(decision)
  return true
}

/**
 * Clear session allowances (e.g., when session ends).
 */
export function clearSessionAllowances(sessionId: string): void {
  sessionAllowances.delete(sessionId)
  sessionActivity.delete(sessionId)
}

// ── Session activity tracking & auto-cleanup ──

/** Track last activity time per session for stale cleanup */
const sessionActivity = g.__forge_sessionActivity!
const SESSION_STALE_MS = 30 * 60 * 1000 // 30 minutes

function touchSessionActivity(sessionId: string): void {
  sessionActivity.set(sessionId, Date.now())
}

/**
 * Clean up stale session allowances that haven't been active for 30 minutes.
 * Called periodically to prevent memory leaks from abnormal session closures.
 */
export function cleanupStaleSessionAllowances(): number {
  const now = Date.now()
  let cleaned = 0
  for (const [sid, lastActive] of sessionActivity) {
    if (now - lastActive > SESSION_STALE_MS) {
      sessionAllowances.delete(sid)
      sessionActivity.delete(sid)
      cleaned++
    }
  }
  // Also clean sessions in allowances map that have no activity record
  for (const sid of sessionAllowances.keys()) {
    if (!sessionActivity.has(sid)) {
      sessionAllowances.delete(sid)
      cleaned++
    }
  }
  return cleaned
}

// ── Permission audit logging ──

const permissionLog = g.__forge_permissionLog!
const MAX_LOG_ENTRIES = 500

function logPermissionDecision(
  sessionId: string,
  toolName: string,
  toolUseId: string,
  decision: PermissionDecision,
): void {
  permissionLog.push({ sessionId, toolName, toolUseId, decision, timestamp: Date.now() })
  // Keep log bounded to prevent unbounded memory growth
  if (permissionLog.length > MAX_LOG_ENTRIES) {
    permissionLog.splice(0, permissionLog.length - MAX_LOG_ENTRIES)
  }
}

/**
 * Get recent permission log entries (for debugging / audit).
 */
export function getPermissionLog(limit = 50): PermissionLogEntry[] {
  return permissionLog.slice(-limit)
}

/** Permission timeout duration in milliseconds (exported for frontend use) */
export { PERMISSION_TIMEOUT_MS }
