import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import simpleGit from 'simple-git'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Select a local folder
  ipcMain.handle('select-repository', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // Get status: check if repo and if it contains uncommitted changes
  ipcMain.handle('get-repo-status', async (_, repoPath: string) => {
    try {
      const git = simpleGit(repoPath)
      const isRepo = await git.checkIsRepo()
      if (!isRepo) return { isRepo: false, hasUncommitted: false, currentBranch: '' }

      const status = await git.status()
      const hasUncommitted = !status.isClean()

      const branches = await git.branchLocal()
      const currentBranch = branches.current || 'main'

      return { isRepo: true, hasUncommitted, currentBranch }
    } catch (e) {
      return { isRepo: false, hasUncommitted: false, currentBranch: '' }
    }
  })

  // Retrieve commit history using a custom parser
  ipcMain.handle('get-commits', async (_, repoPath: string) => {
    try {
      // Get chronological commits (oldest to newest is easier for DAG rebuilding, but git log HEAD is newest to oldest)
      // We will fetch from HEAD down to the roots.
      const { stdout } = await execAsync(
        'git log --format="%H|%T|%P|%an|%ae|%at|%cn|%ce|%ct|%B%x00" HEAD',
        { cwd: repoPath, maxBuffer: 30 * 1024 * 1024 }
      )

      const parts = stdout.split('\0')
      const commits: any[] = []

      for (const part of parts) {
        if (!part.trim()) continue
        const index1 = part.indexOf('|')
        const index2 = part.indexOf('|', index1 + 1)
        const index3 = part.indexOf('|', index2 + 1)
        const index4 = part.indexOf('|', index3 + 1)
        const index5 = part.indexOf('|', index4 + 1)
        const index6 = part.indexOf('|', index5 + 1)
        const index7 = part.indexOf('|', index6 + 1)
        const index8 = part.indexOf('|', index7 + 1)
        const index9 = part.indexOf('|', index8 + 1)

        if (index9 === -1) continue

        const hash = part.substring(0, index1).trim()
        const tree = part.substring(index1 + 1, index2).trim()
        const parentsRaw = part.substring(index2 + 1, index3).trim()
        const parents = parentsRaw ? parentsRaw.split(' ') : []
        const authorName = part.substring(index3 + 1, index4).trim()
        const authorEmail = part.substring(index4 + 1, index5).trim()
        const authorDate = part.substring(index5 + 1, index6).trim()
        const committerName = part.substring(index6 + 1, index7).trim()
        const committerEmail = part.substring(index7 + 1, index8).trim()
        const committerDate = part.substring(index8 + 1, index9).trim()
        const message = part.substring(index9 + 1)

        commits.push({
          hash,
          tree,
          parents,
          authorName,
          authorEmail,
          authorDate,
          committerName,
          committerEmail,
          committerDate,
          message
        })
      }

      return commits
    } catch (e: any) {
      console.error(e)
      throw e
    }
  })

  // Programmatic DAG rewriter using git commit-tree
  ipcMain.handle('rewrite-commits', async (event, repoPath: string, updates: Record<string, { authorName: string, authorEmail: string }>, currentBranch: string) => {
    try {
      event.sender.send('rewrite-progress', 'Iniciando lectura de commits...')

      // 1. Obtener la lista cronológica de todos los commits de la rama actual (del más viejo al más nuevo)
      const { stdout } = await execAsync(
        'git log --reverse --format="%H|%T|%P|%an|%ae|%at|%cn|%ce|%ct|%B%x00" HEAD',
        { cwd: repoPath, maxBuffer: 30 * 1024 * 1024 }
      )

      const parts = stdout.split('\0')
      const commits: any[] = []

      for (const part of parts) {
        if (!part.trim()) continue
        const index1 = part.indexOf('|')
        const index2 = part.indexOf('|', index1 + 1)
        const index3 = part.indexOf('|', index2 + 1)
        const index4 = part.indexOf('|', index3 + 1)
        const index5 = part.indexOf('|', index4 + 1)
        const index6 = part.indexOf('|', index5 + 1)
        const index7 = part.indexOf('|', index6 + 1)
        const index8 = part.indexOf('|', index7 + 1)
        const index9 = part.indexOf('|', index8 + 1)

        if (index9 === -1) continue

        const hash = part.substring(0, index1).trim()
        const tree = part.substring(index1 + 1, index2).trim()
        const parentsRaw = part.substring(index2 + 1, index3).trim()
        const parents = parentsRaw ? parentsRaw.split(' ') : []
        const authorName = part.substring(index3 + 1, index4).trim()
        const authorEmail = part.substring(index4 + 1, index5).trim()
        const authorDate = part.substring(index5 + 1, index6).trim()
        const committerName = part.substring(index6 + 1, index7).trim()
        const committerEmail = part.substring(index7 + 1, index8).trim()
        const committerDate = part.substring(index8 + 1, index9).trim()
        const message = part.substring(index9 + 1)

        commits.push({
          hash,
          tree,
          parents,
          authorName,
          authorEmail,
          authorDate,
          committerName,
          committerEmail,
          committerDate,
          message
        })
      }

      if (commits.length === 0) {
        return { success: false, error: 'No se encontraron commits para reescribir.' }
      }

      event.sender.send('rewrite-progress', `Se cargaron ${commits.length} commits en orden cronológico. Analizando cambios...`)

      const rewrittenHashes: Record<string, string> = {}
      let totalRewritten = 0

      // Buscamos cuál es el primer commit que necesita reescritura.
      // A partir de ese commit, todos los subsecuentes tendrán que reescribirse porque sus padres cambian.
      const oldestModIndex = commits.findIndex(c => updates[c.hash] !== undefined)

      if (oldestModIndex === -1) {
        return { success: false, error: 'No se seleccionaron commits para modificar.' }
      }

      event.sender.send('rewrite-progress', `El primer commit modificado es el index ${oldestModIndex + 1} de ${commits.length}. Iniciando reescritura...`)

      for (let i = 0; i < commits.length; i++) {
        const commit = commits[i]

        // Si estamos antes del primer commit a modificar, no hacemos nada y conservamos el hash original
        if (i < oldestModIndex) {
          rewrittenHashes[commit.hash] = commit.hash
          continue
        }

        // A partir de oldestModIndex, reescribimos todo
        const isTarget = updates[commit.hash] !== undefined

        const newAuthorName = isTarget ? updates[commit.hash].authorName : commit.authorName
        const newAuthorEmail = isTarget ? updates[commit.hash].authorEmail : commit.authorEmail
        // Mantener la información del committer igual a la del autor si es modificado, o conservar la original
        const newCommitterName = isTarget ? updates[commit.hash].authorName : commit.committerName
        const newCommitterEmail = isTarget ? updates[commit.hash].authorEmail : commit.committerEmail

        // Mapear los padres a sus nuevos hashes
        const newParents = commit.parents.map(p => rewrittenHashes[p] || p)

        // Usamos spawn para pasar el mensaje del commit por stdin sin problemas de escapes de caracteres en Windows
        const env = {
          ...process.env,
          GIT_AUTHOR_NAME: newAuthorName,
          GIT_AUTHOR_EMAIL: newAuthorEmail,
          GIT_AUTHOR_DATE: `@${commit.authorDate}`,
          GIT_COMMITTER_NAME: newCommitterName,
          GIT_COMMITTER_EMAIL: newCommitterEmail,
          GIT_COMMITTER_DATE: `@${commit.committerDate}`
        }

        const newHash = await new Promise<string>((resolve, reject) => {
          const { spawn } = require('child_process')
          const args = ['commit-tree', commit.tree]
          newParents.forEach(p => {
            args.push('-p', p)
          })

          const child = spawn('git', args, {
            cwd: repoPath,
            env
          })

          let output = ''
          let errorOutput = ''

          child.stdout.on('data', (data: any) => {
            output += data.toString()
          })

          child.stderr.on('data', (data: any) => {
            errorOutput += data.toString()
          })

          child.on('close', (code: number) => {
            if (code === 0) {
              resolve(output.trim())
            } else {
              reject(new Error(`git commit-tree falló con código ${code}: ${errorOutput}`))
            }
          })

          // Escribir el mensaje por stdin
          child.stdin.write(commit.message)
          child.stdin.end()
        })

        rewrittenHashes[commit.hash] = newHash
        totalRewritten++

        event.sender.send(
          'rewrite-progress',
          `Procesado [${totalRewritten}]: ${commit.hash.substring(0, 7)} -> ${newHash.substring(0, 7)}`
        )
      }

      const newHeadHash = rewrittenHashes[commits[commits.length - 1].hash]

      event.sender.send('rewrite-progress', `Actualizando referencia de la rama ${currentBranch} a ${newHeadHash.substring(0, 7)}...`)

      // Actualizar ref
      try {
        await execAsync(`git update-ref refs/heads/${currentBranch} ${newHeadHash}`, { cwd: repoPath })
      } catch (err) {
        await execAsync(`git update-ref HEAD ${newHeadHash}`, { cwd: repoPath })
      }

      // Limpiar reflog o refrescar git local
      try {
        await execAsync('git checkout -f', { cwd: repoPath })
      } catch (e) {
        // Ignorar si checkout -f falla
      }

      event.sender.send('rewrite-progress', `¡Historial reescrito con éxito! Se reescribieron ${totalRewritten} commits.`)
      return { success: true }
    } catch (error: any) {
      console.error(error)
      event.sender.send('rewrite-progress', `Error crítico: ${error.message}`)
      return { success: false, error: error.message }
    }
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
