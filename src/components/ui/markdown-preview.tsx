'use client'

import { MarkdownRenderer } from '@/components/markdown-renderer'

interface MarkdownPreviewProps {
  content: string
}

/**
 * Markdown preview for file editors (Source/Preview toggle).
 * Wraps MarkdownRenderer (react-markdown + remark-gfm + Shiki) with
 * editor-appropriate padding and styling.
 */
export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <div className="p-6">
      <MarkdownRenderer content={content} />
    </div>
  )
}
