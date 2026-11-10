// SSH passphrase / host-key prompts routed into the app UI.
//
// ssh runs `SSH_ASKPASS <prompt>` when it needs input (we force this with
// SSH_ASKPASS_REQUIRE=force). Our askpass script is Electron running in plain
// Node mode; it connects to a Unix socket owned by this process, sends the
// prompt, and prints whatever the user typed in the dialog.
import { app, BrowserWindow, ipcMain } from 'electron'
import { createServer, type Server } from 'net'
import { randomBytes } from 'crypto'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CLIENT_JS = `
const net = require('net')
const sock = net.connect(process.env.GM_ASKPASS_SOCK, () => {
  sock.end(JSON.stringify({ token: process.env.GM_ASKPASS_TOKEN, prompt: process.argv.slice(2).join(' ') }))
})
let buf = ''
sock.on('data', (d) => (buf += d))
sock.on('end', () => {
  try {
    const r = JSON.parse(buf)
    if (r.ok) { process.stdout.write(r.value + '\\n'); process.exit(0) }
  } catch {}
  process.exit(1)
})
sock.on('error', () => process.exit(1))
`

let dir = ''
let server: Server | null = null
const token = randomBytes(24).toString('hex')
let nextId = 1
const pending = new Map<number, (v: string | null) => void>()

export function askpassEnv(): Record<string, string> {
  if (!dir) return {}
  return {
    SSH_ASKPASS: join(dir, 'askpass.sh'),
    SSH_ASKPASS_REQUIRE: 'force',
    DISPLAY: process.env.DISPLAY || ':0',
    GM_ASKPASS_SOCK: join(dir, 'askpass.sock'),
    GM_ASKPASS_TOKEN: token
  }
}

export function tmpDir(): string {
  return dir
}

export function startAskpass(): void {
  // Private 0700 directory for the helper, its socket and temp files.
  dir = mkdtempSync(join(tmpdir(), 'linux-tree-'))
  chmodSync(dir, 0o700)
  writeFileSync(join(dir, 'askpass.js'), CLIENT_JS)
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  writeFileSync(
    join(dir, 'askpass.sh'),
    `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${q(process.execPath)} ${q(join(dir, 'askpass.js'))} "$@"\n`,
    { mode: 0o700 }
  )

  server = createServer({ allowHalfOpen: true }, (sock) => {
    let buf = ''
    sock.on('data', (d) => (buf += d))
    sock.on('end', async () => {
      let answer: string | null = null
      try {
        const req = JSON.parse(buf)
        if (req.token === token) answer = await ask(String(req.prompt ?? ''))
      } catch {
        /* malformed */
      }
      sock.end(JSON.stringify(answer === null ? { ok: false } : { ok: true, value: answer }))
    })
    sock.on('error', () => {})
  })
  server.listen(join(dir, 'askpass.sock'))

  ipcMain.on('askpass:reply', (_e, id: number, value: string | null) => {
    pending.get(id)?.(value)
    pending.delete(id)
  })

  app.on('will-quit', () => {
    server?.close()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })
}

function ask(prompt: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win) return Promise.resolve(null)
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    win.webContents.send('askpass:request', { id, prompt })
  })
}
