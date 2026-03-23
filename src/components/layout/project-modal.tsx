'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, X, Folder, Trash2, FolderOpen, Check, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/components/providers/i18n-provider'
import type { Session, Workspace } from '@/lib/types'

interface ProjectModalProps {
  isOpen: boolean
  onClose: () => void
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  sessions: Session[]
  onSwitchWorkspace: (id: string) => void
  onOpenProjectFolder: () => void
  onRemoveProject: (id: string) => Promise<void>
  onRefresh?: () => void
}

export function ProjectModal({
  isOpen,
  onClose,
  workspaces,
  activeWorkspace,
  sessions,
  onSwitchWorkspace,
  onOpenProjectFolder,
  onRemoveProject,
  onRefresh,
}: ProjectModalProps) {
  const { t } = useI18n()
  const [searchQuery, setSearchQuery] = useState('')
  const [hoveredProject, setHoveredProject] = useState<string | null>(null)

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Refresh workspace list and reset search when opening
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('')
      onRefresh?.()
    }
  }, [isOpen])

  // Count sessions per workspace
  const sessionCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    sessions.forEach((s) => {
      counts[s.workspace] = (counts[s.workspace] || 0) + 1
    })
    return counts
  }, [sessions])

  // Filter workspaces by search
  const filteredWorkspaces = useMemo(() => {
    if (!searchQuery) return workspaces
    const q = searchQuery.toLowerCase()
    return workspaces.filter(
      (ws) => ws.name.toLowerCase().includes(q) || ws.path.toLowerCase().includes(q)
    )
  }, [workspaces, searchQuery])


  const handleSelectProject = useCallback((id: string) => {
    // Check if this workspace folder exists
    const ws = workspaces.find(w => w.id === id)
    if (ws && ws.exists === false) {
      // Show confirm dialog for missing folder
      if (window.confirm(t('project.folderDeletedConfirm'))) {
        onRemoveProject(id)
      }
      return
    }
    onSwitchWorkspace(id)
    onClose()
  }, [onSwitchWorkspace, onClose, workspaces, t, onRemoveProject])

  const handleOpenFolder = useCallback(() => {
    onClose()
    onOpenProjectFolder()
  }, [onClose, onOpenProjectFolder])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Modal */}
      <div
        className="relative w-[540px] bg-surface border border-subtle rounded-xl shadow-xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-subtle">
          <h2 className="text-[16px] font-semibold text-primary">{t('sidebar.projects')}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-surface-hover transition-colors"
          >
            <X size={16} className="text-tertiary" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-subtle">
            <Search size={14} className="text-muted shrink-0" />
            <input
              autoFocus
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('search.projects')}
              className="flex-1 bg-transparent text-[13px] text-primary placeholder:text-muted outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-muted hover:text-secondary transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Project List */}
        <div className="h-[380px] overflow-y-auto px-3">
          {/* Project Workspaces */}
          {filteredWorkspaces.map((ws) => {
            const folderMissing = ws.exists === false
            return (
              <div
                key={ws.id}
                onClick={() => handleSelectProject(ws.id)}
                onMouseEnter={() => setHoveredProject(ws.id)}
                onMouseLeave={() => setHoveredProject(null)}
                className={cn(
                  'flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors mb-0.5 group',
                  folderMissing
                    ? 'opacity-50'
                    : ws.id === activeWorkspace?.id
                      ? 'bg-elevated'
                      : 'hover:bg-surface-hover'
                )}
              >
                {folderMissing ? (
                  <AlertTriangle size={16} className="text-amber shrink-0" />
                ) : (
                  <Folder size={16} className="text-amber shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-[13px] font-semibold truncate',
                      folderMissing ? 'text-muted' : 'text-primary'
                    )}>
                      {ws.name}
                    </span>
                    {ws.id === activeWorkspace?.id && !folderMissing && (
                      <Check size={14} className="text-indigo shrink-0" />
                    )}
                  </div>
                  <span className="text-[11px] text-muted truncate block">
                    {ws.path}
                    {folderMissing && (
                      <span className="text-amber"> · {t('project.folderMissing')}</span>
                    )}
                    {!folderMissing && ` · ${sessionCounts[ws.id] || 0} sessions`}
                  </span>
                </div>
                {hoveredProject === ws.id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveProject(ws.id)
                    }}
                    className="p-1.5 rounded-md hover:bg-surface-active transition-colors shrink-0 animate-fade-in"
                  >
                    <Trash2 size={13} className="text-muted hover:text-coral" />
                  </button>
                )}
              </div>
            )
          })}

          {/* Empty state */}
          {filteredWorkspaces.length === 0 && (
            <div className="flex items-center justify-center h-full text-[13px] text-muted">
              No matching projects
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-subtle">
          <button
            onClick={handleOpenFolder}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg border border-subtle hover:bg-surface-hover transition-colors"
          >
            <FolderOpen size={14} className="text-indigo" />
            <span className="text-[13px] font-medium text-indigo">
              {t('sidebar.openProject')}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
