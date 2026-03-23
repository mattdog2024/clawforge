/**
 * Permission Broker (cross-cutting).
 *
 * Centralizes IM permission requests:
 *   1. ConversationEngine calls requestPermission()
 *   2. Broker sends permission UI via adapter
 *   3. Adapter receives user response and calls resolvePermission()
 *   4. Promise resolves, ConversationEngine continues
 *
 * Auto-denies after 120 seconds (timeout).
 */

import type { ChannelAdapter } from './adapters/base'
import type { ImPermissionRequest } from './types'

interface PendingRequest {
  resolve: (decision: 'allow' | 'deny') => void
  timeout: ReturnType<typeof setTimeout>
  channelId?: string  // For scoped cleanup when a single adapter stops
}

/** Permission request timeout (ms) */
const PERMISSION_TIMEOUT_MS = 120_000

export class PermissionBroker {
  private pending = new Map<string, PendingRequest>()

  /**
   * Request permission from the IM user.
   *
   * Sends a platform-specific permission prompt via the adapter,
   * then waits for the user to respond (or timeout).
   *
   * @returns 'allow' or 'deny'
   */
  async requestPermission(
    req: ImPermissionRequest,
    adapter: ChannelAdapter,
    channelId?: string,
  ): Promise<'allow' | 'deny'> {
    return new Promise<'allow' | 'deny'>((resolve) => {
      // Set timeout for auto-deny
      const timeout = setTimeout(() => {
        this.pending.delete(req.requestId)
        resolve('deny')
      }, PERMISSION_TIMEOUT_MS)

      this.pending.set(req.requestId, { resolve, timeout, channelId })

      // Send permission prompt to user
      adapter.sendPermissionPrompt(req).catch(() => {
        // If sending fails, auto-deny
        this.pending.delete(req.requestId)
        clearTimeout(timeout)
        resolve('deny')
      })
    })
  }

  /**
   * Resolve a pending permission request.
   * Called by the adapter when the user clicks allow/deny.
   *
   * Also handles Feishu's /perm command prefix matching.
   */
  resolvePermission(requestId: string, decision: 'allow' | 'deny'): void {
    // Try exact match first
    let entry = this.pending.get(requestId)
    if (entry) {
      this.pending.delete(requestId)
      clearTimeout(entry.timeout)
      entry.resolve(decision)
      return
    }

    // Try prefix match (for Feishu's short ID format)
    for (const [key, val] of this.pending.entries()) {
      if (key.startsWith(requestId) || requestId.startsWith(key.slice(0, 8))) {
        this.pending.delete(key)
        clearTimeout(val.timeout)
        val.resolve(decision)
        return
      }
    }
  }

  /**
   * Clean up pending requests for a specific channel (e.g., on single adapter disconnect).
   * Only denies permissions associated with the given channelId.
   */
  cleanupChannel(channelId: string): void {
    for (const [id, entry] of this.pending.entries()) {
      if (entry.channelId === channelId) {
        clearTimeout(entry.timeout)
        entry.resolve('deny')
        this.pending.delete(id)
      }
    }
  }

  /**
   * Clean up all pending requests (e.g., on full shutdown).
   */
  cleanup(): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timeout)
      entry.resolve('deny')
      this.pending.delete(id)
    }
  }

  /** Number of pending permission requests. */
  get pendingCount(): number {
    return this.pending.size
  }
}
