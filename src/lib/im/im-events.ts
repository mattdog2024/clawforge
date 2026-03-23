/**
 * IM Event Emitter — simple pub/sub for real-time desktop sync.
 *
 * BridgeManager and IM commands publish events here.
 * The SSE endpoint subscribes and forwards them to the desktop UI.
 */

export type ImEventType = 'im:message' | 'im:command' | 'im:session-changed'

export interface ImEventData {
  sessionId?: string
  workspaceId?: string
  command?: string
}

export type ImEventListener = (type: ImEventType, data: ImEventData) => void

const listeners = new Set<ImEventListener>()

/**
 * Subscribe to IM events. Returns an unsubscribe function.
 */
export function onImEvent(listener: ImEventListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Emit an IM event to all subscribers.
 */
export function emitImEvent(type: ImEventType, data: ImEventData): void {
  listeners.forEach(l => l(type, data))
}
