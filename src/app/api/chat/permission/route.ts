import { resolvePermission, type PermissionDecision } from '@/lib/sdk/permission-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { requestId?: string; decision?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { requestId, decision } = body
  if (!requestId || !decision) {
    return new Response(JSON.stringify({ error: 'requestId and decision required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const validDecisions: PermissionDecision[] = ['allow', 'allow_session', 'deny']
  if (!validDecisions.includes(decision as PermissionDecision)) {
    return new Response(JSON.stringify({ error: 'Invalid decision. Must be allow, allow_session, or deny' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const resolved = resolvePermission(requestId, decision as PermissionDecision)

  // Return 200 even if already resolved (e.g. auto-resolved by Allow Session).
  // The frontend may send decisions for all grouped requests, but the backend
  // auto-resolves siblings — this is expected, not an error.
  return new Response(JSON.stringify({ ok: true, resolved }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
