import { NextRequest, NextResponse } from 'next/server'
import { writeFile } from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { getUploadsDir } from '@/lib/forge-data'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

/** File extensions recognized as text-based (Tier 2: content injected into prompt) */
const TEXT_EXTENSIONS = new Set([
  // Documents
  '.txt', '.md', '.rst', '.rtf', '.log',
  // Code
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.cpp', '.c', '.h', '.hpp',
  '.rb', '.php', '.swift', '.kt', '.kts', '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.r', '.scala', '.lua', '.pl', '.pm', '.zig', '.nim', '.ex', '.exs',
  '.cs', '.fs', '.vb', '.m', '.mm', '.dart', '.groovy', '.clj', '.cljs', '.erl', '.hs',
  '.dockerfile',
  // Config
  '.json', '.yaml', '.yml', '.toml', '.xml', '.env', '.ini', '.cfg', '.properties',
  '.editorconfig', '.gitignore', '.gitattributes', '.npmrc', '.eslintrc',
  // Data
  '.csv', '.tsv', '.jsonl', '.ndjson',
  // Markup
  '.html', '.htm', '.css', '.scss', '.less', '.sass', '.svg', '.graphql', '.gql',
  // Other text
  '.tex', '.bib', '.makefile', '.cmake', '.gradle', '.pom',
])

// POST /api/upload — upload a file attachment
export async function POST(req: NextRequest) {
  const UPLOAD_DIR = getUploadsDir()
  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }
  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, { status: 400 })
  }

  // Generate unique filename
  const ext = path.extname(file.name) || ''
  const id = crypto.randomUUID().slice(0, 8)
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
  const filename = `${id}_${safeName}`
  const filePath = path.join(UPLOAD_DIR, filename)

  // Write file
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(filePath, buffer)

  // Determine file type categories
  const mimeType = file.type || 'application/octet-stream'
  const extLower = ext.toLowerCase()
  const isImage = mimeType.startsWith('image/') && !extLower.endsWith('.svg')
  const isPdf = mimeType === 'application/pdf' || extLower === '.pdf'
  const isText = mimeType.startsWith('text/') || TEXT_EXTENSIONS.has(extLower)

  // Tier classification for multimodal handling
  let tier: 'image' | 'pdf' | 'text' | 'binary' = 'binary'
  if (isImage) tier = 'image'
  else if (isPdf) tier = 'pdf'
  else if (isText) tier = 'text'

  return NextResponse.json({
    id,
    filename,
    originalName: file.name,
    size: file.size,
    mimeType,
    isImage,
    isPdf,
    isText,
    tier,
    path: `/api/upload/${filename}`,
    // serverPath intentionally NOT exposed — chat API reconstructs from filename
  })
}
