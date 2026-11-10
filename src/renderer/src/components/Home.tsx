import { Button, Kbd, SearchField, Tooltip } from '@heroui/react'
import { AlertCircle, Clock, FolderOpen, FolderPlus, FolderSearch, GitBranch, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { timeAgo } from './ui'

export interface RecentRepo {
  path: string
  lastOpened: number
}

interface RepoInfo {
  exists: boolean
  branch: string | null
}

interface Props {
  recent: RecentRepo[]
  openTabs: string[]
  onOpen: (path: string) => void
  onPick: () => void
  onNew: () => void
  onRemove: (path: string) => void
}

export function AppLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <rect x="16" y="16" width="480" height="480" rx="110" fill="#1e2a3d" />
      <path d="M176 128 V384" stroke="#4fa3ff" strokeWidth="38" strokeLinecap="round" fill="none" />
      <path d="M176 330 C176 250 336 270 336 190" stroke="#e5a33a" strokeWidth="38" strokeLinecap="round" fill="none" />
      <circle cx="176" cy="128" r="44" fill="#4fa3ff" />
      <circle cx="176" cy="384" r="44" fill="#4fa3ff" />
      <circle cx="336" cy="170" r="44" fill="#e5a33a" />
    </svg>
  )
}

function RepoTile({ name }: { name: string }) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  return (
    <span
      className="flex size-10 flex-none items-center justify-center rounded-xl text-base font-bold"
      style={{ background: `oklch(0.62 0.12 ${hue} / 0.18)`, color: `oklch(0.7 0.14 ${hue})` }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function Home({ recent, openTabs, onOpen, onPick, onNew, onRemove }: Props) {
  const [query, setQuery] = useState('')
  const [info, setInfo] = useState<Record<string, RepoInfo>>({})

  // Look up existence + current branch of each recent repo.
  const key = recent.map((r) => r.path).join('\n')
  useEffect(() => {
    let cancelled = false
    Promise.all(
      recent.map(async (r): Promise<[string, RepoInfo]> => {
        const exists = await window.api.exists('/', r.path)
        if (!exists) return [r.path, { exists: false, branch: null }]
        const res = await window.api.git(r.path, ['symbolic-ref', '--short', '-q', 'HEAD'])
        if (res.ok) return [r.path, { exists: true, branch: res.stdout.trim() }]
        const sha = await window.api.git(r.path, ['rev-parse', '--short', 'HEAD'])
        return [r.path, { exists: true, branch: sha.ok ? `detached ${sha.stdout.trim()}` : null }]
      })
    ).then((entries) => !cancelled && setInfo(Object.fromEntries(entries)))
    return () => {
      cancelled = true
    }
  }, [key])

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...recent].sort((a, b) => b.lastOpened - a.lastOpened).filter((r) => !q || r.path.toLowerCase().includes(q))
  }, [recent, query])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-8 pt-[8vh] pb-16">
        {/* Hero */}
        <div className="animate-fade-in flex items-center gap-5">
          <AppLogo className="size-16 flex-none drop-shadow-lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Linux Tree</h1>
            <p className="mt-1 text-sm text-muted">
              A fast Git client with built-in <span className="whitespace-nowrap">git-flow</span>.
            </p>
          </div>
          <Button variant="secondary" onPress={onNew} className="gap-2">
            <FolderPlus className="size-4" />
            New repository
          </Button>
          <Button variant="primary" onPress={onPick} className="gap-2">
            <FolderOpen className="size-4" />
            Open repository
          </Button>
        </div>

        {/* Recent */}
        <section className="animate-fade-in flex flex-col gap-3" style={{ animationDelay: '60ms' }}>
          <div className="flex items-center gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="size-4 text-muted" />
              Recent repositories
            </h2>
            {recent.length > 4 && (
              <SearchField aria-label="Filter repositories" value={query} onChange={setQuery} className="ml-auto w-64">
                <SearchField.Group className="h-8 min-h-8">
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="Filter…" spellCheck={false} />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
            )}
          </div>

          {recent.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-secondary px-6 py-14 text-center">
              <FolderSearch className="size-10 text-muted opacity-60" strokeWidth={1.5} />
              <div>
                <div className="font-medium">No repositories yet</div>
                <div className="mt-1 text-sm text-muted">Open a folder that contains a Git repository, or create a new one.</div>
              </div>
              <div className="mt-1 flex gap-2">
                <Button variant="secondary" size="sm" onPress={onPick} className="gap-2">
                  <FolderOpen className="size-4" /> Open repository
                </Button>
                <Button variant="secondary" size="sm" onPress={onNew} className="gap-2">
                  <FolderPlus className="size-4" /> New repository
                </Button>
              </div>
            </div>
          ) : sorted.length === 0 ? (
            <div className="px-1 py-6 text-sm text-muted">No repositories match “{query}”.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {sorted.map((r) => {
                const name = r.path.split('/').filter(Boolean).pop() ?? r.path
                const i = info[r.path]
                const missing = i && !i.exists
                const isOpen = openTabs.includes(r.path)
                return (
                  <div
                    key={r.path}
                    role="button"
                    tabIndex={0}
                    onClick={() => !missing && onOpen(r.path)}
                    onKeyDown={(e) => e.key === 'Enter' && !missing && onOpen(r.path)}
                    className={`group flex items-center gap-3.5 rounded-xl bg-surface px-3.5 py-3 shadow-surface transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                      missing ? 'opacity-60' : 'cursor-pointer hover:bg-surface-hover'
                    }`}
                  >
                    <RepoTile name={name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold">{name}</span>
                        {isOpen && (
                          <span className="flex-none rounded-full bg-accent-soft px-2 text-[11px] leading-5 font-medium text-accent-soft-foreground">
                            Open
                          </span>
                        )}
                        {missing && (
                          <span className="flex flex-none items-center gap-1 rounded-full bg-danger-soft px-2 text-[11px] leading-5 font-medium text-danger-soft-foreground">
                            <AlertCircle className="size-3" /> Not found
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-xs text-muted">{r.path}</div>
                    </div>
                    <div className="flex flex-none flex-col items-end gap-1 text-xs text-muted">
                      {i?.branch && (
                        <span className="flex max-w-44 items-center gap-1 truncate text-foreground/80">
                          <GitBranch className="size-3.5 flex-none text-accent" />
                          <span className="truncate">{i.branch}</span>
                        </span>
                      )}
                      {r.lastOpened > 0 && <span>{timeAgo(r.lastOpened)}</span>}
                    </div>
                    <div className="flex flex-none gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                      {!missing && (
                        <Tooltip delay={400}>
                          <Button isIconOnly variant="ghost" size="sm" aria-label="Show in file manager" onPress={() => window.api.openPath(r.path)}>
                            <FolderOpen className="size-4" />
                          </Button>
                          <Tooltip.Content>Show in file manager</Tooltip.Content>
                        </Tooltip>
                      )}
                      <Tooltip delay={400}>
                        <Button isIconOnly variant="ghost" size="sm" aria-label="Remove from list" onPress={() => onRemove(r.path)}>
                          <X className="size-4" />
                        </Button>
                        <Tooltip.Content>Remove from list</Tooltip.Content>
                      </Tooltip>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Shortcuts */}
        <section className="animate-fade-in flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted" style={{ animationDelay: '120ms' }}>
          {[
            [['ctrl', 'O'], 'Open repository'],
            [['ctrl', 'N'], 'New repository'],
            [['ctrl', 'T'], 'Home / new tab'],
            [['ctrl', 'W'], 'Close tab'],
            [['ctrl', 'Tab'], 'Next tab'],
            [['ctrl', '1–9'], 'Jump to tab'],
            [['F5'], 'Refresh']
          ].map(([keys, label]) => (
            <span key={label as string} className="flex items-center gap-2">
              <Kbd className="text-[11px]">
                {(keys as string[]).map((k) =>
                  k === 'ctrl' ? <Kbd.Abbr key={k} keyValue="ctrl" /> : <Kbd.Content key={k}>{k}</Kbd.Content>
                )}
              </Kbd>
              {label as string}
            </span>
          ))}
        </section>
      </div>
    </div>
  )
}
