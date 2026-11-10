import { Button, Tooltip } from '@heroui/react'
import { FolderGit2, Monitor, Moon, Plus, Sun, X } from 'lucide-react'
import { useState } from 'react'
import { AppLogo } from './Home'

export interface TabInfo {
  path: string
  name: string
  head?: string | null
  changes?: number
}

interface Props {
  tabs: TabInfo[]
  active: string | null
  onSelect: (path: string | null) => void
  onClose: (path: string) => void
  onNew: () => void
  onReorder: (from: number, to: number) => void
  theme: string
  onCycleTheme: () => void
}

/** Display names: folder name, or parent/folder when two open repos share a name. */
export function tabNames(paths: string[]): Map<string, string> {
  const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p
  const counts = new Map<string, number>()
  for (const p of paths) counts.set(base(p), (counts.get(base(p)) ?? 0) + 1)
  return new Map(
    paths.map((p) => {
      const parts = p.split('/').filter(Boolean)
      return [p, (counts.get(base(p)) ?? 0) > 1 && parts.length > 1 ? parts.slice(-2).join('/') : base(p)]
    })
  )
}

export function TabBar({ tabs, active, onSelect, onClose, onNew, onReorder, theme, onCycleTheme }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor

  return (
    <div className="flex h-11 flex-none items-center gap-1 px-2 pt-1">
      <Tooltip delay={500}>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Home"
          onPress={() => onSelect(null)}
          className={`h-8 min-w-0 flex-none gap-2 rounded-lg px-2.5 text-[13px] font-semibold ${
            active === null ? 'bg-surface text-foreground shadow-surface' : 'text-muted'
          }`}
        >
          <AppLogo className="size-5" />
          {tabs.length === 0 && <span>Linux Tree</span>}
        </Button>
        <Tooltip.Content>Home — recent repositories (Ctrl+T)</Tooltip.Content>
      </Tooltip>

      {tabs.length > 0 && <div className="mx-0.5 h-5 w-px flex-none bg-separator" />}

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((t, i) => {
          const isActive = t.path === active
          return (
            <div
              key={t.path}
              role="tab"
              aria-selected={isActive}
              draggable
              title={`${t.path}${t.head ? `\nBranch: ${t.head}` : ''}${t.changes ? `\n${t.changes} uncommitted change(s)` : ''}`}
              onClick={() => onSelect(t.path)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  onClose(t.path)
                }
              }}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onDragStart={(e) => {
                setDragFrom(i)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (dragFrom === null) return
                e.preventDefault()
                const r = e.currentTarget.getBoundingClientRect()
                setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragFrom !== null && dropAt !== null) onReorder(dragFrom, dropAt > dragFrom ? dropAt - 1 : dropAt)
                setDragFrom(null)
                setDropAt(null)
              }}
              onDragEnd={() => {
                setDragFrom(null)
                setDropAt(null)
              }}
              className={`group relative flex h-8 max-w-56 min-w-28 flex-none cursor-default items-center gap-2 rounded-lg pr-1.5 pl-2.5 text-[13px] transition-colors ${
                isActive ? 'bg-surface font-medium text-foreground shadow-surface' : 'text-muted hover:bg-default/60 hover:text-foreground'
              } ${dragFrom === i ? 'opacity-50' : ''} ${dropAt === i && dragFrom !== null && dragFrom !== i ? 'tab-drop-before' : ''}`}
            >
              <FolderGit2 className={`size-4 flex-none ${isActive ? 'text-accent' : ''}`} />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {!!t.changes && <span className="size-1.5 flex-none rounded-full bg-warning" aria-label="Uncommitted changes" />}
              <button
                type="button"
                aria-label={`Close ${t.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(t.path)
                }}
                className={`flex size-5 flex-none items-center justify-center rounded-md hover:bg-default ${
                  isActive ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70 hover:opacity-100'
                }`}
              >
                <X className="size-3.5" />
              </button>
            </div>
          )
        })}
        <Tooltip delay={500}>
          <Button variant="ghost" size="sm" isIconOnly aria-label="New tab" onPress={onNew} className="size-8 min-w-8 flex-none rounded-lg text-muted">
            <Plus className="size-4" />
          </Button>
          <Tooltip.Content>Open another repository (Ctrl+T)</Tooltip.Content>
        </Tooltip>
      </div>

      <Tooltip delay={500}>
        <Button variant="ghost" size="sm" isIconOnly aria-label="Change theme" onPress={onCycleTheme} className="size-8 min-w-8 flex-none rounded-lg text-muted">
          <ThemeIcon className="size-4" />
        </Button>
        <Tooltip.Content>Theme: {theme} (click to change)</Tooltip.Content>
      </Tooltip>
    </div>
  )
}
