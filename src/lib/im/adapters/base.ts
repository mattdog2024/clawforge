/**
 * Abstract base class for platform adapters (Layer 1).
 *
 * Adapters handle platform-specific I/O only:
 *   - Connection management (start/stop)
 *   - Message consumption (pull model via consumeOne)
 *   - Message sending
 *   - Permission UI rendering
 *
 * All business logic (policy, routing, agent invocation, delivery)
 * lives in higher layers.
 */

import type { ChannelType, IncomingMessage, OutboundMessage, ImPermissionRequest } from '../types'

export abstract class ChannelAdapter {
  /** Platform identifier */
  abstract readonly channelType: ChannelType

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start the adapter with platform credentials.
   * Must be idempotent — calling start on a running adapter should reconnect.
   */
  abstract start(config: Record<string, string>): Promise<void>

  /** Gracefully stop the adapter and release all resources. */
  abstract stop(): Promise<void>

  /** Whether the adapter is currently running and can consume/send messages. */
  abstract isRunning(): boolean

  // ---------------------------------------------------------------------------
  // Message consumption (pull model)
  // ---------------------------------------------------------------------------

  /**
   * Wait for and return the next inbound message.
   *
   * The Bridge Manager calls this in a tight loop. Implementations should
   * block (with timeout) until a message is available or the signal is aborted.
   *
   * @returns The next message, or null if the wait timed out with no message.
   * @throws If the underlying connection is lost (triggers reconnect in L2).
   */
  abstract consumeOne(signal: AbortSignal): Promise<IncomingMessage | null>

  // ---------------------------------------------------------------------------
  // Outbound messaging
  // ---------------------------------------------------------------------------

  /**
   * Send a message to the platform.
   * @returns The platform message ID (for edit/delete), or undefined.
   */
  abstract send(msg: OutboundMessage): Promise<string | undefined>

  /**
   * Send an image to the platform.
   */
  abstract sendImage(chatId: string, imageBuffer: Buffer, caption?: string): Promise<void>

  /**
   * Send a typing indicator to the platform.
   */
  abstract sendTypingIndicator(chatId: string): Promise<void>

  // ---------------------------------------------------------------------------
  // Permission UI
  // ---------------------------------------------------------------------------

  /**
   * Render a permission prompt on the platform (buttons, text command, etc.).
   */
  abstract sendPermissionPrompt(req: ImPermissionRequest): Promise<void>

  /**
   * Register a callback for when the user responds to a permission prompt.
   * The adapter must call this callback with (requestId, 'allow'|'deny').
   */
  abstract onPermissionResponse(
    callback: (requestId: string, decision: 'allow' | 'deny') => void,
  ): void

  // ---------------------------------------------------------------------------
  // Config validation
  // ---------------------------------------------------------------------------

  /**
   * Validate platform credentials before attempting to connect.
   */
  abstract validateConfig(config: Record<string, string>): { valid: boolean; error?: string }
}
