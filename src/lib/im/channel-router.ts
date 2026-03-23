/**
 * Channel Router (Layer 3).
 *
 * Maps (channelType, chatId) → sessionId with per-session binding.
 * Handles auto-creation of new sessions and stale session detection.
 */

import { getDb } from '@/lib/db'
import crypto from 'crypto'
import type { ChannelType, IncomingMessage } from './types'

/** Session resolution result */
export interface SessionResolution {
  sessionId: string
  isNew: boolean
  workspace: string
}

export class ChannelRouter {
  /**
   * Resolve the session for an incoming message.
   *
   * Sessions never auto-expire. Once a binding exists,
   * it persists until the user explicitly runs /new or /bind.
   *
   * Priority:
   * 1. Existing binding with session_id → always reuse (no expiry)
   * 2. Existing binding with workspace (legacy) → create new session in that workspace
   * 3. No binding → create new session + binding (auto-bind)
   */
  resolveSession(msg: IncomingMessage): SessionResolution {
    const db = getDb()

    // Check for existing binding
    const binding = db.prepare(
      'SELECT id, session_id, workspace FROM channel_bindings WHERE channel_id = ? AND chat_id = ?',
    ).get(msg.channelType, msg.chatId) as {
      id: string; session_id: string | null; workspace: string
    } | undefined

    if (binding?.session_id) {
      // Verify session still exists in DB
      const session = db.prepare('SELECT workspace FROM sessions WHERE id = ?')
        .get(binding.session_id) as { workspace: string } | undefined

      if (session) {
        return { sessionId: binding.session_id, isNew: false, workspace: session.workspace }
      }

      // Session was deleted — create a new one in the same workspace
      const workspace = binding.workspace || this.getDefaultWorkspace()
      const newSessionId = this.createSession(msg, workspace)

      db.prepare('UPDATE channel_bindings SET session_id = ? WHERE id = ?')
        .run(newSessionId, binding.id)

      return { sessionId: newSessionId, isNew: true, workspace }
    }

    if (binding) {
      // Legacy binding (workspace only, no session_id)
      const workspace = binding.workspace || this.getDefaultWorkspace()
      const newSessionId = this.createSession(msg, workspace)

      // Upgrade binding with session_id
      db.prepare('UPDATE channel_bindings SET session_id = ? WHERE id = ?')
        .run(newSessionId, binding.id)

      return { sessionId: newSessionId, isNew: true, workspace }
    }

    // No binding — auto-create
    return this.createAutoBinding(msg)
  }

  /**
   * Explicitly bind a chat to a specific session.
   * Used by /bind command.
   */
  bindSession(channelType: ChannelType, chatId: string, sessionId: string): void {
    const db = getDb()

    // Verify session exists
    const session = db.prepare('SELECT workspace FROM sessions WHERE id = ?')
      .get(sessionId) as { workspace: string } | undefined
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    // Upsert binding
    const existing = db.prepare(
      'SELECT id FROM channel_bindings WHERE channel_id = ? AND chat_id = ?',
    ).get(channelType, chatId) as { id: string } | undefined

    if (existing) {
      db.prepare('UPDATE channel_bindings SET session_id = ?, workspace = ? WHERE id = ?')
        .run(sessionId, session.workspace, existing.id)
    } else {
      db.prepare(
        'INSERT INTO channel_bindings (id, channel_id, chat_id, workspace, session_id) VALUES (?, ?, ?, ?, ?)',
      ).run(crypto.randomUUID(), channelType, chatId, session.workspace, sessionId)
    }
  }

  /**
   * Unbind a chat (removes the binding entirely).
   * Next message from this chat will auto-create a new session.
   */
  unbindSession(channelType: ChannelType, chatId: string): void {
    const db = getDb()
    db.prepare('DELETE FROM channel_bindings WHERE channel_id = ? AND chat_id = ?')
      .run(channelType, chatId)
  }

  /**
   * Create a new session and binding for a chat (used by /new command).
   * Returns the new session ID.
   */
  createNewSession(msg: IncomingMessage): string {
    const db = getDb()

    // Get current workspace from existing binding or use most recent
    const binding = db.prepare(
      'SELECT id, workspace FROM channel_bindings WHERE channel_id = ? AND chat_id = ?',
    ).get(msg.channelType, msg.chatId) as { id: string; workspace: string } | undefined

    const workspace = binding?.workspace || this.getDefaultWorkspace()
    const newSessionId = this.createSession(msg, workspace)

    if (binding) {
      db.prepare('UPDATE channel_bindings SET session_id = ? WHERE id = ?')
        .run(newSessionId, binding.id)
    } else {
      db.prepare(
        'INSERT INTO channel_bindings (id, channel_id, chat_id, workspace, session_id) VALUES (?, ?, ?, ?, ?)',
      ).run(crypto.randomUUID(), msg.channelType, msg.chatId, workspace, newSessionId)
    }

    return newSessionId
  }

  /**
   * Get binding info for a chat (for /status command).
   */
  getBindingInfo(channelType: ChannelType, chatId: string): {
    sessionId: string | null
    workspace: string
  } | null {
    const db = getDb()
    const binding = db.prepare(
      'SELECT session_id, workspace FROM channel_bindings WHERE channel_id = ? AND chat_id = ?',
    ).get(channelType, chatId) as { session_id: string | null; workspace: string } | undefined

    if (!binding) return null
    return { sessionId: binding.session_id, workspace: binding.workspace }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private createAutoBinding(msg: IncomingMessage): SessionResolution {
    const db = getDb()
    const workspace = this.getDefaultWorkspace()
    const sessionId = this.createSession(msg, workspace)

    db.prepare(
      'INSERT INTO channel_bindings (id, channel_id, chat_id, workspace, session_id) VALUES (?, ?, ?, ?, ?)',
    ).run(crypto.randomUUID(), msg.channelType, msg.chatId, workspace, sessionId)

    return { sessionId, isNew: true, workspace }
  }

  private createSession(msg: IncomingMessage, workspace: string): string {
    const db = getDb()
    const sessionId = crypto.randomUUID()

    // Use bridge default model if configured, otherwise fall back to default
    const defaultModel = this.getDefaultModel()

    db.prepare('INSERT INTO sessions (id, title, workspace, model) VALUES (?, ?, ?, ?)').run(
      sessionId,
      `[${msg.channelType}] New conversation`,
      workspace,
      defaultModel,
    )

    return sessionId
  }

  /**
   * Get the default workspace for new sessions.
   * Priority: bridge_default_work_dir setting → most recently opened workspace.
   */
  getDefaultWorkspace(): string {
    const db = getDb()

    // Check bridge default setting first
    const defaultDir = db.prepare("SELECT value FROM settings WHERE key = 'bridge_default_work_dir'")
      .get() as { value: string } | undefined
    if (defaultDir?.value) {
      // Look up workspace by path
      const ws = db.prepare('SELECT id FROM workspaces WHERE path = ?')
        .get(defaultDir.value) as { id: string } | undefined
      if (ws) return ws.id
    }

    // Fall back to most recently opened workspace
    const ws = db.prepare('SELECT id FROM workspaces ORDER BY last_opened_at DESC LIMIT 1')
      .get() as { id: string } | undefined
    return ws?.id || ''
  }

  /**
   * Get the default model for new sessions.
   * Priority: bridge_default_model setting → 'claude-sonnet-4-6'.
   */
  private getDefaultModel(): string {
    const db = getDb()
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'bridge_default_model'")
      .get() as { value: string } | undefined
    return setting?.value || 'claude-sonnet-4-6'
  }

  /**
   * List recent sessions (for /sessions command).
   */
  listRecentSessions(limit = 10): Array<{ id: string; title: string; workspace: string; updatedAt: string }> {
    const db = getDb()
    return db.prepare('SELECT id, title, workspace, updated_at as updatedAt FROM sessions ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as Array<{ id: string; title: string; workspace: string; updatedAt: string }>
  }
}
