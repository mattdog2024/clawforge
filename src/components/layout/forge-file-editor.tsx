'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, FileText, Folder, Save, WrapText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CodeEditor } from '@/components/ui/code-editor'
import { useWordWrap } from '@/hooks/use-word-wrap'
import { MarkdownPreview } from '@/components/ui/markdown-preview'
import { useI18n } from '@/components/providers/i18n-provider'

type EditorMode = 'edit' | 'preview'

type FileKind = 'forge-config' | 'forge-subdir' | 'sub-agent' | 'project'

function getFileKind(filename: string): FileKind {
  // Forge files have .claude/ prefix in project mode
  if (filename.startsWith('.claude/')) {
    const inner = filename.slice('.claude/'.length)
    if (inner.startsWith('agents/')) return 'sub-agent'
    if (inner.startsWith('memory/') || inner.startsWith('skills/')) return 'forge-subdir'
    return 'forge-config'
  }
  return 'project'
}

/** Strip .claude/ prefix to get the inner path used by forge APIs */
function toInnerPath(filename: string): string {
  return filename.startsWith('.claude/') ? filename.slice('.claude/'.length) : filename
}

interface ForgeFileEditorProps {
  filename: string
  workspaceId: string
  workspacePath: string
  onClose: () => void
  width?: number
  closing?: boolean
}

export function ForgeFileEditor({ filename, workspaceId, workspacePath, onClose, width = 520, closing = false }: ForgeFileEditorProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<EditorMode>('edit')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const isInitialMount = useRef(true)
  const { wordWrap, toggleWordWrap } = useWordWrap()

  const kind = getFileKind(filename)
  const inner = toInnerPath(filename) // path without .claude/ prefix, used for API calls

  // Build read URL — forge-subdir files (memory/*, skills/*) use the same files API as config files
  const readUrl = kind === 'sub-agent'
    ? `/api/workspaces/${workspaceId}/agents/${encodeURIComponent(inner.replace('agents/', ''))}`
    : kind === 'forge-config' || kind === 'forge-subdir'
      ? `/api/workspaces/${workspaceId}/files?name=${encodeURIComponent(inner)}`
      : `/api/workspaces/${workspaceId}/project-files?path=${encodeURIComponent(filename)}`

  useEffect(() => {
    setLoading(true)
    setDirty(false)
    setMode('edit')

    // Clear the initial mount flag after first render so animation doesn't replay
    if (isInitialMount.current) {
      isInitialMount.current = false
    }

    fetch(readUrl)
      .then(r => r.ok ? r.json() : { content: '' })
      .then(data => {
        setContent(data.content || '')
        setLoading(false)
      })
      .catch(() => { setContent(''); setLoading(false) })
  }, [readUrl])

  const handleSave = useCallback(async () => {
    let url: string
    let body: string

    if (kind === 'sub-agent') {
      url = `/api/workspaces/${workspaceId}/agents/${encodeURIComponent(inner.replace('agents/', ''))}`
      body = JSON.stringify({ content })
    } else if (kind === 'forge-config' || kind === 'forge-subdir') {
      url = `/api/workspaces/${workspaceId}/files`
      body = JSON.stringify({ name: inner, content })
    } else {
      url = `/api/workspaces/${workspaceId}/project-files`
      body = JSON.stringify({ path: filename, content })
    }

    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (res.ok) setDirty(false)
  }, [filename, inner, content, workspaceId, kind])

  // Display name: strip prefix for sub-agents, show basename for project files
  const displayName = kind === 'sub-agent'
    ? inner.replace('agents/', '')
    : kind === 'project'
      ? filename.split('/').pop() || filename
      : inner

  // File path for footer
  const filePath = `${workspacePath}/${filename}`

  return (
    <div
      className={cn("flex flex-col h-full bg-page border-l border-subtle shrink overflow-hidden sidebar-transition", isInitialMount.current && "animate-expand-width")}
      style={{ width, minWidth: closing ? 0 : 280 }}
      onKeyDown={e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault()
          handleSave()
        }
      }}
    >
      {/* Header */}
      <div className="flex items-center h-[52px] px-4 shrink-0 border-b border-subtle gap-2 min-w-0">
        {/* Filename badge */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-active min-w-0 flex-1">
          <FileText size={14} className="text-indigo shrink-0" />
          <span className="text-[13px] font-semibold text-primary truncate">{displayName}</span>
        </div>

        {/* Save + Unsaved */}
        {dirty && (
          <button
            onClick={handleSave}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-medium text-amber hover:bg-surface-hover transition-colors shrink-0"
          >
            <Save size={12} />
            <span>{t('button.save')}</span>
          </button>
        )}

        {/* Edit / Preview toggle */}
        <div className="flex items-center shrink-0">
          {(['edit', 'preview'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setMode(tab)}
              className={cn(
                'px-2.5 py-1 text-[12px] font-medium transition-colors',
                tab === 'edit' ? 'rounded-l-md' : 'rounded-r-md',
                mode === tab
                  ? 'bg-surface-active text-primary'
                  : 'text-tertiary hover:text-secondary'
              )}
            >
              {tab === 'edit' ? 'Source' : 'Preview'}
            </button>
          ))}
        </div>

        {/* Word Wrap toggle */}
        <button
          onClick={toggleWordWrap}
          className={cn('p-1.5 rounded-md hover:bg-surface-hover transition-colors shrink-0', wordWrap ? 'text-muted' : 'text-tertiary')}
          title={wordWrap ? 'Word wrap: on' : 'Word wrap: off'}
        >
          <WrapText size={16} />
        </button>

        {/* Close button */}
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-surface-hover transition-colors shrink-0"
          title={t('button.closeEditor')}
        >
          <X size={16} className="text-tertiary" />
        </button>
      </div>

      {/* Sub-header: file path */}
      <div className="flex items-center h-7 px-4 border-b border-subtle bg-surface shrink-0">
        <Folder size={11} className="text-muted shrink-0" />
        <span className="text-[11px] text-muted ml-1.5 font-mono truncate">{filePath}</span>
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted text-[13px]">{t('status.loading')}</div>
        ) : mode === 'edit' ? (
          <CodeEditor
            value={content}
            onChange={v => { setContent(v); setDirty(true) }}
            language="markdown"
            wordWrap={wordWrap}
          />
        ) : (
          <div className="h-full overflow-y-auto bg-page">
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>
    </div>
  )
}
