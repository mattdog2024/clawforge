/**
 * Streaming preview state machine (Layer 2).
 *
 * Manages the lifecycle of a streaming response:
 *   idle → typing → draft → final
 *
 * Each chat has its own StreamingState instance.
 */

import type { StreamingPhase } from './types'

export class StreamingState {
  private phase: StreamingPhase = 'idle'
  private draftMessageId?: string
  private lastDraftTime = 0
  private lastDraftText = ''

  /** Minimum interval (ms) between draft updates to avoid API spam. */
  static readonly DRAFT_THROTTLE_MS = 800

  /**
   * Transition to the next phase.
   * @returns The previous phase.
   */
  transition(next: StreamingPhase): StreamingPhase {
    const prev = this.phase
    this.phase = next
    return prev
  }

  getPhase(): StreamingPhase {
    return this.phase
  }

  getDraftMessageId(): string | undefined {
    return this.draftMessageId
  }

  setDraftMessageId(id: string): void {
    this.draftMessageId = id
  }

  /**
   * Check if enough time has passed since the last draft update.
   * Updates the timestamp if yes.
   */
  shouldThrottleDraft(): boolean {
    const now = Date.now()
    if (now - this.lastDraftTime < StreamingState.DRAFT_THROTTLE_MS) {
      return true
    }
    this.lastDraftTime = now
    return false
  }

  /**
   * Check if the draft text has changed since the last update.
   * Prevents sending identical edits that Telegram/Discord reject,
   * which would cause fall-through to sending duplicate new messages.
   */
  isDraftUnchanged(text: string): boolean {
    if (text === this.lastDraftText) return true
    this.lastDraftText = text
    return false
  }

  /** Reset state for a new conversation turn. */
  reset(): void {
    this.phase = 'idle'
    this.draftMessageId = undefined
    this.lastDraftTime = 0
    this.lastDraftText = ''
  }
}
