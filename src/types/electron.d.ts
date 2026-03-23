interface ElectronAPI {
  platform: NodeJS.Platform
  homeForgePath: string
  forgeDataPath: string
  openDirectoryDialog: () => Promise<string | null>
  watchDirectory: (dirPath: string) => Promise<void>
  onFsChanged: (callback: () => void) => () => void
  // File operations
  readClipboardFiles: () => Promise<string[]>
  showInFolder: (filePath: string) => Promise<void>
  copyToClipboard: (text: string) => Promise<void>
  // Data directory
  getDataPath: () => Promise<string>
  openPath: (targetPath: string) => Promise<string>
}

interface Window {
  electronAPI?: ElectronAPI
}
