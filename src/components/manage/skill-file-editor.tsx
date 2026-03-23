'use client'

import { useState, useEffect, useCallback } from 'react'
import { Folder, Save, WrapText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CodeEditor } from '@/components/ui/code-editor'
import { useWordWrap } from '@/hooks/use-word-wrap'
import { MarkdownPreview } from '@/components/ui/markdown-preview'
import { useI18n } from '@/components/providers/i18n-provider'
import { GLOBAL_WORKSPACE_ID } from '@/lib/types'

type EditorMode = 'edit' | 'preview' | 'split'

interface SkillFileEditorProps {
  /** Relative path within skills/, e.g. "my-skill/SKILL.md" */
  filePath: string
}

export function SkillFileEditor({ filePath }: SkillFileEditorProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<EditorMode>('edit')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const { wordWrap, toggleWordWrap } = useWordWrap()

  const workspaceId = GLOBAL_WORKSPACE_ID
  const forgePath = `skills/${filePath}`

  useEffect(() => {
    setLoading(true)
    setDirty(false)
    fetch(`/api/workspaces/${workspaceId}/files?name=${encodeURIComponent(forgePath)}`)
      .then(r => r.ok ? r.json() : { content: '' })
      .then(data => { setContent(data.content || ''); setLoading(false) })
      .catch(() => { setContent(''); setLoading(false) })
  }, [forgePath, workspaceId])

  const handleSave = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: forgePath, content }),
    })
    if (res.ok) setDirty(false)
  }, [content, forgePath, workspaceId])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  const displayName = filePath.split('/').pop() || filePath

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      {/* Header */}
      <div className="flex items-center justify-between h-11 px-6 border-b border-subtle shrink-0">
        <span className="text-[16px] font-semibold text-primary truncate">{displayName}</span>
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-medium text-amber hover:bg-surface-hover transition-colors"
            >
              <Save size={12} />
              <span>{t('button.save')}</span>
            </button>
          )}
          <div className="flex items-center">
            {(['edit', 'preview', 'split'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setMode(tab)}
                className={cn(
                  'px-2.5 py-1 text-[12px] font-medium transition-colors',
                  tab === 'edit' ? 'rounded-l-md' : tab === 'split' ? 'rounded-r-md' : '',
                  mode === tab
                    ? 'bg-surface-active text-primary'
                    : 'text-tertiary hover:text-secondary'
                )}
              >
                {tab === 'edit' ? 'Source' : tab === 'preview' ? 'Preview' : 'Split'}
              </button>
            ))}
          </div>
          <button
            onClick={toggleWordWrap}
            className={cn('p-1.5 rounded-md hover:bg-surface-hover transition-colors', wordWrap ? 'text-muted' : 'text-tertiary')}
            title={wordWrap ? 'Word wrap: on' : 'Word wrap: off'}
          >
            <WrapText size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {loading ? (
          <div className="flex items-center justify-center flex-1 text-muted text-[13px]">{t('status.loading')}</div>
        ) : (
          <>
            {(mode === 'edit' || mode === 'split') && (
              <div className={cn('flex-1 overflow-hidden', mode === 'split' && 'border-r border-subtle')}>
                <CodeEditor
                  value={content}
                  onChange={v => { setContent(v); setDirty(true) }}
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
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center h-8 px-6 border-t border-subtle shrink-0 bg-surface">
        <Folder size={12} className="text-muted" />
        <span className="text-[11px] text-muted ml-1.5 font-mono truncate">~/.claude/{forgePath}</span>
        <div className="flex-1" />
        <span className="text-[11px] text-muted">{t('hint.cmdSToSave')}</span>
      </div>
    </div>
  )
}
