import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  selectRepository: () => ipcRenderer.invoke('select-repository'),
  getRepoStatus: (repoPath: string) => ipcRenderer.invoke('get-repo-status', repoPath),
  getCommits: (repoPath: string) => ipcRenderer.invoke('get-commits', repoPath),
  rewriteCommits: (repoPath: string, updates: Record<string, { authorName: string, authorEmail: string }>, currentBranch: string) => 
    ipcRenderer.invoke('rewrite-commits', repoPath, updates, currentBranch),
  onRewriteProgress: (callback: (message: string) => void) => {
    const listener = (_event: any, message: string) => callback(message)
    ipcRenderer.on('rewrite-progress', listener)
    return () => {
      ipcRenderer.removeListener('rewrite-progress', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
