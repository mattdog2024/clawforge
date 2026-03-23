/**
 * Slash command definitions and registry for Forge chat input.
 */

export type CommandCategory = 'built-in' | 'skill' | 'agent' | 'mcp'

export interface SlashCommand {
  /** Command name without the leading `/` */
  name: string
  /** Short description shown in autocomplete */
  description: string
  /** Category for grouping in the menu */
  category: CommandCategory
  /** Whether the command accepts an argument (e.g. /rename <title>) */
  hasArg?: boolean
  /** Placeholder text for the argument */
  argPlaceholder?: string
}

/** Built-in commands that Forge provides out of the box */
export const BUILT_IN_COMMANDS: SlashCommand[] = [
  { name: 'clear', description: 'Clear all messages in this session', category: 'built-in' },
  { name: 'compact', description: 'Compact conversation to save context', category: 'built-in' },
  { name: 'cost', description: 'Show token usage for this session', category: 'built-in' },
  { name: 'diff', description: 'Show git diff for current workspace', category: 'built-in' },
  { name: 'export', description: 'Export session as Markdown', category: 'built-in' },
  { name: 'init', description: 'Initialize workspace config files (CLAUDE.md, SOUL.md, etc.)', category: 'built-in' },
  { name: 'memory', description: 'Open MEMORY.md for current workspace', category: 'built-in' },
  { name: 'model', description: 'Switch model', category: 'built-in', hasArg: true, argPlaceholder: 'model name' },
  { name: 'rename', description: 'Rename current session', category: 'built-in', hasArg: true, argPlaceholder: 'new title' },
  { name: 'save-as-template', description: 'Save .claude/ as marketplace template', category: 'built-in', hasArg: true, argPlaceholder: 'template name' },
  { name: 'stop', description: 'Stop current response', category: 'built-in' },
  { name: 'workspace', description: 'Switch project workspace', category: 'built-in' },
]

/**
 * Filter commands by a query string (the part after `/`).
 * No limit — autocomplete is the sole discovery mechanism (no /help).
 * Scroll handles overflow.
 */
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase()
  const matched = commands.filter((cmd) => cmd.name.toLowerCase().startsWith(q))

  // Sort by category priority: built-in → skill → agent → mcp, then alphabetically
  const categoryOrder: Record<CommandCategory, number> = {
    'built-in': 0,
    skill: 1,
    agent: 2,
    mcp: 3,
  }
  matched.sort((a, b) => {
    const catDiff = categoryOrder[a.category] - categoryOrder[b.category]
    if (catDiff !== 0) return catDiff
    return a.name.localeCompare(b.name)
  })

  return matched
}

/** Category display labels */
export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  'built-in': 'Built-in',
  skill: 'Skill',
  agent: 'Agent',
  mcp: 'MCP',
}
