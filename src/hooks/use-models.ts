import { useState, useEffect } from 'react'
import type { ModelEntry } from '@/lib/models'

/**
 * Hook to fetch all available models (built-in + custom).
 * All UI components that show model pickers should use this hook
 * instead of hardcoded arrays.
 */
export function useModels() {
  const [models, setModels] = useState<ModelEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/models')
        if (!cancelled && res.ok) {
          const data = await res.json()
          setModels(data)
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  return { models, loading }
}
