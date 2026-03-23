'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  className?: string
  language?: 'markdown' | 'json' | 'text'
  wordWrap?: boolean
}

export function CodeEditor({ value, onChange, readOnly = false, className, language = 'text', wordWrap = true }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const [lineCount, setLineCount] = useState(1)
  const [lineHeights, setLineHeights] = useState<number[]>([])

  useEffect(() => {
    setLineCount(value.split('\n').length)
  }, [value])

  // Measure actual rendered height of each logical line when word wrap is on.
  // A hidden mirror div replicates the textarea's content width and font styles
  // so that each logical line wraps identically, giving us accurate heights.
  useEffect(() => {
    if (!wordWrap) {
      setLineHeights([])
      return
    }

    const measure = () => {
      const textarea = textareaRef.current
      const mirror = mirrorRef.current
      if (!textarea || !mirror) return

      const style = getComputedStyle(textarea)
      const contentWidth = textarea.clientWidth
        - parseFloat(style.paddingLeft)
        - parseFloat(style.paddingRight)

      if (contentWidth <= 0) return

      mirror.style.width = `${contentWidth}px`

      const lines = value.split('\n')
      mirror.innerHTML = ''
      const heights: number[] = []

      for (const line of lines) {
        const div = document.createElement('div')
        // Zero-width space ensures empty lines still get measured height
        div.textContent = line || '\u200B'
        mirror.appendChild(div)
        heights.push(div.offsetHeight)
      }

      setLineHeights(heights)
    }

    const rafId = requestAnimationFrame(measure)

    // Re-measure when textarea resizes (e.g. panel drag, window resize, scrollbar appear/disappear)
    const observer = new ResizeObserver(() => requestAnimationFrame(measure))
    if (textareaRef.current) observer.observe(textareaRef.current)

    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [value, wordWrap])

  const syncScroll = useCallback(() => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab key inserts 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart
      const end = el.selectionEnd
      const newValue = value.slice(0, start) + '  ' + value.slice(end)
      onChange(newValue)
      // Restore cursor position after React re-render
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2
      })
    }
  }, [value, onChange])

  // Use variable heights only when measurement matches current line count
  const useVariableHeights = wordWrap && lineHeights.length === lineCount

  return (
    <div className={cn('flex h-full bg-elevated rounded-none overflow-hidden', className)}>
      {/* Hidden mirror div — replicates textarea content width & font to measure wrapped line heights */}
      <div
        ref={mirrorRef}
        aria-hidden
        className="text-[13px] leading-[20px] font-mono"
        style={{
          position: 'absolute',
          left: -9999,
          top: 0,
          visibility: 'hidden',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
        }}
      />

      {/* Line Numbers */}
      <div
        ref={lineNumbersRef}
        className="shrink-0 overflow-hidden select-none py-4 pr-2 text-right"
        style={{ width: lineCount > 999 ? 56 : lineCount > 99 ? 48 : 40 }}
      >
        {useVariableHeights
          ? lineHeights.map((height, i) => (
              <div
                key={i + 1}
                className="text-[13px] leading-[20px] font-mono text-muted px-2"
                style={{ height }}
              >
                {i + 1}
              </div>
            ))
          : Array.from({ length: lineCount }, (_, i) => (
              <div
                key={i + 1}
                className="text-[13px] leading-[20px] font-mono text-muted px-2"
              >
                {i + 1}
              </div>
            ))
        }
      </div>

      {/* Divider */}
      <div className="w-px bg-subtle shrink-0" />

      {/* Editor */}
      <div className="flex-1 relative overflow-hidden">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={handleKeyDown}
          readOnly={readOnly}
          spellCheck={false}
          className={cn(
            'w-full h-full p-4 pl-3 bg-transparent text-[13px] leading-[20px] font-mono outline-none resize-none',
            'text-primary placeholder:text-muted caret-indigo',
            readOnly && 'cursor-default'
          )}
          style={wordWrap ? undefined : { whiteSpace: 'nowrap', overflowX: 'auto' }}
          placeholder={readOnly ? '' : 'Start typing...'}
        />
      </div>
    </div>
  )
}
