/**
 * Load agent definitions from .claude/agents/*.md files.
 * Each file uses YAML frontmatter + markdown body format.
 */

import fs from 'fs'
import path from 'path'
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'
import { getWorkspacePath } from '@/lib/workspace-fs'
import { parseFrontmatter } from '@/lib/sdk/frontmatter'

/**
 * Load all sub-agent definitions from .claude/agents/*.md files.
 */
export function loadAgentsFromFiles(workspaceId: string): Record<string, AgentDefinition> {
  let forgePath: string
  try {
    forgePath = getWorkspacePath(workspaceId)
  } catch {
    return {}
  }

  const agentsDir = path.join(forgePath, 'agents')
  if (!fs.existsSync(agentsDir)) return {}

  const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'))
  const agents: Record<string, AgentDefinition> = {}

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8')
      const { frontmatter, body } = parseFrontmatter(content)

      // Skip disabled agents
      if (frontmatter.enabled === false) continue

      const id = path.basename(file, '.md')
      agents[id] = {
        description: frontmatter.description || frontmatter.name || id,
        prompt: body || `You are ${frontmatter.name || id}. Complete the delegated task concisely.`,
        model: frontmatter.model || 'inherit',
        ...(frontmatter.disallowedTools && frontmatter.disallowedTools.length > 0 && {
          disallowedTools: frontmatter.disallowedTools,
        }),
      }
    } catch (err) {
      console.warn('[forge] Failed to load agent file:', path.join(agentsDir, file), err)
    }
  }

  return agents
}
