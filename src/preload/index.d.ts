import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      selectRepository: () => Promise<string | null>
      getRepoStatus: (repoPath: string) => Promise<{ isRepo: boolean; hasUncommitted: boolean; currentBranch: string }>
      getCommits: (repoPath: string) => Promise<Array<{
        hash: string
        tree: string
        parents: string[]
        authorName: string
        authorEmail: string
        authorDate: string
        committerName: string
        committerEmail: string
        committerDate: string
        message: string
      }>>
      rewriteCommits: (
        repoPath: string,
        updates: Record<string, { authorName: string; authorEmail: string }>,
        currentBranch: string
      ) => Promise<{ success: boolean; error?: string }>
      onRewriteProgress: (callback: (message: string) => void) => () => void
    }
  }
}
