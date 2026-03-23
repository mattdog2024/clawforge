'use client'

import { useState, useEffect, useMemo } from 'react'
import { BUILT_IN_COMMANDS, type SlashCommand } from '@/lib/slash-commands'
import { GLOBAL_WORKSPACE_ID } from '@/lib/types'

interface SkillTreeNode {
  name: string
  type: 'file' | 'folder'
  path: string
  children?: SkillTreeNode[]
  enabled?: boolean
}

interface AgentTreeNode {
  name: string
  type: 'file' | 'folder'
  path: string
}

interface McpServerRow {
  id: string
  name: string
  enabled: number
}

/** Extract top-level skill folder names (folders with enabled !== false) */
function extractSkillNames(tree: SkillTreeNode[]): string[] {
  return tree
    .filter((n) => n.type === 'folder' && n.enabled !== false)
    .map((n) => n.name)
}

/** Extract agent .md file names (without extension) */
function extractAgentNames(tree: AgentTreeNode[]): string[] {
  return tree
    .filter((n) => n.type === 'file' && n.name.endsWith('.md'))
    .map((n) => n.name.replace(/\.md$/, ''))
}

/**
 * Hook that provides all available slash commands:
 * built-in + skills + agents + MCP servers.
 */
export function useSlashCommands(workspaceId: string | null) {
  const [skillNames, setSkillNames] = useState<string[]>([])
  const [agentNames, setAgentNames] = useState<string[]>([])
  const [mcpNames, setMcpNames] = useState<string[]>([])

  useEffect(() => {
    const wsId = workspaceId || GLOBAL_WORKSPACE_ID
    const isGlobal = wsId === GLOBAL_WORKSPACE_ID

    // Fetch skills — project + global, deduplicated
    const skillFetches = [
      fetch(`/api/workspaces/${wsId}/skills-tree`).then((r) => r.json()).then((d) => extractSkillNames(d.tree || [])).catch(() => [] as string[]),
    ]
    if (!isGlobal) {
      skillFetches.push(
        fetch(`/api/workspaces/${GLOBAL_WORKSPACE_ID}/skills-tree`).then((r) => r.json()).then((d) => extractSkillNames(d.tree || [])).catch(() => [] as string[])
      )
    }
    Promise.all(skillFetches).then((results) => {
      const merged = [...new Set(results.flat())]
      merged.sort((a, b) => a.localeCompare(b))
      setSkillNames(merged)
    })

    // Fetch agents — project + global, deduplicated
    const agentFetches = [
      fetch(`/api/workspaces/${wsId}/agents-tree`).then((r) => r.json()).then((d) => extractAgentNames(d.tree || [])).catch(() => [] as string[]),
    ]
    if (!isGlobal) {
      agentFetches.push(
        fetch(`/api/workspaces/${GLOBAL_WORKSPACE_ID}/agents-tree`).then((r) => r.json()).then((d) => extractAgentNames(d.tree || [])).catch(() => [] as string[])
      )
    }
    Promise.all(agentFetches).then((results) => {
      const merged = [...new Set(results.flat())]
      merged.sort((a, b) => a.localeCompare(b))
      setAgentNames(merged)
    })

    // Fetch MCP servers
    fetch('/api/mcp')
      .then((r) => r.json())
      .then((data: McpServerRow[]) => {
        setMcpNames(
          data
            .filter((s) => s.enabled !== 0)
            .map((s) => s.name)
        )
      })
      .catch(() => setMcpNames([]))
  }, [workspaceId])

  const commands = useMemo<SlashCommand[]>(() => {
    const all: SlashCommand[] = [...BUILT_IN_COMMANDS]

    for (const name of skillNames) {
      all.push({
        name,
        description: `Run skill: ${name}`,
        category: 'skill',
      })
    }

    for (const name of agentNames) {
      all.push({
        name,
        description: `Delegate to agent: ${name}`,
        category: 'agent',
      })
    }

    for (const name of mcpNames) {
      all.push({
        name: `mcp:${name}`,
        description: `MCP server: ${name}`,
        category: 'mcp',
      })
    }

    return all
  }, [skillNames, agentNames, mcpNames])

  return commands
}
