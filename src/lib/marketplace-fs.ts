/**
 * Marketplace filesystem utilities.
 *
 * Templates are stored under ~/.forge/marketplace/<templateId>/
 * Each template directory mirrors a .claude/ structure that can be
 * copied to/from project workspaces.
 */

import fs from 'fs'
import path from 'path'
import { getForgeDataDir } from './forge-data'

interface TreeNode {
  name: string
  type: 'file' | 'folder'
  path: string
  children?: TreeNode[]
}

/** Files/directories to exclude when copying .claude/ to a template */
const COPY_EXCLUDES = new Set(['MEMORY.md', 'memory', 'HEARTBEAT.md'])

/**
 * Get the marketplace root directory (~/.forge/marketplace/).
 * Auto-creates the directory if it doesn't exist.
 */
export function getMarketplaceDir(): string {
  const dir = path.join(getForgeDataDir(), 'marketplace')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Get the path for a specific template directory (~/.forge/marketplace/<id>/).
 */
export function getTemplatePath(templateId: string): string {
  return path.join(getMarketplaceDir(), templateId)
}

/**
 * Recursively scan a template directory and return a TreeNode[] structure.
 * Matches the shape used by skills-tree and project-tree APIs.
 */
export function buildTemplateTree(templateId: string, maxDepth = 6): TreeNode[] {
  const templateDir = getTemplatePath(templateId)
  return buildTree(templateDir, '', maxDepth, 0)
}

function buildTree(dirPath: string, basePath: string, maxDepth: number, depth: number): TreeNode[] {
  if (depth >= maxDepth || !fs.existsSync(dirPath)) return []

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

  return entries.map(entry => {
    const relPath = basePath ? `${basePath}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      return {
        name: entry.name,
        type: 'folder' as const,
        path: relPath,
        children: buildTree(path.join(dirPath, entry.name), relPath, maxDepth, depth + 1),
      }
    }
    return { name: entry.name, type: 'file' as const, path: relPath }
  })
}

/**
 * Copy a project's .claude/ directory into a marketplace template,
 * EXCLUDING: MEMORY.md, memory/ directory, HEARTBEAT.md.
 */
export function copyClaudeToTemplate(projectPath: string, templateId: string): void {
  const claudeDir = path.join(projectPath, '.claude')
  if (!fs.existsSync(claudeDir)) {
    throw new Error(`项目路径下不存在 .claude/ 目录: ${projectPath}`)
  }

  const templateDir = getTemplatePath(templateId)
  if (!fs.existsSync(templateDir)) {
    fs.mkdirSync(templateDir, { recursive: true })
  }

  copyDirRecursive(claudeDir, templateDir)
}

/**
 * Recursively copy directory contents, respecting COPY_EXCLUDES.
 */
function copyDirRecursive(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    if (COPY_EXCLUDES.has(entry.name)) continue
    if (entry.name.startsWith('.')) continue

    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true })
      }
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Copy a marketplace template's files into a project's .claude/ directory.
 * Overwrites existing files in the target.
 */
export function copyTemplateToProject(templateId: string, projectPath: string): void {
  const templateDir = getTemplatePath(templateId)
  if (!fs.existsSync(templateDir)) {
    throw new Error(`模板不存在: ${templateId}`)
  }

  const claudeDir = path.join(projectPath, '.claude')
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true })
  }

  copyTemplateDirRecursive(templateDir, claudeDir)
}

/**
 * Recursively copy template contents into destination (no exclusions).
 */
function copyTemplateDirRecursive(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue

    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true })
      }
      copyTemplateDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}
