'use client'

import { useState, useCallback } from 'react'
import { Package } from 'lucide-react'
import { useMarketplace } from '@/hooks/use-marketplace'
import { useWorkspaces } from '@/hooks/use-workspaces'
import { useI18n } from '@/components/providers/i18n-provider'
import { TemplateListPanel } from '@/components/marketplace/template-list-panel'
import { TemplateEditorPanel } from '@/components/marketplace/template-editor-panel'
import { ResizeHandle } from '@/components/ui/resize-handle'

interface MarketplaceViewProps {
  onUseTemplate: (workspaceId: string, sessionId: string) => void
}

export function MarketplaceView({ onUseTemplate }: MarketplaceViewProps) {
  const { t } = useI18n()
  const {
    templates,
    loading,
    selectedTemplateId,
    selectedTemplate,
    setSelectedTemplateId,
    createTemplate,
    renameTemplate,
    deleteTemplate,
  } = useMarketplace()
  const { openProjectFolder } = useWorkspaces()
  const [listWidth, setListWidth] = useState(260)

  const handleListResize = useCallback((delta: number) => {
    setListWidth((w) => Math.max(180, Math.min(500, w + delta)))
  }, [])

  const handleUseTemplate = useCallback(async () => {
    if (!selectedTemplateId) return

    // Open Electron folder dialog for project path
    const folderPath = await window.electronAPI?.openDirectoryDialog()
    if (!folderPath) return

    try {
      // Call the use-template API
      const res = await fetch(`/api/marketplace/${selectedTemplateId}/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: folderPath }),
      })

      if (!res.ok) {
        const err = await res.json()
        console.error('Failed to use template:', err.error)
        return
      }

      const { workspaceId, sessionId } = await res.json()

      // Ensure the workspace is loaded in the workspaces list
      try {
        await openProjectFolder(folderPath)
      } catch { /* workspace may already exist */ }

      // Navigate to the new workspace and session
      onUseTemplate(workspaceId, sessionId)
    } catch (err) {
      console.error('Failed to use template:', err)
    }
  }, [selectedTemplateId, openProjectFolder, onUseTemplate])

  return (
    <div className="flex h-full">
      {/* Template List Panel */}
      <div className="border-r border-subtle shrink-0 overflow-hidden" style={{ width: listWidth }}>
        <TemplateListPanel
          templates={templates}
          loading={loading}
          selectedTemplateId={selectedTemplateId}
          onSelectTemplate={setSelectedTemplateId}
          onCreateTemplate={createTemplate}
          onRenameTemplate={renameTemplate}
          onDeleteTemplate={deleteTemplate}
          onUseTemplate={handleUseTemplate}
        />
      </div>

      {/* Resize handle */}
      <ResizeHandle direction="horizontal" onResize={handleListResize} />

      {/* Editor Panel or Empty State */}
      <div className="flex-1 overflow-hidden min-w-0">
        {selectedTemplate ? (
          <TemplateEditorPanel
            templateId={selectedTemplate.id}
            templateName={selectedTemplate.name}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-elevated flex items-center justify-center mx-auto mb-3">
                <Package size={24} className="text-tertiary" />
              </div>
              <p className="text-[13px] text-secondary">{t('marketplace.selectTemplate')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
