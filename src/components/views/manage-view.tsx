'use client'

import { useState, useCallback } from 'react'
import { Zap, Bot, Plug } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/components/providers/i18n-provider'
import { useMcpServers } from '@/hooks/use-mcp-servers'
import { useAgentConfig } from '@/hooks/use-agent-config'
import type { AgentSelection } from '@/hooks/use-agent-config'
import { GLOBAL_WORKSPACE_ID } from '@/lib/types'
import { SkillsPanel } from '@/components/manage/skills-panel'
import { SkillFileEditor } from '@/components/manage/skill-file-editor'
import { AgentsPanel } from '@/components/manage/agents-panel'
import { AgentEditor } from '@/components/manage/agent-editor'
import { McpPanel } from '@/components/manage/mcp-panel'
import { McpEditor } from '@/components/manage/mcp-editor'
import { ResizeHandle } from '@/components/ui/resize-handle'
type ManageTab = 'skills' | 'agents' | 'mcp'

const TABS: { id: ManageTab; label: string; icon: React.ElementType }[] = [
  { id: 'skills', label: 'Skills', icon: Zap },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'mcp', label: 'MCP', icon: Plug },
]

interface ManageViewProps {
  workspaceId?: string | null
  workspacePath?: string
}

export function ManageView({ workspaceId = GLOBAL_WORKSPACE_ID, workspacePath = '~/.claude' }: ManageViewProps) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<ManageTab>('skills')
  const [selectedSkillPath, setSelectedSkillPath] = useState<string | null>(null)
  const [agentSelection, setAgentSelection] = useState<AgentSelection | null>(null)
  const [selectedMcpId, setSelectedMcpId] = useState<string | null>(null)
  const [listWidth, setListWidth] = useState(220)

  // Always use global workspace for management
  const globalWsId = GLOBAL_WORKSPACE_ID

  const { servers, createServer, updateServer, deleteServer } = useMcpServers()
  const {
    subAgents,
    configFiles,
    readFile,
    writeFile,
    readSubAgent,
    writeSubAgent,
    updateSubAgentField,
    createConfigFile,
    deleteConfigFile,
    renameConfigFile,
  } = useAgentConfig(globalWsId)

  // Agent handlers
  const handleCreateConfigFile = useCallback(async (filename: string) => {
    await createConfigFile(filename)
    setAgentSelection({ type: 'file', filename })
  }, [createConfigFile])

  // MCP handlers
  const handleCreateMcp = useCallback(async () => {
    const server = await createServer({ name: 'New Server', protocol: 'stdio' })
    setSelectedMcpId(server.id)
  }, [createServer])

  const handleDeleteMcp = useCallback(async (id: string) => {
    await deleteServer(id)
    if (selectedMcpId === id) setSelectedMcpId(null)
  }, [deleteServer, selectedMcpId])

  const handleRenameMcp = useCallback(async (id: string, newName: string) => {
    await updateServer(id, { name: newName })
  }, [updateServer])

  const handleSaveMcp = useCallback(async (id: string, updates: Record<string, unknown>) => {
    await updateServer(id, updates)
  }, [updateServer])

  const handleListResize = useCallback((delta: number) => {
    setListWidth(w => Math.max(160, Math.min(600, w + delta)))
  }, [])

  const selectedMcp = servers.find(s => s.id === selectedMcpId) || null

  return (
    <div className="flex h-full">
      {/* Category Nav */}
      <div className="w-[100px] border-r border-subtle bg-surface pt-4 shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 w-full h-9 px-4 transition-colors',
              activeTab === tab.id
                ? 'bg-surface-active text-primary'
                : 'hover:bg-surface-hover text-secondary'
            )}
          >
            <tab.icon size={16} className={activeTab === tab.id ? 'text-indigo' : 'text-tertiary'} />
            <span className={cn('text-[13px]', activeTab === tab.id ? 'font-semibold' : 'font-medium')}>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* List Panel */}
      <div className="border-r border-subtle shrink-0 overflow-hidden sidebar-transition" style={{ width: listWidth }} key={activeTab}>
        <div className="h-full animate-fade-in">
          {activeTab === 'skills' && (
            <SkillsPanel
              onSelectFile={setSelectedSkillPath}
              selectedPath={selectedSkillPath}
            />
          )}
          {activeTab === 'agents' && (
            <AgentsPanel
              configFiles={configFiles}
              selection={agentSelection}
              onSelect={setAgentSelection}
              onCreateConfigFile={handleCreateConfigFile}
              onDeleteConfigFile={deleteConfigFile}
              onRenameConfigFile={renameConfigFile}
            />
          )}
          {activeTab === 'mcp' && (
            <McpPanel
              servers={servers}
              selectedId={selectedMcpId}
              onSelect={setSelectedMcpId}
              onCreate={handleCreateMcp}
              onDelete={handleDeleteMcp}
              onRename={handleRenameMcp}
            />
          )}
        </div>
      </div>

      {/* Resize handle between list and editor */}
      <ResizeHandle direction="horizontal" onResize={handleListResize} />

      {/* Editor / Preview */}
      <div className="flex-1 overflow-hidden min-w-0">
        {activeTab === 'skills' && selectedSkillPath && (
          <SkillFileEditor filePath={selectedSkillPath} />
        )}
        {activeTab === 'agents' && agentSelection && (
          <AgentEditor
            selection={agentSelection}
            workspacePath={workspacePath}
            subAgents={subAgents}
            readFile={readFile}
            writeFile={writeFile}
            readSubAgent={readSubAgent}
            writeSubAgent={writeSubAgent}
            updateSubAgentField={updateSubAgentField}
          />
        )}
        {activeTab === 'mcp' && selectedMcp && (
          <McpEditor server={selectedMcp} onSave={handleSaveMcp} onDelete={handleDeleteMcp} />
        )}

        {/* Empty state */}
        {((activeTab === 'skills' && !selectedSkillPath) ||
          (activeTab === 'agents' && !agentSelection) ||
          (activeTab === 'mcp' && !selectedMcp)) && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-elevated flex items-center justify-center mx-auto mb-3">
                {activeTab === 'skills' && <Zap size={24} className="text-tertiary" />}
                {activeTab === 'agents' && <Bot size={24} className="text-tertiary" />}
                {activeTab === 'mcp' && <Plug size={24} className="text-tertiary" />}
              </div>
              <p className="text-[13px] text-secondary">
                {activeTab === 'skills' && t('manage.selectFile')}
                {activeTab === 'agents' && t('manage.selectConfig')}
                {activeTab === 'mcp' && t('manage.selectServer')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
