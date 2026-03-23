import { getDb } from '@/lib/db'

let lastSessionCleanupTime = 0

/**
 * Auto-clean old sessions based on session_retention setting.
 * Throttled: runs at most once per hour (per process).
 * Safe to call on every request — no-ops if throttled or set to 'permanent'.
 */
export function runSessionCleanup(): void {
  const now = Date.now()
  if (now - lastSessionCleanupTime < 3600_000) return
  lastSessionCleanupTime = now

  const db = getDb()
  const sessionRetention = db.prepare("SELECT value FROM settings WHERE key = 'session_retention'").get() as { value: string } | undefined
  const retentionValue = sessionRetention?.value || 'permanent'

  if (retentionValue === 'permanent') return

  const retentionDays = parseInt(retentionValue, 10)
  if (!(retentionDays > 0)) return

  const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString()
  const oldSessions = db.prepare('SELECT id FROM sessions WHERE updated_at < ?').all(cutoff) as { id: string }[]

  if (oldSessions.length > 0) {
    const deleteMessages = db.prepare('DELETE FROM messages WHERE session_id = ?')
    const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?')
    const cleanup = db.transaction(() => {
      for (const s of oldSessions) {
        deleteMessages.run(s.id)
        deleteSession.run(s.id)
      }
    })
    cleanup()
    console.log(`[session-cleanup] Cleaned ${oldSessions.length} expired sessions (retention: ${retentionDays}d)`)
  }
}
