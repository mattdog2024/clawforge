'use client'

import { Sun, Moon } from 'lucide-react'
import { useTheme } from '@/components/providers/theme-provider'

export function TitleBar() {
  const { resolvedTheme, setTheme } = useTheme()

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <div className="titlebar-drag flex items-center h-[38px] px-4 bg-surface border-b border-subtle shrink-0">
      {/* macOS traffic lights occupy ~70px on the left */}
      <div className="w-[70px]" />
      <div className="flex-1" />
      <button
        onClick={toggleTheme}
        className="titlebar-no-drag p-1.5 rounded-md hover:bg-surface-hover transition-colors"
        title={resolvedTheme === 'dark' ? '切换到浅色' : '切换到深色'}
      >
        {resolvedTheme === 'dark' ? (
          <Sun size={14} className="text-tertiary" />
        ) : (
          <Moon size={14} className="text-tertiary" />
        )}
      </button>
    </div>
  )
}
