'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'dark' | 'light' | 'system'

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: 'dark' | 'light'
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark')
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark')

  // On mount: load theme from DB (via /api/settings) first, fall back to localStorage.
  // This fixes the issue where localStorage is cleared between Electron restarts
  // (different port = different origin = empty localStorage).
  useEffect(() => {
    const applyTheme = (saved: string | null) => {
      if (saved === 'dark' || saved === 'light' || saved === 'system') {
        setThemeState(saved)
      }
    }

    // Try DB first (authoritative, survives restarts)
    fetch('/api/settings')
      .then(r => r.json())
      .then((data: Record<string, string>) => {
        if (data.theme === 'dark' || data.theme === 'light' || data.theme === 'system') {
          applyTheme(data.theme)
        } else {
          // Fall back to localStorage if DB has no theme yet
          applyTheme(localStorage.getItem('forge-theme'))
        }
      })
      .catch(() => {
        // Network error: fall back to localStorage
        applyTheme(localStorage.getItem('forge-theme'))
      })
  }, [])

  // Apply theme to DOM and sync to localStorage whenever theme changes
  useEffect(() => {
    // Keep localStorage in sync as a fast-read cache
    localStorage.setItem('forge-theme', theme)

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const resolved = mq.matches ? 'dark' : 'light'
      setResolvedTheme(resolved)
      document.documentElement.setAttribute('data-theme', resolved)

      const handler = (e: MediaQueryListEvent) => {
        const r = e.matches ? 'dark' : 'light'
        setResolvedTheme(r)
        document.documentElement.setAttribute('data-theme', r)
      }
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }

    const resolved = theme === 'light' ? 'light' : 'dark'
    setResolvedTheme(resolved)
    document.documentElement.setAttribute('data-theme', resolved)
  }, [theme])

  const setTheme = (t: Theme) => {
    setThemeState(t)
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
