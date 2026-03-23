/**
 * Browser automation tools as an SDK MCP Server.
 * Playwright is an optional dependency — tools gracefully error if not installed.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// Lazy-loaded browser page
let browserPage: unknown = null
let browserInstance: unknown = null

// Idle auto-close: close browser if no tool activity for 15 minutes
const IDLE_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes
const IDLE_CHECK_INTERVAL_MS = 10 * 60 * 1000 // check every 10 minutes
let lastActivityTime = Date.now()
let idleCheckTimer: ReturnType<typeof setInterval> | null = null

function updateActivity() {
  lastActivityTime = Date.now()
}

function startIdleChecker() {
  if (idleCheckTimer) return
  idleCheckTimer = setInterval(async () => {
    if (browserInstance && Date.now() - lastActivityTime > IDLE_TIMEOUT_MS) {
      await closeBrowser()
    }
  }, IDLE_CHECK_INTERVAL_MS)
  // Allow Node.js to exit even if timer is active
  if (idleCheckTimer && typeof idleCheckTimer === 'object' && 'unref' in idleCheckTimer) {
    (idleCheckTimer as NodeJS.Timeout).unref()
  }
}

function stopIdleChecker() {
  if (idleCheckTimer) {
    clearInterval(idleCheckTimer)
    idleCheckTimer = null
  }
}

// Clean up browser on process exit
if (typeof process !== 'undefined') {
  process.on('beforeExit', () => {
    if (browserInstance) {
      closeBrowser()
    }
  })
}

async function getPage(): Promise<{ page: unknown; error?: string }> {
  if (browserPage) {
    updateActivity()
    return { page: browserPage }
  }

  try {
    // Dynamic require — fails gracefully if playwright not installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pw = require('playwright') as { chromium: { launch(opts: Record<string, unknown>): Promise<unknown> } }
    const browser = await pw.chromium.launch({ headless: true }) as { newPage(): Promise<unknown> }
    const page = await browser.newPage()
    browserInstance = browser
    browserPage = page
    updateActivity()
    startIdleChecker()
    return { page }
  } catch {
    return {
      page: null,
      error: 'Playwright is not installed. Run: pnpm add playwright && npx playwright install chromium',
    }
  }
}

type PageType = {
  goto(url: string, opts?: Record<string, unknown>): Promise<unknown>
  title(): Promise<string>
  textContent(sel: string): Promise<string | null>
  screenshot(opts?: Record<string, unknown>): Promise<Buffer>
  click(sel: string): Promise<void>
  fill(sel: string, val: string): Promise<void>
  $$eval(sel: string, fn: (els: Element[]) => string[]): Promise<string[]>
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true }
}

/**
 * Create the browser tools MCP server for SDK integration.
 * Returns null if not needed (caller should check).
 */
export function createBrowserMcpServer() {
  return createSdkMcpServer({
    name: '__forge_browser',
    version: '1.0.0',
    tools: [
      tool(
        'browser_navigate',
        'Navigate to a URL in the browser and return the page title and text content.',
        { url: z.string().describe('URL to navigate to') },
        async ({ url }) => {
          const { page, error } = await getPage()
          if (error || !page) return errorResult(error || 'Browser not available')
          const p = page as PageType
          try {
            await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
            const title = await p.title()
            const text = await p.textContent('body')
            return textResult(`Title: ${title}\n\n${(text || '').slice(0, 3000)}`)
          } catch (err) {
            return errorResult(err instanceof Error ? err.message : String(err))
          }
        },
      ),
      tool(
        'browser_screenshot',
        'Take a screenshot of the current page. Returns the file path of the saved screenshot.',
        {
          path: z.string().optional().describe('File path to save the screenshot (default: /tmp/forge-screenshot.png)'),
          fullPage: z.boolean().optional().describe('Capture full page (default: false)'),
        },
        async ({ path: filePath, fullPage }) => {
          const { page, error } = await getPage()
          if (error || !page) return errorResult(error || 'Browser not available')
          const p = page as PageType
          try {
            const savePath = filePath || '/tmp/forge-screenshot.png'
            await p.screenshot({ path: savePath, fullPage: fullPage || false })
            return textResult(`Screenshot saved to: ${savePath}`)
          } catch (err) {
            return errorResult(err instanceof Error ? err.message : String(err))
          }
        },
      ),
      tool(
        'browser_click',
        'Click an element on the page matching the given selector.',
        { selector: z.string().describe('CSS selector or text to click') },
        async ({ selector }) => {
          const { page, error } = await getPage()
          if (error || !page) return errorResult(error || 'Browser not available')
          const p = page as PageType
          try {
            await p.click(selector)
            return textResult(`Clicked: ${selector}`)
          } catch (err) {
            return errorResult(err instanceof Error ? err.message : String(err))
          }
        },
      ),
      tool(
        'browser_fill',
        'Fill an input field on the page with the given value.',
        {
          selector: z.string().describe('CSS selector of the input field'),
          value: z.string().describe('Value to fill'),
        },
        async ({ selector, value }) => {
          const { page, error } = await getPage()
          if (error || !page) return errorResult(error || 'Browser not available')
          const p = page as PageType
          try {
            await p.fill(selector, value)
            return textResult(`Filled ${selector} with value`)
          } catch (err) {
            return errorResult(err instanceof Error ? err.message : String(err))
          }
        },
      ),
      tool(
        'browser_extract',
        'Extract text content from elements matching the given selector.',
        {
          selector: z.string().optional().describe('CSS selector to extract from (default: body)'),
        },
        async ({ selector }) => {
          const { page, error } = await getPage()
          if (error || !page) return errorResult(error || 'Browser not available')
          const p = page as PageType
          try {
            const sel = selector || 'body'
            const texts = await p.$$eval(sel, (els: Element[]) => els.map((el) => el.textContent || ''))
            return textResult(texts.join('\n').slice(0, 5000) || '(empty)')
          } catch (err) {
            return errorResult(err instanceof Error ? err.message : String(err))
          }
        },
      ),
    ],
  })
}

export async function closeBrowser(): Promise<void> {
  stopIdleChecker()
  try {
    const browser = browserInstance as { close(): Promise<void> } | null
    if (browser) await browser.close()
  } catch { /* ignore */ }
  browserPage = null
  browserInstance = null
}
