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

  useEffect(() => {
    setGlobalLocale(locale)
    // Update html lang attribute
    document.documentElement.lang = locale === 'zh' ? 'zh' : 'en'
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
