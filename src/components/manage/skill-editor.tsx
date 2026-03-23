'use client'

import { useState, useEffect, useCallback } from 'react'
import { Folder, WrapText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CodeEditor } from '@/components/ui/code-editor'
import { useWordWrap } from '@/hooks/use-word-wrap'
import { MarkdownPreview } from '@/components/ui/markdown-preview'
import { useI18n } from '@/components/providers/i18n-provider'
import type { Skill } from '@/lib/types'

type EditorMode = 'edit' | 'preview' | 'split'

interface SkillEditorProps {
  skill: Skill
  onSave: (id: string, updates: { name?: string; description?: string; content?: string; enabled?: boolean }) => void
}

export function SkillEditor({ skill, onSave }: SkillEditorProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<EditorMode>('edit')
  const { wordWrap, toggleWordWrap } = useWordWrap()
  const [content, setContent] = useState(skill.content)
  const [name, setName] = useState(skill.name)
  const [description, setDescription] = useState(skill.description)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setContent(skill.content)
    setName(skill.name)
    setDescription(skill.description)
    setDirty(false)
  }, [skill.id, skill.content, skill.name, skill.description])

  const handleSave = useCallback(() => {
    onSave(skill.id, { name, description, content })
    setDirty(false)
  }, [skill.id, name, description, content, onSave])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      {/* Editor Header */}
      <div className="px-6 pt-4 pb-3 border-b border-subtle shrink-0">
        <div className="flex items-center justify-between">
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setDirty(true) }}
            className="text-[20px] font-semibold text-primary bg-transparent outline-none font-heading tracking-tight"
          />
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-secondary">{skill.enabled ? t('common.enabled') : t('common.disabled')}</span>
            <button
              onClick={() => onSave(skill.id, { enabled: !skill.enabled })}
              className={cn(
                'w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer flex',
                skill.enabled ? 'bg-green justify-end' : 'bg-muted/40 justify-start'
              )}
            >
              <div className="w-4 h-4 rounded-full bg-white" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4 mt-2">
          <span className="text-[12px] text-tertiary">{t('info.addedByUser')}</span>
          <input
            value={description}
            onChange={(e) => { setDescription(e.target.value); setDirty(true) }}
            placeholder={t('input.addDescription')}
            className="text-[12px] text-secondary bg-transparent outline-none flex-1"
          />
          {dirty && <div className="w-2 h-2 rounded-full bg-amber shrink-0" title="Unsaved changes" />}
        </div>
      </div>

      {/* Toolbar - Underline Tabs */}
      <div className="flex items-center h-10 px-6 border-b border-subtle shrink-0">
        {(['edit', 'preview', 'split'] as const).map((tab) => {
          const tabLabels: Record<string, string> = {
            edit: t('editor.edit'),
            preview: t('editor.preview'),
            split: t('editor.split'),
          }
          return (
            <button
              key={tab}
              onClick={() => setMode(tab)}
              className={cn(
                'h-full px-3.5 text-[12px] font-medium transition-colors border-b-2',
                mode === tab
                  ? 'text-primary font-semibold border-indigo'
                  : 'text-tertiary hover:text-secondary border-transparent'
              )}
            >
              {tabLabels[tab]}
            </button>
          )
        })}
        <div className="flex-1" />
        <button
          onClick={toggleWordWrap}
          className={cn('p-1.5 rounded-md hover:bg-surface-hover transition-colors', wordWrap ? 'text-muted' : 'text-tertiary')}
          title={wordWrap ? 'Word wrap: on' : 'Word wrap: off'}
        >
          <WrapText size={14} />
        </button>
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-hidden flex">
        {(mode === 'edit' || mode === 'split') && (
          <div className={cn('flex-1 overflow-hidden', mode === 'split' && 'border-r border-subtle')}>
            <CodeEditor
              value={content}
              onChange={(v) => { setContent(v); setDirty(true) }}
              language="markdown"
              wordWrap={wordWrap}
            />
          </div>
        )}
        {(mode === 'preview' || mode === 'split') && (
          <div className="flex-1 overflow-y-auto bg-page">
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center h-8 px-6 border-t border-subtle shrink-0 bg-surface">
        <Folder size={12} className="text-muted" />
        <span className="text-[11px] text-muted ml-1.5 font-mono">
          skills/{skill.name.toLowerCase().replace(/\s+/g, '-')}/SKILL.md
        </span>
        <div className="flex-1" />
        <span className="text-[11px] text-muted">{t('hint.cmdSToSave')}</span>
      </div>
    </div>
  )
}
