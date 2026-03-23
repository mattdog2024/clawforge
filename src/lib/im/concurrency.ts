/**
 * Per-session concurrency control (Layer 2).
 *
 * Ensures only one message per (channelType:chatId) key is processed
 * at a time. Subsequent requests queue behind the current one.
 */

export class SessionLockManager {
  private locks = new Map<string, Promise<void>>()

  /**
   * Acquire a lock for the given session key.
   * If the key is already locked, waits until it's released.
   *
   * Uses a promise chain pattern to avoid TOCTOU race conditions:
   * the new lock promise is set in the map synchronously before awaiting
   * the previous one, so concurrent callers will always chain correctly.
   *
   * @returns A release function that must be called when processing is done.
   */
  async acquire(key: string): Promise<() => void> {
    // Capture the existing lock (if any) before we replace it
    const existingLock = this.locks.get(key)

    // Create a new lock and set it in the map immediately (synchronously)
    // to prevent race conditions between concurrent acquire() calls
    let releaseFn!: () => void
    const lockPromise = new Promise<void>((resolve) => {
      releaseFn = resolve
    })
    this.locks.set(key, lockPromise)

    // Now wait for the previous lock holder to finish
    if (existingLock) {
      try {
        await existingLock
      } catch {
        // Previous holder errored — continue to acquire
      }
    }

    return () => {
      // Only delete if this is still the current lock
      if (this.locks.get(key) === lockPromise) {
        this.locks.delete(key)
      }
      releaseFn()
    }
  }

  /** Check if a key is currently locked. */
  isLocked(key: string): boolean {
    return this.locks.has(key)
  }

  /** Number of active locks. */
  get size(): number {
    return this.locks.size
  }
}
