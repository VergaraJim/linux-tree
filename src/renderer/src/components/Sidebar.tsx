import { Archive, ChevronRight, Cloud, FileDiff, Folder, GitBranch, History, Tag } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { Branch, RepoState, Stash } from '../lib/types'

export type View = 'status' | 'history'

interface TreeNode {
  name: string
  key: string
  folders: Map<string, TreeNode>
  leaves: Branch[]
}

function buildTree(branches: Branch[], keyPrefix: string): TreeNode {
  const root: TreeNode = { name: '', key: keyPrefix, folders: new Map(), leaves: [] }
  for (const b of branches) {
    const parts = b.name.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      let next = node.folders.get(part)
      if (!next) {
        next = { name: part, key: `${node.key}/${part}`, folders: new Map(), leaves: [] }
        node.folders.set(part, next)
      }
      node = next
    }
    node.leaves.push(b)
  }
  return root
}

function loadCollapsed(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || '[]'))
  } catch {
    return new Set()
  }
}

interface Props {
  repoPath: string
  state: RepoState | null
  view: View
  onView: (v: View) => void
  onBranchOpen: (b: Branch) => void
  onBranchMenu: (e: MouseEvent, b: Branch) => void
  onRefSelect: (ref: string) => void
  onTagMenu: (e: MouseEvent, tag: string) => void
  onStashOpen: (s: Stash) => void
  onStashMenu: (e: MouseEvent, s: Stash) => void
  onRemoteMenu: (e: MouseEvent, remote: string) => void
  autoRefresh?: TimerProps
}

const ROW = 'list-row h-7 pr-2 text-[13px]'

export function Sidebar(p: Props) {
  const storageKey = `collapsed:${p.repoPath}`
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(storageKey))

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const s = p.state
  const changes = s ? s.status.staged.length + s.status.unstaged.length + s.status.conflicted.length : 0
  const local = s?.branches.filter((b) => !b.remote) ?? []
  const remote = s?.branches.filter((b) => b.remote) ?? []

  const renderTree = (node: TreeNode, depth: number): ReactNode => {
    const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name))
    const leaves = [...node.leaves].sort((a, b) => a.name.localeCompare(b.name))
    return (
      <>
        {folders.map((f) => {
          const isOpen = !collapsed.has(f.key)
          const isRemoteRoot = node.key === 'remote' && depth === 0
          return (
            <div key={f.key}>
              <div
                className={ROW}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => toggle(f.key)}
                onContextMenu={(e) => isRemoteRoot && p.onRemoteMenu(e, f.name)}
              >
                <Chevron open={isOpen} />
                {isRemoteRoot ? <Cloud className="size-4 flex-none text-muted" /> : <Folder className="size-4 flex-none text-muted" />}
                <span className="truncate">{f.name}</span>
              </div>
              {isOpen && renderTree(f, depth + 1)}
            </div>
          )
        })}
        {leaves.map((b) => (
          <div
            key={b.name}
            className={`${ROW} ${b.current ? 'font-semibold' : ''}`}
            style={{ paddingLeft: 26 + depth * 14 }}
            title={b.name + (b.upstream ? ` → ${b.upstream}` : '')}
            onClick={() => p.onRefSelect(b.name)}
            onDoubleClick={() => p.onBranchOpen(b)}
            onContextMenu={(e) => p.onBranchMenu(e, b)}
          >
            {b.current ? (
              <span className="flex size-4 flex-none items-center justify-center">
                <span className="size-2 rounded-full bg-accent ring-4 ring-accent/20" />
              </span>
            ) : (
              <GitBranch className="size-4 flex-none text-muted" />
            )}
            <span className="truncate">{b.name.split('/').pop()}</span>
            <TrackBadges b={b} />
          </div>
        ))}
      </>
    )
  }

  return (
    <aside className="flex w-64 flex-none flex-col overflow-y-auto px-2 pt-1 pb-6">
      <div className="flex flex-col gap-0.5">
        <NavItem current={p.view} onView={p.onView} v="status" icon={<FileDiff className="size-4" />} label="File status" badge={changes} />
        <NavItem current={p.view} onView={p.onView} v="history" icon={<History className="size-4" />} label="History" />
      </div>
      {p.autoRefresh && <RefreshTimer {...p.autoRefresh} />}
      <Section collapsed={collapsed} toggle={toggle} id="branches" title="Branches" icon={<GitBranch className="size-3.5" />} count={local.length}>
        {renderTree(buildTree(local, 'local'), 0)}
      </Section>
      <Section collapsed={collapsed} toggle={toggle} id="tags" title="Tags" icon={<Tag className="size-3.5" />} count={s?.tags.length ?? 0}>
        {s?.tags.map((t) => (
          <div key={t} className={ROW} style={{ paddingLeft: 26 }} onClick={() => p.onRefSelect(t)} onContextMenu={(e) => p.onTagMenu(e, t)}>
            <Tag className="size-4 flex-none text-muted" />
            <span className="truncate">{t}</span>
          </div>
        ))}
      </Section>
      <Section collapsed={collapsed} toggle={toggle} id="remotes" title="Remotes" icon={<Cloud className="size-3.5" />} count={s?.remotes.length ?? 0}>
        {renderTree(buildTree(remote, 'remote'), 0)}
      </Section>
      <Section collapsed={collapsed} toggle={toggle} id="stashes" title="Stashes" icon={<Archive className="size-3.5" />} count={s?.stashes.length ?? 0}>
        {s?.stashes.map((st) => (
          <div
            key={st.ref}
            className={ROW}
            style={{ paddingLeft: 26 }}
            title={`${st.ref}: ${st.message}`}
            onDoubleClick={() => p.onStashOpen(st)}
            onContextMenu={(e) => p.onStashMenu(e, st)}
          >
            <Archive className="size-4 flex-none text-muted" />
            <span className="truncate">{st.message}</span>
          </div>
        ))}
      </Section>
    </aside>
  )
}

function Chevron({ open }: { open: boolean }) {
  return <ChevronRight className={`size-3.5 flex-none text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
}

function Section(props: {
  collapsed: Set<string>
  toggle: (key: string) => void
  id: string
  title: string
  icon: ReactNode
  count?: number
  children: ReactNode
}) {
  const isOpen = !props.collapsed.has('section:' + props.id)
  return (
    <div className="mt-3">
      <div
        className="flex h-7 cursor-default items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wider text-muted uppercase hover:text-foreground"
        onClick={() => props.toggle('section:' + props.id)}
      >
        <Chevron open={isOpen} />
        {props.icon}
        <span>{props.title}</span>
        {props.count !== undefined && <span className="ml-auto font-medium tabular-nums">{props.count}</span>}
      </div>
      {isOpen && <div className="mt-0.5">{props.children}</div>}
    </div>
  )
}

interface TimerProps {
  ms: number
  /** Stop the timer (tab in background, git operation running). */
  paused: boolean
  /** Restart the cycle when this changes (e.g. after any refresh). */
  resetKey: number
  onTick: () => Promise<void>
}

/** Faint line that fills up over `ms`, then runs `onTick` and starts over.
 *  Timing uses setTimeout (the animation is only visual), and stops while the window is hidden. */
function RefreshTimer({ ms, paused, resetKey, onTick }: TimerProps) {
  const [cycle, setCycle] = useState(0)
  const [hidden, setHidden] = useState(() => document.hidden)
  const tick = useRef(onTick)
  tick.current = onTick

  useEffect(() => {
    const onVis = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const stopped = paused || hidden
  useEffect(() => {
    if (stopped) return
    let alive = true
    const t = setTimeout(async () => {
      await tick.current()
      if (alive) setCycle((c) => c + 1)
    }, ms)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [stopped, resetKey, cycle, ms])

  return (
    <div className="px-2.5 pt-3 pb-1" title={`Branches and commits refresh every ${ms / 1000} seconds`}>
      <div className="h-0.5 overflow-hidden rounded-full bg-foreground/[0.04]">
        {!stopped && <div key={`${resetKey}:${cycle}`} className="refresh-timer h-full rounded-full bg-accent/30" style={{ animationDuration: `${ms}ms` }} />}
      </div>
    </div>
  )
}

function NavItem(props: { current: View; onView: (v: View) => void; v: View; icon: ReactNode; label: string; badge?: number }) {
  const active = props.current === props.v
  return (
    <div className={`list-row h-8 px-2.5 font-medium ${active ? 'selected text-foreground' : 'text-foreground/85'}`} onClick={() => props.onView(props.v)}>
      <span className={active ? 'text-accent' : 'text-muted'}>{props.icon}</span>
      {props.label}
      {!!props.badge && (
        <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-accent-foreground tabular-nums">
          {props.badge}
        </span>
      )}
    </div>
  )
}

function TrackBadges({ b }: { b: Branch }) {
  if (!b.ahead && !b.behind && !b.gone) return null
  return (
    <span className="ml-auto flex flex-none gap-1 text-[11px] font-medium tabular-nums">
      {b.ahead > 0 && <span className="rounded bg-success-soft px-1 text-success-soft-foreground">↑{b.ahead}</span>}
      {b.behind > 0 && <span className="rounded bg-warning-soft px-1 text-warning-soft-foreground">↓{b.behind}</span>}
      {b.gone && <span className="rounded bg-danger-soft px-1 text-danger-soft-foreground">gone</span>}
    </span>
  )
}
