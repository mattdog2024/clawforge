'use client'

import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
  onResizeEnd?: () => void
  className?: string
}

export function ResizeHandle({ direction, onResize, onResizeEnd, className }: ResizeHandleProps) {
  const dragging = useRef(false)
  const lastPos = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    lastPos.current = direction === 'horizontal' ? e.clientX : e.clientY
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    // Disable sidebar width transitions during drag for instant feedback
    document.documentElement.classList.add('resizing')
  }, [direction])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const pos = direction === 'horizontal' ? e.clientX : e.clientY
      const delta = pos - lastPos.current
      if (delta !== 0) {
        onResize(delta)
        lastPos.current = pos
      }
    }

    const handleMouseUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.documentElement.classList.remove('resizing')
      onResizeEnd?.()
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [direction, onResize, onResizeEnd])

  const isH = direction === 'horizontal'

  return (
    <div
      onMouseDown={handleMouseDown}
      className={cn(
        'shrink-0 relative group z-10',
        isH ? 'w-[4px] cursor-col-resize' : 'h-[4px] cursor-row-resize',
        className
      )}
    >
      {/* Visible line on hover/drag */}
      <div className={cn(
        'absolute transition-colors duration-150',
        'group-hover:bg-indigo/40 group-active:bg-indigo/60',
        isH
          ? 'top-0 bottom-0 left-[1px] w-[2px]'
          : 'left-0 right-0 top-[1px] h-[2px]'
      )} />
    </div>
  )
}
