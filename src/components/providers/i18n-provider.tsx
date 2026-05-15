'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { type Locale, setLocale as setGlobalLocale, t as translate } from '@/lib/i18n'

interface I18nContextType {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string) => string
}

const I18nContext = createContext<I18nContextType>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
})

export function I18nProvider({ children, initialLocale = 'en' }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  // On mount: load language from DB (via /api/settings) first, fall back to localStorage.
  // This fixes the issue where localStorage is cleared between Electron restarts
  // (different port = different origin = empty localStorage).
  useEffect(() => {
    const applyLocale = (saved: string | null) => {
      if (saved === 'zh' || saved === 'en') {
        setLocaleState(saved)
        setGlobalLocale(saved)
        document.documentElement.lang = saved === 'zh' ? 'zh' : 'en'
      }
    }
    // Try DB first (authoritative, survives restarts)
    fetch('/api/settings')
      .then(r => r.json())
      .then((data: Record<string, string>) => {
        if (data.language === 'zh' || data.language === 'en') {
          applyLocale(data.language)
        } else {
          applyLocale(localStorage.getItem('forge-language'))
        }
      })
      .catch(() => {
        applyLocale(localStorage.getItem('forge-language'))
      })
  }, [])

  useEffect(() => {
    setGlobalLocale(locale)
    // Update html lang attribute
    document.documentElement.lang = locale === 'zh' ? 'zh' : 'en'
    // Keep localStorage in sync as a fast-read cache
    localStorage.setItem('forge-language', locale)
  }, [locale])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    setGlobalLocale(l)
  }, [])

  const t = useCallback((key: string) => translate(key), [locale]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
