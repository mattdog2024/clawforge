'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

interface CustomSelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  size?: 'sm' | 'md'
}

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  className,
  size = 'md',
}: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  // Calculate dropdown position from trigger button
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const dropdownHeight = 140 // approximate max height for 3 items
    const spaceBelow = window.innerHeight - rect.bottom
    // If not enough space below, position above the trigger
    const top = spaceBelow < dropdownHeight
      ? rect.top - dropdownHeight - 4
      : rect.bottom + 4
    setPos({ top, left: rect.left, width: rect.width })
  }, [])

  // Recalculate position when opening
  useEffect(() => {
    if (open) updatePosition()
  }, [open, updatePosition])

  // Close on outside click (check both trigger and dropdown)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on scroll or resize (position becomes stale)
  useEffect(() => {
    if (!open) return
    const handleScroll = (e: Event) => {
      // Don't close if scrolling inside the dropdown itself
      if (dropdownRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const handleResize = () => setOpen(false)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [open])

  const selected = options.find((o) => o.value === value)
  const h = size === 'sm' ? 'h-9' : 'h-10'

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full flex items-center justify-between px-4 rounded-lg bg-elevated border border-subtle text-[13px] outline-none transition-colors',
          open ? 'border-indigo' : 'hover:border-subtle',
          h,
        )}
      >
        <span className={selected ? 'text-primary' : 'text-muted'}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown
          size={14}
          className={cn('text-tertiary shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          className="fixed bg-surface border border-subtle rounded-lg shadow-lg py-1 max-h-[200px] overflow-y-auto animate-slide-down"
          style={{ top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
              className={cn(
                'flex items-center justify-between w-full px-4 py-2 text-[13px] transition-colors',
                opt.value === value
                  ? 'text-primary bg-surface-active'
                  : 'text-secondary hover:bg-surface-hover',
              )}
            >
              <span>{opt.label}</span>
              {opt.value === value && <Check size={14} className="text-green shrink-0" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
