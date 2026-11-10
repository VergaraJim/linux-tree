import { contextBridge, ipcRenderer } from 'electron'

export interface GitResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

const api = {
  git: (cwd: string, args: string[], opts?: { input?: string; env?: Record<string, string> }): Promise<GitResult> =>
    ipcRenderer.invoke('git:run', cwd, args, opts),
  exists: (cwd: string, p: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', cwd, p),
  writeTemp: (content: string): Promise<string> => ipcRenderer.invoke('tmp:write', content),
  onAskpass: (cb: (req: { id: number; prompt: string }) => void) => {
    const h = (_e: unknown, req: { id: number; prompt: string }): void => cb(req)
    ipcRenderer.on('askpass:request', h)
    return (): void => {
      ipcRenderer.removeListener('askpass:request', h)
    }
  },
  askpassReply: (id: number, value: string | null) => ipcRenderer.send('askpass:reply', id, value),
  pickRepo: (): Promise<string | null> => ipcRenderer.invoke('repo:pick'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s: unknown) => ipcRenderer.invoke('settings:set', s),
  openPath: (p: string) => ipcRenderer.invoke('shell:open', p),
  copy: (t: string) => ipcRenderer.invoke('clipboard:write', t),
  onFocus: (cb: () => void) => {
    const h = (): void => cb()
    ipcRenderer.on('window:focus', h)
    return (): void => {
      ipcRenderer.removeListener('window:focus', h)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
