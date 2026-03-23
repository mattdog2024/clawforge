import { contextBridge, ipcRenderer } from 'electron'
import os from 'node:os'
import path from 'node:path'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  homeForgePath: path.join(os.homedir(), '.claude'),
  forgeDataPath: path.join(os.homedir(), '.forge'),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  watchDirectory: (dirPath: string) => ipcRenderer.invoke('fs:watch', dirPath),
  onFsChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('fs:changed', handler)
    return () => ipcRenderer.removeListener('fs:changed', handler)
  },
  // File operations
  readClipboardFiles: () => ipcRenderer.invoke('clipboard:readFiles') as Promise<string[]>,
  showInFolder: (filePath: string) => ipcRenderer.invoke('shell:showInFolder', filePath),
  copyToClipboard: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
  // Data directory
  getDataPath: () => ipcRenderer.invoke('app:getDataPath') as Promise<string>,
  openPath: (targetPath: string) => ipcRenderer.invoke('shell:openPath', targetPath) as Promise<string>,
})
