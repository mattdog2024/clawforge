import { useState, useEffect, type RefObject } from 'react'

export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width)
      setWidth((prev) => (prev === w ? prev : w))
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return width
}
