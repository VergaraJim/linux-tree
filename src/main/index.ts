import { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } from 'electron'
import { spawn } from 'child_process'
import { join, dirname, resolve } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { askpassEnv, startAskpass, tmpDir } from './askpass'

export interface GitResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

function loadSettings(): unknown {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8'))
  } catch {
    return { recent: [] }
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0c0c0f',
    title: 'Linux Tree',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('focus', () => win.webContents.send('window:focus'))

  // No application menu: its default accelerators would close the window on
  // Ctrl+W and reload the app on Ctrl+R, which the UI uses for tabs/refresh.
  // Keep DevTools and zoom shortcuts explicitly.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const ctrl = input.control || input.meta
    const key = input.key.toLowerCase()
    const wc = win.webContents
    if (input.key === 'F12' || (ctrl && input.shift && key === 'i')) wc.toggleDevTools()
    else if (ctrl && (key === '=' || key === '+')) wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4))
    else if (ctrl && key === '-') wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3))
    else if (ctrl && key === '0') wc.setZoomLevel(0)
    else return
    e.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Git is run with an argument array (no shell). `detached` puts git in its own
// session without a controlling terminal, so ssh can never block on a hidden prompt.
// SSH prompts (passphrase, unknown host) are routed to an in-app dialog via SSH_ASKPASS.
interface RunOpts {
  input?: string
  env?: Record<string, string>
}

ipcMain.handle('git:run', (_e, cwd: string, args: string[], opts: RunOpts = {}): Promise<GitResult> => {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...askpassEnv(), ...(opts.env ?? {}) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(opts.input ?? '')
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => err.push(d))
    child.on('error', (e) => resolve({ ok: false, code: -1, stdout: '', stderr: e.message }))
    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        code: code ?? -1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8')
      })
    })
  })
})

ipcMain.handle('repo:pick', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return res.canceled ? null : res.filePaths[0]
})
ipcMain.handle('settings:get', () => loadSettings())
ipcMain.handle('settings:set', (_e, s: unknown) => {
  mkdirSync(dirname(settingsFile()), { recursive: true })
  writeFileSync(settingsFile(), JSON.stringify(s, null, 2))
})
ipcMain.handle('shell:open', (_e, p: string) => shell.openPath(p))
// Write a temp file in the app's private 0700 dir (used for rebase todo / messages).
let tmpCounter = 0
ipcMain.handle('tmp:write', (_e, content: string) => {
  const p = join(tmpDir(), `tmp-${process.pid}-${++tmpCounter}`)
  writeFileSync(p, content, { mode: 0o600 })
  return p
})
ipcMain.handle('fs:exists', (_e, cwd: string, p: string) => existsSync(resolve(cwd, p)))
ipcMain.handle('clipboard:write', (_e, t: string) => clipboard.writeText(t))

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  startAskpass()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
