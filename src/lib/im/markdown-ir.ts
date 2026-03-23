/**
 * Markdown Intermediate Representation (IR) system.
 *
 * Parses Claude's markdown response into a platform-agnostic IR,
 * then renders it into platform-specific formats:
 *   - Telegram: MarkdownV2
 *   - Discord: Discord-flavored markdown
 *   - Feishu: Plain text (Feishu has limited markdown support)
 */

import type { ChannelType } from './types'

// ---------------------------------------------------------------------------
// IR Types
// ---------------------------------------------------------------------------

export interface MarkdownNode {
  type: 'text' | 'code_block' | 'inline_code' | 'bold' | 'italic' | 'link' | 'heading' | 'newline'
  content: string
  language?: string    // for code_block
  url?: string         // for link
  level?: number       // for heading (1-6)
}

// ---------------------------------------------------------------------------
// Parser: Markdown → IR
// ---------------------------------------------------------------------------

/**
 * Parse markdown text into an array of IR nodes.
 * Handles: code blocks, inline code, bold, italic, links, headings, plain text.
 */
export function parseMarkdown(text: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = []
  const lines = text.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Code block: ```lang\n...\n```
    if (line.startsWith('```')) {
      const language = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      nodes.push({
        type: 'code_block',
        content: codeLines.join('\n'),
        language: language || undefined,
      })
      i++ // skip closing ```
      continue
    }

    // Heading: # ## ### etc
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/)
    if (headingMatch) {
      nodes.push({
        type: 'heading',
        content: headingMatch[2],
        level: headingMatch[1].length,
      })
      i++
      continue
    }

    // Parse inline elements
    if (line.length > 0) {
      parseInline(line, nodes)
    }
    nodes.push({ type: 'newline', content: '' })
    i++
  }

  // Remove trailing newlines
  while (nodes.length > 0 && nodes[nodes.length - 1].type === 'newline') {
    nodes.pop()
  }

  return nodes
}

/**
 * Parse inline markdown elements within a line.
 */
function parseInline(text: string, nodes: MarkdownNode[]): void {
  // Regex pattern for inline elements
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[([^\]]+)\]\(([^)]+)\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    // Push preceding plain text
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }

    if (match[1]) {
      // Inline code
      nodes.push({ type: 'inline_code', content: match[1].slice(1, -1) })
    } else if (match[2]) {
      // Bold
      nodes.push({ type: 'bold', content: match[2].slice(2, -2) })
    } else if (match[3]) {
      // Italic
      nodes.push({ type: 'italic', content: match[3].slice(1, -1) })
    } else if (match[4]) {
      // Link
      nodes.push({ type: 'link', content: match[5], url: match[6] })
    }

    lastIndex = match.index + match[0].length
  }

  // Push remaining text
  if (lastIndex < text.length) {
    nodes.push({ type: 'text', content: text.slice(lastIndex) })
  }
}

// ---------------------------------------------------------------------------
// Renderers: IR → Platform-specific format
// ---------------------------------------------------------------------------

/**
 * Render IR nodes for a specific platform.
 */
export function renderForPlatform(text: string, channelType: ChannelType): string {
  // For now, return the original text with minimal transformation.
  // Full IR parsing is available but platform-specific escaping
  // can cause issues with complex markdown — use conservative approach.
  switch (channelType) {
    case 'telegram':
      return renderForTelegram(text)
    case 'discord':
      return text // Discord natively supports markdown
    case 'feishu':
      return renderForFeishu(text)
    default:
      return text
  }
}

/**
 * Render for Telegram (Markdown parse mode).
 * Telegram's Markdown mode is limited — keep it simple.
 */
function renderForTelegram(text: string): string {
  // Telegram Markdown mode supports:
  //   *bold*, _italic_, `code`, ```code block```, [link](url)
  // But doesn't support nested formatting or complex markdown.
  // Return as-is — Telegram handles standard markdown reasonably well.
  return text
}

/**
 * Render for Feishu.
 * Feishu text messages have very limited formatting support.
 * Strip markdown formatting for clean text, preserve code blocks.
 */
function renderForFeishu(text: string): string {
  const nodes = parseMarkdown(text)
  const parts: string[] = []

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        parts.push(node.content)
        break
      case 'code_block':
        parts.push(`\n[Code${node.language ? ` (${node.language})` : ''}]\n${node.content}\n`)
        break
      case 'inline_code':
        parts.push(`\`${node.content}\``)
        break
      case 'bold':
        parts.push(node.content)
        break
      case 'italic':
        parts.push(node.content)
        break
      case 'link':
        parts.push(`${node.content} (${node.url})`)
        break
      case 'heading':
        parts.push(`\n${'='.repeat(node.level || 1)} ${node.content}`)
        break
      case 'newline':
        parts.push('\n')
        break
    }
  }

  return parts.join('')
}

// ---------------------------------------------------------------------------
// Full IR-based renderers (for future use)
// ---------------------------------------------------------------------------

/**
 * Render IR nodes to Telegram MarkdownV2.
 * Reserved for when we need full MarkdownV2 support.
 */
export function renderNodesToTelegramV2(nodes: MarkdownNode[]): string {
  const parts: string[] = []

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        parts.push(escapeTelegramV2(node.content))
        break
      case 'code_block':
        parts.push(`\`\`\`${node.language || ''}\n${node.content}\n\`\`\``)
        break
      case 'inline_code':
        parts.push(`\`${node.content}\``)
        break
      case 'bold':
        parts.push(`*${escapeTelegramV2(node.content)}*`)
        break
      case 'italic':
        parts.push(`_${escapeTelegramV2(node.content)}_`)
        break
      case 'link':
        parts.push(`[${escapeTelegramV2(node.content)}](${node.url})`)
        break
      case 'heading':
        parts.push(`*${escapeTelegramV2(node.content)}*`)
        break
      case 'newline':
        parts.push('\n')
        break
    }
  }

  return parts.join('')
}

/** Escape special characters for Telegram MarkdownV2 */
function escapeTelegramV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}

/**
 * Render IR nodes to Discord markdown.
 */
export function renderNodesToDiscord(nodes: MarkdownNode[]): string {
  const parts: string[] = []

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        parts.push(node.content)
        break
      case 'code_block':
        parts.push(`\`\`\`${node.language || ''}\n${node.content}\n\`\`\``)
        break
      case 'inline_code':
        parts.push(`\`${node.content}\``)
        break
      case 'bold':
        parts.push(`**${node.content}**`)
        break
      case 'italic':
        parts.push(`*${node.content}*`)
        break
      case 'link':
        parts.push(`[${node.content}](${node.url})`)
        break
      case 'heading':
        parts.push(`${'#'.repeat(node.level || 1)} ${node.content}`)
        break
      case 'newline':
        parts.push('\n')
        break
    }
  }

  return parts.join('')
}
