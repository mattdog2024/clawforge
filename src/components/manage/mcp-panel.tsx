'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Search, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/components/providers/i18n-provider'
import type { McpServer } from '@/lib/types'

interface McpPanelProps {
  servers: McpServer[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, newName: string) => void
}

interface ContextMenuState {
  x: number
  y: number
  serverId: string
  serverName: string
}

export function McpPanel({ servers, selectedId, onSelect, onCreate, onDelete, onRename }: McpPanelProps) {
  const { t } = useI18n()
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)

  // Close context menu on click
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [contextMenu])

  const handleRenameSubmit = (id: string, newName: string) => {
    const trimmed = newName.trim()
    if (trimmed && trimmed !== renaming?.value) {
      onRename(id, trimmed)
    }
    setRenaming(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-11 px-3.5 border-b border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-primary">
          {t('mcp.servers')} ({servers.length})
        </span>
        <div className="flex items-center gap-2">
          <Search size={14} className="text-tertiary" />
          <button
            onClick={onCreate}
            className="text-indigo hover:opacity-80 transition-opacity"
            title={t('button.addServer')}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {servers.map((server) => {
          const statusColor = server.status === 'connected' ? 'bg-green' : server.status === 'error' ? 'bg-coral' : 'bg-muted'
          const statusLabel = server.status === 'connected' ? t('im.connected') : server.status === 'error' ? t('im.error') : t('im.disconnected')
          const isRenaming = renaming?.id === server.id
          return (
            <div
              key={server.id}
              onClick={() => onSelect(server.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setContextMenu({ x: e.clientX, y: e.clientY, serverId: server.id, serverName: server.name })
              }}
              className={cn(
                'flex items-center gap-2.5 h-9 px-3.5 cursor-pointer group transition-colors rounded',
                selectedId === server.id ? 'bg-elevated' : 'hover:bg-surface-hover'
              )}
            >
              <div className={cn('w-2 h-2 rounded-full shrink-0', statusColor)} />
              <div className="flex-1 min-w-0">
                {isRenaming ? (
                  <RenameInput
                    defaultValue={server.name}
                    onSubmit={(name) => handleRenameSubmit(server.id, name)}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <span className={cn(
                    'text-[12px] truncate block',
                    selectedId === server.id ? 'text-primary font-semibold' : 'text-primary font-medium'
                  )}>
                    {server.name}
                  </span>
                )}
              </div>
              {!isRenaming && (
                <span className={cn(
                  'text-[10px] shrink-0',
                  server.status === 'connected' ? 'text-green' : server.status === 'error' ? 'text-coral' : 'text-muted'
                )}>{statusLabel}</span>
              )}
            </div>
          )
        })}
        {servers.length === 0 && (
          <div className="px-3 py-6 text-center">
            <span className="text-[12px] text-muted">{t('status.noServers')}</span>
          </div>
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
              setRenaming({ id: contextMenu.serverId, value: contextMenu.serverName })
              setContextMenu(null)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
          >
            <Pencil size={12} className="text-tertiary" /> {t('common.rename')}
          </button>
          <button
            onClick={() => {
              onDelete(contextMenu.serverId)
              setContextMenu(null)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-coral hover:bg-surface-hover transition-colors"
          >
            <Trash2 size={12} /> {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  )
}

function RenameInput({
  defaultValue,
  onSubmit,
  onCancel,
}: {
  defaultValue: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  return (
    <input
      ref={inputRef}
      defaultValue={defaultValue}
      className="w-full text-[12px] text-primary bg-transparent outline-none border-b border-indigo"
      onBlur={(e) => onSubmit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit(e.currentTarget.value)
        if (e.key === 'Escape') onCancel()
      }}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
