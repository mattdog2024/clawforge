'use client'

import { useState, useEffect, useCallback } from 'react'

export interface SubAgentInfo {
  id: string
  filename: string
  name: string
  description: string
  model: string
  enabled: boolean
  disallowedTools: string[]
}

// What's currently selected in the agents panel
export type AgentSelection =
  | { type: 'file'; filename: string }
  | { type: 'subagent'; filename: string }

export function useAgentConfig(workspaceId: string | null) {
  const [subAgents, setSubAgents] = useState<SubAgentInfo[]>([])
  const [configFiles, setConfigFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch sub-agents from .claude/agents/*.md
  const fetchSubAgents = useCallback(async () => {
    if (!workspaceId) { setSubAgents([]); setLoading(false); return }
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents`)
      const data = await res.json()
      setSubAgents(Array.isArray(data) ? data : [])
    } catch {
      setSubAgents([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  // Fetch dynamically discovered config files from .claude/ root
  const fetchConfigFiles = useCallback(async () => {
    if (!workspaceId) { setConfigFiles([]); return }
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/forge-tree`)
      const data = await res.json()
      setConfigFiles(data.configFiles || [])
    } catch {
      setConfigFiles([])
    }
  }, [workspaceId])

  useEffect(() => {
    fetchSubAgents()
    fetchConfigFiles()
  }, [fetchSubAgents, fetchConfigFiles])

  // Read a config file from .claude/
  const readFile = useCallback(async (filename: string): Promise<string> => {
    if (!workspaceId) return ''
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/files?name=${encodeURIComponent(filename)}`)
      if (!res.ok) return ''
      const data = await res.json()
      return data.content || ''
    } catch { return '' }
  }, [workspaceId])

  // Write a config file to .claude/
  const writeFile = useCallback(async (filename: string, content: string) => {
    if (!workspaceId) return
    const res = await fetch(`/api/workspaces/${workspaceId}/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: filename, content }),
    })
    if (!res.ok) throw new Error('Failed to save file')
  }, [workspaceId])

  // Read a sub-agent file
  const readSubAgent = useCallback(async (filename: string): Promise<string> => {
    if (!workspaceId) return ''
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${encodeURIComponent(filename)}`)
      if (!res.ok) return ''
      const data = await res.json()
      return data.content || ''
    } catch { return '' }
  }, [workspaceId])

  // Write a sub-agent file
  const writeSubAgent = useCallback(async (filename: string, content: string) => {
    if (!workspaceId) return
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${encodeURIComponent(filename)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) throw new Error('Failed to save sub-agent file')
  }, [workspaceId])

  // Update a sub-agent's frontmatter field (e.g., model, disallowedTools)
  const updateSubAgentField = useCallback(async (filename: string, field: string, value: string | string[]) => {
    if (!workspaceId) return
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${encodeURIComponent(filename)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    if (!res.ok) throw new Error('Failed to update sub-agent field')
    // Update local state only on success
    setSubAgents(prev => prev.map(a =>
      a.filename === filename ? { ...a, [field]: value } : a
    ))
  }, [workspaceId])

  // Create a new config file in .claude/ root
  const createConfigFile = useCallback(async (filename: string) => {
    if (!workspaceId) return
    const res = await fetch(`/api/workspaces/${workspaceId}/fs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filename, type: 'file', content: `# ${filename.replace('.md', '')}\n\n` }),
    })
    if (!res.ok) throw new Error('Failed to create file')
    setConfigFiles(prev => [...prev, filename].sort())
  }, [workspaceId])

  // Delete a config file from .claude/ root
  const deleteConfigFile = useCallback(async (filename: string) => {
    if (!workspaceId) return
    const res = await fetch(`/api/workspaces/${workspaceId}/fs?path=${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error('Failed to delete file')
    setConfigFiles(prev => prev.filter(f => f !== filename))
  }, [workspaceId])

  // Rename a config file in .claude/ root
  const renameConfigFile = useCallback(async (oldName: string, newName: string) => {
    if (!workspaceId) return
    const res = await fetch(`/api/workspaces/${workspaceId}/fs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath: oldName, newPath: newName }),
    })
    if (!res.ok) throw new Error('Failed to rename file')
    setConfigFiles(prev => prev.map(f => f === oldName ? newName : f).sort())
  }, [workspaceId])

  return {
    subAgents,
    configFiles,
    loading,
    readFile,
    writeFile,
    readSubAgent,
    writeSubAgent,
    updateSubAgentField,
    createConfigFile,
    deleteConfigFile,
    renameConfigFile,
    refreshSubAgents: fetchSubAgents,
    refreshConfigFiles: fetchConfigFiles,
  }
}
