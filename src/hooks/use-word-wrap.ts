'use client'

import { useState, useCallback } from 'react'

const STORAGE_KEY = 'forge-editor-word-wrap'

function getStored(): boolean {
  if (typeof window === 'undefined') return true
  const v = localStorage.getItem(STORAGE_KEY)
  return v === null ? true : v === 'true'
}

export function useWordWrap() {
  const [wordWrap, setWordWrap] = useState(getStored)

  const toggleWordWrap = useCallback(() => {
    setWordWrap(prev => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  return { wordWrap, toggleWordWrap } as const
}
