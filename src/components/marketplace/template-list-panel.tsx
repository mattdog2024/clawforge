'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, Plus, Package, X, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/components/providers/i18n-provider'
import type { MarketplaceTemplate } from '@/lib/types'

interface ContextMenuState {
  x: number
  y: number
  templateId: string
}

interface TemplateListPanelProps {
  templates: MarketplaceTemplate[]
  loading: boolean
  selectedTemplateId: string | null
  onSelectTemplate: (id: string) => void
  onCreateTemplate: (name: string) => Promise<MarketplaceTemplate>
  onRenameTemplate: (id: string, name: string) => Promise<MarketplaceTemplate>
  onDeleteTemplate: (id: string) => Promise<void>
  onUseTemplate: () => void
}

export function TemplateListPanel({
  templates,
  loading,
  selectedTemplateId,
  onSelectTemplate,
  onCreateTemplate,
  onRenameTemplate,
  onDeleteTemplate,
  onUseTemplate,
}: TemplateListPanelProps) {
  const { t } = useI18n()
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [creating, setCreating] = useState(false)
  const createInputRef = useRef<HTMLInputElement>(null)

  // Close context menu on click
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [contextMenu])

  // Focus create input when creating
  useEffect(() => {
    if (creating) {
      setTimeout(() => createInputRef.current?.focus(), 0)
    }
  }, [creating])

  const handleCreateSubmit = async (name: string) => {
    if (!name.trim()) { setCreating(false); return }
    try {
      const tpl = await onCreateTemplate(name.trim())
      onSelectTemplate(tpl.id)
    } catch { /* ignore */ }
    setCreating(false)
  }

  const handleRenameSubmit = async (id: string, name: string) => {
    if (!name.trim()) { setRenamingId(null); return }
    try {
      await onRenameTemplate(id, name.trim())
    } catch { /* ignore */ }
    setRenamingId(null)
  }

  const filteredTemplates = searchQuery
    ? templates.filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : templates

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-11 px-3.5 border-b border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-primary">{t('marketplace.title')}</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowSearch((v) => !v)}
            className="text-tertiary hover:text-secondary transition-colors"
            title={t('button.search')}
          >
            <Search size={14} />
          </button>
          <button
            onClick={() => setCreating(true)}
            className="text-indigo hover:opacity-80 transition-opacity"
            title={t('marketplace.newTemplate')}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Search */}
      {showSearch && (
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-elevated">
            <Search size={13} className="text-muted shrink-0" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('marketplace.searchTemplates')}
              className="flex-1 bg-transparent text-[12px] text-primary placeholder:text-muted outline-none"
              autoFocus
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-muted hover:text-secondary transition-colors">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Template List */}
      <div className="flex-1 overflow-y-auto min-h-0 px-2 py-1">
        {/* Inline create input */}
        {creating && (
          <div className="flex items-center gap-1.5 h-[32px] px-2 rounded mb-0.5">
            <Package size={14} className="text-indigo shrink-0" />
            <input
              ref={createInputRef}
              type="text"
              className="flex-1 text-[12px] text-primary bg-elevated outline-none border border-indigo/50 rounded px-2 py-1 h-[24px]"
              placeholder={t('marketplace.templateNamePlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateSubmit(e.currentTarget.value)
                if (e.key === 'Escape') setCreating(false)
              }}
              onBlur={(e) => handleCreateSubmit(e.target.value)}
            />
          </div>
        )}

        {loading ? (
          <div className="px-3 py-4 text-center">
            <span className="text-[12px] text-muted">{t('common.loading')}</span>
          </div>
        ) : filteredTemplates.length === 0 && !creating ? (
          <div className="px-3 py-8 text-center">
            <div className="w-10 h-10 rounded-xl bg-elevated flex items-center justify-center mx-auto mb-2">
              <Package size={20} className="text-tertiary" />
            </div>
            <p className="text-[12px] text-muted">{t('marketplace.noTemplates')}</p>
            <p className="text-[11px] text-muted mt-1">{t('marketplace.noTemplatesDesc')}</p>
          </div>
        ) : (
          filteredTemplates.map((template) => (
            <div
              key={template.id}
              onClick={() => { if (renamingId !== template.id) onSelectTemplate(template.id) }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, templateId: template.id })
              }}
              className={cn(
                'flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer mb-0.5 transition-colors',
                template.id === selectedTemplateId ? 'bg-elevated' : 'hover:bg-surface-hover'
              )}
            >
              <Package
                size={14}
                className={cn('shrink-0', template.id === selectedTemplateId ? 'text-indigo' : 'text-tertiary')}
              />
              <div className="flex-1 min-w-0">
                {renamingId === template.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => handleRenameSubmit(template.id, renameValue)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    className="text-[12px] text-primary bg-transparent outline-none border-b border-indigo w-full"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className={cn(
                      'text-[12px] truncate block',
                      template.id === selectedTemplateId ? 'text-primary font-semibold' : 'text-primary font-medium'
                    )}
                  >
                    {template.name}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Use Template Button */}
      {selectedTemplateId && (
        <div className="px-3 py-3 border-t border-subtle shrink-0">
          <button
            onClick={onUseTemplate}
            className="w-full flex items-center justify-center gap-2 h-9 rounded-lg bg-indigo text-white text-[13px] font-medium hover:opacity-90 transition-opacity"
          >
            {t('marketplace.useTemplate')}
          </button>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-surface border border-subtle rounded-lg shadow-lg z-50 py-1 w-[140px] animate-slide-down"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              const tpl = templates.find((t) => t.id === contextMenu.templateId)
              if (tpl) { setRenamingId(tpl.id); setRenameValue(tpl.name) }
              setContextMenu(null)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
          >
            <Pencil size={12} className="text-tertiary" /> {t('contextMenu.rename')}
          </button>
          <button
            onClick={() => {
              onDeleteTemplate(contextMenu.templateId)
              setContextMenu(null)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-coral hover:bg-surface-hover transition-colors"
          >
            <Trash2 size={12} /> {t('contextMenu.delete')}
          </button>
        </div>
      )}
    </div>
  )
}
