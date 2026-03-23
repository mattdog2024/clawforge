import { NextResponse } from 'next/server'
import { isClaudeCliAuthenticated, getClaudeCliAccountInfo } from '@/lib/provider'

export async function GET() {
  const authenticated = isClaudeCliAuthenticated()
  const account = authenticated ? getClaudeCliAccountInfo() : null
  return NextResponse.json({ authenticated, account })
}
