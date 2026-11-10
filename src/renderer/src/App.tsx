import { Toast, toast, useTheme } from '@heroui/react'
import { KeyRound, ShieldQuestion } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDialog } from './components/Dialog'
import { Home, type RecentRepo } from './components/Home'
import { RepoWorkspace } from './components/RepoWorkspace'
import { TabBar, tabNames, type TabInfo } from './components/TabBar'
import { notifyError } from './components/ui'
import { Repo } from './lib/git'

interface StoredSettings {
  recent?: (RecentRepo | string)[]
  tabs?: string[]
  active?: string | null
}

const MAX_RECENT = 30
const Workspace = memo(RepoWorkspace)

export default function App() {
  const dialog = useDialog()
  const { theme, setTheme } = useTheme('system')
  const [loaded, setLoaded] = useState(false)
  const [recent, setRecent] = useState<RecentRepo[]>([])
  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [tabInfo, setTabInfo] = useState<Record<string, { head: string | null; changes: number }>>({})
  const activeRef = useRef(active)
  activeRef.current = active

  // ---------- settings: load once, then save on every change ----------

  useEffect(() => {
    window.api.getSettings().then(async (s: StoredSettings) => {
      const rec = (s?.recent ?? [])
        .map((r) => (typeof r === 'string' ? { path: r, lastOpened: 0 } : r))
        .filter((r): r is RecentRepo => !!r?.path)
      const valid: string[] = []
      const missing: string[] = []
      for (const p of s?.tabs ?? []) {
        const top = await Repo.isRepo(p)
        if (top) {
          if (!valid.includes(top)) valid.push(top)
        } else missing.push(p)
      }
      setRecent(rec)
      setTabs(valid)
      setActive(s?.active && valid.includes(s.active) ? s.active : null)
      setLoaded(true)
      if (missing.length) {
        toast.warning(`Couldn't reopen ${missing.length} tab${missing.length > 1 ? 's' : ''}`, {
          description: missing.join('\n') + '\nThe folder was moved or is no longer a Git repository.'
        })
      }
    })
  }, [])

  useEffect(() => {
    if (loaded) window.api.setSettings({ recent, tabs, active })
  }, [recent, tabs, active, loaded])

  // ---------- tabs ----------

  const openRepo = useCallback(async (p: string) => {
    const top = await Repo.isRepo(p)
    if (!top) {
      notifyError('Not a Git repository', `${p} is not inside a Git repository.`)
      return
    }
    setRecent((prev) => [{ path: top, lastOpened: Date.now() }, ...prev.filter((r) => r.path !== top)].slice(0, MAX_RECENT))
    setTabs((prev) => {
      if (prev.includes(top)) return prev
      const at = activeRef.current ? prev.indexOf(activeRef.current) + 1 : prev.length
      return [...prev.slice(0, at), top, ...prev.slice(at)]
    })
    setActive(top)
  }, [])

  const pickRepo = useCallback(() => {
    window.api.pickRepo().then((p) => {
      if (p) openRepo(p)
    })
  }, [openRepo])

  const closeTab = useCallback(
    (p: string) => {
      const i = tabs.indexOf(p)
      const next = tabs.filter((t) => t !== p)
      setTabs(next)
      if (active === p) setActive(next[i] ?? next[i - 1] ?? null)
      setTabInfo(({ [p]: _, ...rest }) => rest)
    },
    [tabs, active]
  )

  const reorder = useCallback((from: number, to: number) => {
    setTabs((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  const onStateChange = useCallback((p: string, info: { head: string | null; changes: number }) => {
    setTabInfo((prev) => (prev[p]?.head === info.head && prev[p]?.changes === info.changes ? prev : { ...prev, [p]: info }))
  }, [])

  // ---------- keyboard shortcuts ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      const cycle = (dir: 1 | -1) => {
        if (!tabs.length) return
        const i = active ? tabs.indexOf(active) : dir === 1 ? -1 : 0
        setActive(tabs[(i + dir + tabs.length) % tabs.length])
      }
      if (k === 'o') pickRepo()
      else if (k === 't') setActive(null)
      else if (k === 'w') {
        if (active) closeTab(active)
      } else if (k === 'tab') cycle(e.shiftKey ? -1 : 1)
      else if (k === 'pagedown') cycle(1)
      else if (k === 'pageup') cycle(-1)
      else if (/^[1-9]$/.test(k) && tabs.length) setActive(k === '9' ? tabs[tabs.length - 1] : (tabs[+k - 1] ?? active))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tabs, active, pickRepo, closeTab])

  // ---------- SSH prompts (key passphrase, unknown host) from the askpass helper ----------

  useEffect(() => {
    return window.api.onAskpass(async ({ id, prompt }) => {
      if (/yes\/no/i.test(prompt)) {
        const v = await dialog.prompt({
          title: 'Unknown SSH host',
          icon: <ShieldQuestion className="size-5" />,
          size: 'md',
          message: <pre className="font-mono text-xs whitespace-pre-wrap">{prompt}</pre>,
          okLabel: 'Trust and connect'
        })
        window.api.askpassReply(id, v ? 'yes' : 'no')
        return
      }
      const v = await dialog.prompt({
        title: 'SSH authentication',
        icon: <KeyRound className="size-5" />,
        message: prompt,
        fields: [{ name: 'secret', label: /passphrase/i.test(prompt) ? 'Passphrase' : 'Password', type: 'password' }],
        okLabel: 'Unlock'
      })
      window.api.askpassReply(id, v ? String(v.secret) : null)
    })
  }, [dialog])

  // ---------- render ----------

  const names = useMemo(() => tabNames(tabs), [tabs])
  const tabList: TabInfo[] = tabs.map((p) => ({ path: p, name: names.get(p) ?? p, ...tabInfo[p] }))

  useEffect(() => {
    document.title = active ? `${names.get(active)} — Linux Tree` : 'Linux Tree'
  }, [active, names])

  const cycleTheme = () => setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TabBar
        tabs={tabList}
        active={active}
        onSelect={setActive}
        onClose={closeTab}
        onNew={() => setActive(null)}
        onReorder={reorder}
        theme={theme}
        onCycleTheme={cycleTheme}
      />
      <div className="relative min-h-0 flex-1">
        {loaded && active === null && (
          <Home recent={recent} openTabs={tabs} onOpen={openRepo} onPick={pickRepo} onRemove={(p) => setRecent((prev) => prev.filter((r) => r.path !== p))} />
        )}
        {tabs.map((p) => (
          <div key={p} className={p === active ? 'h-full' : 'hidden'}>
            <Workspace path={p} active={p === active} onStateChange={onStateChange} />
          </div>
        ))}
      </div>
      <Toast.Provider placement="bottom end" />
    </div>
  )
}
