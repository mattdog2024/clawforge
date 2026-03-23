/**
 * Simple cron expression matcher.
 * Format: minute hour dayOfMonth month dayOfWeek
 * Supports: *, * /N, N, N-M, N,M,O
 */

export function matchesCron(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return false

  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(), // 0 = Sunday
  ]

  return parts.every((field, i) => matchField(field, values[i]))
}

function matchField(field: string, value: number): boolean {
  if (field === '*') return true

  // Comma-separated values
  const segments = field.split(',')

  for (const segment of segments) {
    // Step: */N or N-M/S
    if (segment.includes('/')) {
      const [range, stepStr] = segment.split('/')
      const step = parseInt(stepStr, 10)
      if (isNaN(step) || step <= 0) continue

      if (range === '*') {
        if (value % step === 0) return true
      } else if (range.includes('-')) {
        const [a, b] = range.split('-').map(Number)
        if (value >= a && value <= b && (value - a) % step === 0) return true
      }
      continue
    }

    // Range: N-M
    if (segment.includes('-')) {
      const [a, b] = segment.split('-').map(Number)
      if (value >= a && value <= b) return true
      continue
    }

    // Exact value
    if (parseInt(segment, 10) === value) return true
  }

  return false
}
