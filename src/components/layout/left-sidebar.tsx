'use client'

import { useState, useEffect } from 'react'
import {
  MessageSquare,
  Wrench,
  Radio,
  Clock,
  Store,
  Settings,
  Search,
  Plus,
  PanelLeftClose,
  PanelLeft,
  Trash2,
  X,
  FolderCode,
  FolderOpen,
  Pencil,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/components/providers/i18n-provider'
import type { Session, View, Workspace } from '@/lib/types'

interface LeftSidebarProps {
  activeView: View
  onViewChange: (view: View) => void
  collapsed: boolean
  onToggleCollapse: () => void
  sessions: Session[]
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onDeleteSession: (id: string) => void
  onRenameSession?: (id: string, title: string) => void
  sessionsLoading: boolean
  activeWorkspace: Workspace | null
  onOpenProjectModal: () => void
  width?: number
}

const NAV_ITEMS: { id: View; i18nKey: string; icon: React.ElementType }[] = [
  { id: 'chat', i18nKey: 'sidebar.chat', icon: MessageSquare },
  { id: 'manage', i18nKey: 'sidebar.manage', icon: Wrench },
  { id: 'im', i18nKey: 'sidebar.im', icon: Radio },
  { id: 'schedule', i18nKey: 'sidebar.schedule', icon: Clock },
  { id: 'marketplace', i18nKey: 'sidebar.marketplace', icon: Store },
  { id: 'settings', i18nKey: 'sidebar.settings', icon: Settings },
]

function formatTime(dateStr: string): string {
  const date = new Date(dateStr + 'Z')
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay === 1) return 'Yesterday'
  return `${diffDay}d ago`
}

export function LeftSidebar({
  activeView,
  onViewChange,
  collapsed,
  onToggleCollapse,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  sessionsLoading,
  activeWorkspace,
  onOpenProjectModal,
  width = 240,
}: LeftSidebarProps) {
  const { t } = useI18n()
  const [hoveredSession, setHoveredSession] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingSession, setRenamingSession] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [contextMenu])

  return (
    <div
      className="flex flex-col bg-surface border-r border-subtle shrink-0 overflow-hidden relative sidebar-transition"
      style={{ width: collapsed ? 52 : width }}
    >
      {/* ── Collapsed content ── */}
      <div
        className={cn(
          'absolute inset-0 flex flex-col transition-opacity duration-200',
          collapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        <div className="flex items-center justify-center h-[52px] shrink-0">
          <button
            onClick={onToggleCollapse}
            className="p-2 rounded-md hover:bg-surface-hover transition-colors"
          >
            <PanelLeft size={16} className="text-tertiary" />
          </button>
        </div>
        <div className="flex-1" />
        <div className="flex flex-col items-center gap-1 py-3">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={cn(
                'p-2 rounded-lg transition-colors',
                activeView === item.id ? 'bg-surface-active' : 'hover:bg-surface-hover'
              )}
              title={t(item.i18nKey)}
            >
              <item.icon size={18} className={cn(activeView === item.id ? 'text-indigo' : 'text-tertiary')} />
            </button>
          ))}
        </div>
      </div>

      {/* ── Expanded content ── */}
      <div
        className={cn(
          'flex flex-col h-full transition-opacity duration-200',
          collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
        )}
      >
        {/* Project Header — static display, no dropdown */}
        <div className="flex items-center gap-2 h-[52px] px-4 border-b border-subtle shrink-0">
          <button
            onClick={onToggleCollapse}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-hover transition-colors shrink-0"
          >
            <PanelLeftClose size={16} className="text-tertiary" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <FolderCode size={16} className="text-indigo shrink-0" />
            <span className="text-[14px] font-semibold text-primary truncate">
              {activeWorkspace?.name || 'No Project'}
            </span>
          </div>
        </div>

        {/* Action Area — New Session + Folder button + Search */}
        <div className="px-3 py-1 space-y-1">
          {/* Button Row: New Session + Project Modal */}
          <div className="flex items-center gap-1">
            <button
              onClick={onNewSession}
              className="flex-1 flex items-center justify-center gap-2 h-9 rounded-lg border border-subtle text-indigo hover:bg-surface-hover transition-colors"
            >
              <Plus size={14} />
              <span className="text-[13px] font-medium">{t('sidebar.newSession')}</span>
            </button>
            <button
              onClick={onOpenProjectModal}
              className="w-9 h-9 rounded-lg border border-subtle flex items-center justify-center hover:bg-surface-hover transition-colors shrink-0"
              title={t('button.projects')}
            >
              <FolderOpen size={14} className="text-tertiary" />
            </button>
          </div>

          {/* Search Sessions */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-subtle">
            <Search size={14} className="text-muted shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('search.sessions')}
              className="flex-1 bg-transparent text-[13px] text-primary placeholder:text-muted outline-none"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-muted hover:text-secondary transition-colors">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto px-2">
          {sessionsLoading ? (
            <div className="px-3 py-4 text-center">
              <span className="text-[12px] text-muted">{t('common.loading')}</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <span className="text-[12px] text-muted">{t('sidebar.noSessions')}</span>
            </div>
          ) : (
            sessions
              .filter((s) => !searchQuery || s.title.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((session) => (
              <div
                key={session.id}
                onClick={() => { if (renamingSession !== session.id) onSelectSession(session.id) }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenu({ id: session.id, x: e.clientX, y: e.clientY })
                }}
                onMouseEnter={() => setHoveredSession(session.id)}
                onMouseLeave={() => setHoveredSession(null)}
                className={cn(
                  'flex items-center gap-1 px-3 py-2 rounded-lg cursor-pointer mb-0.5 group transition-colors',
                  session.id === activeSessionId ? 'bg-elevated' : 'hover:bg-surface-hover'
                )}
              >
                <div className="flex-1 min-w-0">
                  {renamingSession === session.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => {
                        if (renameValue.trim() && onRenameSession) onRenameSession(session.id, renameValue.trim())
                        setRenamingSession(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.currentTarget.blur() }
                        if (e.key === 'Escape') { setRenamingSession(null) }
                      }}
                      className="text-[13px] text-primary font-medium bg-transparent outline-none border-b border-indigo w-full"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className={cn(
                        'text-[13px] truncate block',
                        session.id === activeSessionId ? 'text-primary font-semibold' : 'text-primary font-medium'
                      )}
                    >
                      {session.title}
                    </span>
                  )}
                  <span className="text-[11px] text-muted">{formatTime(session.updatedAt)}</span>
                </div>
                {hoveredSession === session.id && renamingSession !== session.id && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id) }}
                    className="p-1 rounded hover:bg-surface-active transition-colors shrink-0 animate-fade-in"
                  >
                    <Trash2 size={12} className="text-muted hover:text-coral" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="fixed bg-surface border border-subtle rounded-lg shadow-lg z-50 py-1 w-[140px] animate-slide-down"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => {
                const s = sessions.find((s) => s.id === contextMenu.id)
                if (s) { setRenamingSession(s.id); setRenameValue(s.title) }
                setContextMenu(null)
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
            >
              <Pencil size={12} className="text-tertiary" /> {t('contextMenu.rename')}
            </button>
            <button
              onClick={() => { onDeleteSession(contextMenu.id); setContextMenu(null) }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-coral hover:bg-surface-hover transition-colors"
            >
              <Trash2 size={12} /> {t('contextMenu.delete')}
            </button>
          </div>
        )}

        {/* Navigation */}
        <div className="border-t border-subtle px-2 py-2">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={cn(
                'flex items-center gap-2.5 w-full px-3 h-9 rounded-lg transition-colors',
                activeView === item.id ? 'bg-surface-active' : 'hover:bg-surface-hover'
              )}
            >
              <item.icon size={18} className={cn(activeView === item.id ? 'text-indigo' : 'text-tertiary')} />
              <span className={cn(
                'text-[13px]',
                activeView === item.id ? 'text-primary font-semibold' : 'text-secondary font-medium'
              )}>
                {t(item.i18nKey)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
