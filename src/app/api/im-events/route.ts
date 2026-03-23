/**
 * SSE endpoint for real-time IM Bridge → Desktop sync.
 *
 * The desktop UI opens an EventSource to this endpoint.
 * When BridgeManager or IM commands emit events, they are
 * forwarded to all connected clients via Server-Sent Events.
 */

import { onImEvent } from '@/lib/im/im-events'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const encoder = new TextEncoder()

  // Cleanup function — set by start(), called by cancel()
  let cleanup: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      // Send initial keepalive so the client knows the connection is alive
      controller.enqueue(encoder.encode(': keepalive\n\n'))

      // Subscribe to IM events
      const unsubscribe = onImEvent((eventType, eventData) => {
        try {
          const payload = JSON.stringify({ type: eventType, ...eventData })
          controller.enqueue(encoder.encode(`event: ${eventType}\ndata: ${payload}\n\n`))
        } catch {
          // Client disconnected — will be cleaned up by cancel()
        }
      })

      // Keepalive every 30s to prevent proxy/browser timeouts
      const keepaliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          // Client disconnected
          clearInterval(keepaliveInterval)
        }
      }, 30_000)

      // Store cleanup for cancel()
      cleanup = () => {
        unsubscribe()
        clearInterval(keepaliveInterval)
      }
    },

    cancel() {
      // Client disconnected — clean up listener and interval
      if (cleanup) cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
