'use client'

import { useState, useEffect, useCallback } from 'react'
import { Folder, WrapText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CustomSelect } from '@/components/ui/custom-select'
import { CodeEditor } from '@/components/ui/code-editor'
import { useWordWrap } from '@/hooks/use-word-wrap'
import { useI18n } from '@/components/providers/i18n-provider'
import type { McpServer, McpProtocol } from '@/lib/types'

type EditMode = 'form' | 'json'

interface McpEditorProps {
  server: McpServer
  onSave: (id: string, updates: Record<string, unknown>) => void
  onDelete: (id: string) => void
}

interface FieldDef {
  key: string
  label: string
  placeholder: string
  type?: 'input' | 'textarea'
}

function getProtocolFields(t: (key: string) => string): Record<McpProtocol, FieldDef[]> {
  return {
    stdio: [
      { key: 'command', label: t('form.command'), placeholder: 'npx @anthropic/fs-server' },
      { key: 'args', label: t('form.arguments'), placeholder: '--root\n~/projects', type: 'textarea' },
    ],
    sse: [
      { key: 'url', label: t('form.url'), placeholder: 'http://localhost:3001/sse' },
      { key: 'headers', label: t('form.headers'), placeholder: '{"Authorization": "Bearer ..."}' },
    ],
    http: [
      { key: 'url', label: t('form.url'), placeholder: 'http://localhost:3001/mcp' },
      { key: 'headers', label: t('form.headers'), placeholder: '{"Authorization": "Bearer ..."}' },
    ],
  }
}

/**
 * Convert stored config (args: string[], env: Record<string,string>) to form-friendly
 * flat strings for display in the form inputs.
 */
function configToFormState(cfg: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(cfg)) {
    if (k === 'args' && Array.isArray(v)) {
      result[k] = v.join('\n')
    } else if (k === 'env' && typeof v === 'object' && v !== null && !Array.isArray(v)) {
      result[k] = Object.entries(v as Record<string, string>)
        .map(([ek, ev]) => `${ek}=${ev}`)
        .join('\n')
    } else {
      result[k] = String(v ?? '')
    }
  }
  return result
}

/**
 * Convert form-state flat strings back to the structured config the SDK expects.
 * - args: split by newlines into string[]
 * - env: parse KEY=VALUE lines into Record<string, string>
 */
function formStateToConfig(formState: Record<string, string>, protocol: McpProtocol): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(formState)) {
    if (protocol === 'stdio' && k === 'args') {
      const lines = v.split('\n').map(l => l.trim()).filter(Boolean)
      if (lines.length > 0) result[k] = lines
    } else if (protocol === 'stdio' && k === 'env') {
      const env: Record<string, string> = {}
      for (const line of v.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx > 0) {
          env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim()
        }
      }
      if (Object.keys(env).length > 0) result[k] = env
    } else if (v) {
      result[k] = v
    }
  }
  return result
}

export function McpEditor({ server, onSave, onDelete }: McpEditorProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<EditMode>('form')
  const [name, setName] = useState(server.name)
  const [protocol, setProtocol] = useState<McpProtocol>(server.protocol)
  const [config, setConfig] = useState<Record<string, string>>(() => configToFormState(server.config))
  const [jsonStr, setJsonStr] = useState(JSON.stringify(server.config, null, 2))
  const [dirty, setDirty] = useState(false)
  const { wordWrap, toggleWordWrap } = useWordWrap()

  useEffect(() => {
    setName(server.name)
    setProtocol(server.protocol)
    setConfig(configToFormState(server.config))
    setJsonStr(JSON.stringify(server.config, null, 2))
    setDirty(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id])

  const handleSave = useCallback(() => {
    const finalConfig = mode === 'json'
      ? (() => { try { return JSON.parse(jsonStr) } catch { return formStateToConfig(config, protocol) } })()
      : formStateToConfig(config, protocol)
    onSave(server.id, { name, protocol, config: finalConfig })
    setDirty(false)
  }, [server.id, name, protocol, config, jsonStr, mode, onSave])

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(`/api/mcp/${server.id}/test`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        onSave(server.id, { status: 'connected' })
        setTestResult('connected')
      } else {
        onSave(server.id, { status: 'error' })
        setTestResult(data.error || 'Connection failed')
      }
    } catch (err) {
      onSave(server.id, { status: 'error' })
      setTestResult(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setTesting(false)
    }
  }

  const fields = getProtocolFields(t)[protocol]

  const statusColor = server.status === 'connected' ? 'bg-green' : server.status === 'error' ? 'bg-coral' : 'bg-muted'
  const statusTextColor = server.status === 'connected' ? 'text-green' : server.status === 'error' ? 'text-coral' : 'text-muted'
  const statusLabel = server.status === 'connected' ? t('im.connected') : server.status === 'error' ? t('im.error') : t('im.disconnected')

  return (
    <div className="flex flex-col h-full" onKeyDown={(e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave() }
    }}>
      {/* Editor Header */}
      <div className="px-6 pt-4 pb-3 border-b border-subtle shrink-0">
        <div className="flex items-center justify-between">
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setDirty(true) }}
            onBlur={() => { if (name.trim() && name !== server.name) onSave(server.id, { name: name.trim() }) }}
            className="text-[20px] font-semibold text-primary bg-transparent outline-none font-heading tracking-tight"
          />
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-secondary">{server.enabled !== false ? t('common.enabled') : t('common.disabled')}</span>
            <button
              onClick={() => onSave(server.id, { enabled: !server.enabled })}
              className={cn(
                'w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer',
                server.enabled !== false ? 'bg-green' : 'bg-[#D1D1D6] dark:bg-[#636366]'
              )}
            >
              <div className={cn('w-4 h-4 rounded-full bg-white transition-transform duration-200', server.enabled !== false ? 'translate-x-[14px]' : 'translate-x-0')} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4 mt-2">
          <span className="text-[12px] text-tertiary">Protocol: {protocol}</span>
          {config.command && <span className="text-[12px] text-tertiary">Command: {config.command}</span>}
          {config.args && <span className="text-[12px] text-secondary">Args: {config.args.split('\n').filter(Boolean).join(' ')}</span>}
          {config.url && <span className="text-[12px] text-tertiary">URL: {config.url}</span>}
          {dirty && <div className="w-2 h-2 rounded-full bg-amber shrink-0" />}
        </div>
      </div>

      {/* Toolbar - Underline Tabs */}
      <div className="flex items-center h-10 px-6 border-b border-subtle shrink-0">
        <button
          onClick={() => setMode('form')}
          className={cn(
            'h-full px-3.5 text-[12px] font-medium transition-colors border-b-2',
            mode === 'form'
              ? 'text-primary font-semibold border-indigo'
              : 'text-tertiary hover:text-secondary border-transparent'
          )}
        >
          {t('mcp.formConfig')}
        </button>
        <button
          onClick={() => { setMode('json'); setJsonStr(JSON.stringify(formStateToConfig(config, protocol), null, 2)) }}
          className={cn(
            'h-full px-3.5 text-[12px] font-medium transition-colors border-b-2',
            mode === 'json'
              ? 'text-primary font-semibold border-indigo'
              : 'text-tertiary hover:text-secondary border-transparent'
          )}
        >
          {t('mcp.jsonEdit')}
        </button>
        {mode === 'json' && (
          <>
            <div className="flex-1" />
            <button
              onClick={toggleWordWrap}
              className={cn('p-1.5 rounded-md hover:bg-surface-hover transition-colors', wordWrap ? 'text-muted' : 'text-tertiary')}
              title={wordWrap ? 'Word wrap: on' : 'Word wrap: off'}
            >
              <WrapText size={14} />
            </button>
          </>
        )}
      </div>

      {/* Content */}
      {mode === 'form' ? (
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Status */}
          <div className="flex items-center gap-2">
            <div className={cn('w-2.5 h-2.5 rounded-full', statusColor)} />
            <span className={cn('text-[13px] font-semibold', statusTextColor)}>{statusLabel}</span>
            {server.status === 'connected' && (
              <span className="text-[12px] text-tertiary">since {new Date().toISOString().slice(0, 16).replace('T', ' ')}</span>
            )}
          </div>

          <div className="h-px bg-subtle" />

          {/* Protocol */}
          <Field label={t('form.protocol')}>
            <div className="w-[300px]">
              <CustomSelect
                value={protocol}
                onChange={(v) => { setProtocol(v as McpProtocol); setConfig({}); setDirty(true) }}
                options={[
                  { value: 'stdio', label: 'stdio' },
                  { value: 'sse', label: 'SSE' },
                  { value: 'http', label: 'HTTP' },
                ]}
                size="sm"
              />
            </div>
          </Field>

          {/* Dynamic fields */}
          {fields.map((field) => (
            <Field key={field.key} label={field.label}>
              {field.type === 'textarea' ? (
                <textarea
                  value={config[field.key] || ''}
                  onChange={(e) => { setConfig({ ...config, [field.key]: e.target.value }); setDirty(true) }}
                  placeholder={field.placeholder}
                  rows={3}
                  className="w-full px-3 py-1.5 rounded-lg bg-elevated border border-subtle text-[13px] text-primary placeholder:text-muted outline-none focus:border-indigo resize-y font-mono"
                />
              ) : (
                <input
                  value={config[field.key] || ''}
                  onChange={(e) => { setConfig({ ...config, [field.key]: e.target.value }); setDirty(true) }}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-1.5 rounded-lg bg-elevated border border-subtle text-[13px] text-primary placeholder:text-muted outline-none focus:border-indigo"
                />
              )}
            </Field>
          ))}

          {/* Environment Variables (stdio only) */}
          {protocol === 'stdio' && (
            <Field label={t('form.envVariables')}>
              <textarea
                value={config.env || ''}
                onChange={(e) => { setConfig({ ...config, env: e.target.value }); setDirty(true) }}
                placeholder={'PATH=/usr/local/bin\nNODE_ENV=production'}
                rows={3}
                className="w-full px-3 py-1.5 rounded-lg bg-elevated border border-subtle text-[13px] text-primary placeholder:text-muted outline-none focus:border-indigo resize-y font-mono"
              />
            </Field>
          )}

          <div className="h-px bg-subtle" />

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5">
            <button onClick={handleTestConnection} disabled={testing}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo text-white text-[12px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
              {testing ? t('status.testing') : t('settings.testConnection')}
            </button>
            {testResult && testResult !== 'connected' && (
              <span className="text-[11px] text-coral">{testResult}</span>
            )}
            {testResult === 'connected' && (
              <span className="text-[11px] text-green">{t('mcp.connected')}</span>
            )}
            <button onClick={() => { setMode('json'); setJsonStr(JSON.stringify(formStateToConfig(config, protocol), null, 2)) }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-subtle text-[12px] text-secondary font-medium hover:bg-surface-hover transition-colors">
              {t('button.editJson')}
            </button>
            <button onClick={() => onDelete(server.id)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-coral/20 text-[12px] text-coral font-medium hover:bg-coral/30 transition-colors">
              {t('common.delete')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <CodeEditor
            value={jsonStr}
            onChange={(v) => { setJsonStr(v); setDirty(true) }}
            language="json"
            wordWrap={wordWrap}
          />
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center h-8 px-6 border-t border-subtle shrink-0 bg-surface">
        <Folder size={12} className="text-muted" />
        <span className="text-[11px] text-muted ml-1.5 font-mono">
          mcp/{server.name.toLowerCase().replace(/\s+/g, '-')}.json
        </span>
        <div className="flex-1" />
        <span className="text-[11px] text-muted">{t('hint.cmdSToSave')}</span>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-medium text-secondary mb-1.5 block">{label}</label>
      {children}
    </div>
  )
}
