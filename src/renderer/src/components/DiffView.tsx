import { Button } from '@heroui/react'
import { FileCode2, MousePointerClick } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { isChange, parseDiff, type Hunk } from '../lib/patch'

const MAX_LINES = 5000

export type DiffMode = 'unstaged' | 'staged'
export type PatchTarget = 'stage' | 'unstage' | 'discard'

interface Props {
  diff: string | null
  placeholder?: string
  /** When set, hunks/lines get stage/unstage/discard actions. */
  mode?: DiffMode
  /** offsets: line offsets within the hunk (null = whole hunk). */
  onApply?: (hunkIndex: number, offsets: number[] | null, target: PatchTarget) => void
}

export function EmptyHint({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
      {icon ?? <FileCode2 className="size-8 opacity-40" strokeWidth={1.5} />}
      <div>{children}</div>
    </div>
  )
}

function DiffViewInner({ diff, placeholder, mode, onApply }: Props) {
  const parsed = useMemo(() => (diff ? parseDiff(diff) : null), [diff])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const anchor = useRef<number | null>(null)

  useEffect(() => {
    setSelected(new Set())
    anchor.current = null
  }, [diff])

  if (diff === null) return <EmptyHint>{placeholder ?? 'Select a file to see its changes'}</EmptyHint>
  if (!diff.trim() || !parsed) return <EmptyHint>No changes to show — binary file or mode change only</EmptyHint>

  const interactive = !!mode && !!onApply
  const binary = parsed.header.find((h) => h.startsWith('Binary files'))
  let budget = MAX_LINES

  const clickLine = (e: MouseEvent, hunk: Hunk, idx: number) => {
    const changes = hunk.lines.filter(isChange).map((l) => l.idx)
    setSelected((prev) => {
      const next = new Set(prev)
      if (e.shiftKey && anchor.current !== null && changes.includes(anchor.current)) {
        const [a, b] = [anchor.current, idx].sort((x, y) => x - y)
        for (const i of changes) if (i >= a && i <= b) next.add(i)
      } else if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
    anchor.current = idx
  }

  const apply = (hi: number, hunk: Hunk, target: PatchTarget, onlySelected: boolean) => {
    const offsets = onlySelected ? hunk.lines.map((l, i) => (selected.has(l.idx) ? i : -1)).filter((i) => i >= 0) : null
    onApply!(hi, offsets, target)
  }

  const plural = (n: number) => `${n} line${n > 1 ? 's' : ''}`

  return (
    <div className="diff">
      {binary && <div className="dl meta px-4 py-2">{binary}</div>}
      {parsed.hunks.map((hunk, hi) => {
        if (budget <= 0) return null
        const selInHunk = hunk.lines.filter((l) => selected.has(l.idx)).length
        let oldNo = hunk.oldStart
        let newNo = hunk.newStart
        const lines = hunk.lines.slice(0, budget)
        budget -= lines.length
        return (
          <div key={hi} className="hunk-block">
            <div className="hunk-header">
              <span className="truncate">{hunk.header}</span>
              {interactive && (
                <span className="ml-auto flex flex-none gap-1.5 font-sans">
                  {mode === 'unstaged' ? (
                    <>
                      <Button size="sm" variant="danger-soft" className="h-6 px-2 text-xs" onPress={() => apply(hi, hunk, 'discard', selInHunk > 0)}>
                        {selInHunk ? `Discard ${plural(selInHunk)}` : 'Discard hunk'}
                      </Button>
                      <Button size="sm" variant="primary" className="h-6 px-2 text-xs" onPress={() => apply(hi, hunk, 'stage', selInHunk > 0)}>
                        {selInHunk ? `Stage ${plural(selInHunk)}` : 'Stage hunk'}
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onPress={() => apply(hi, hunk, 'unstage', selInHunk > 0)}>
                      {selInHunk ? `Unstage ${plural(selInHunk)}` : 'Unstage hunk'}
                    </Button>
                  )}
                </span>
              )}
            </div>
            {lines.map((l) => {
              let o: number | string = ''
              let n: number | string = ''
              let cls = 'ctx'
              if (l.type === '+') {
                cls = 'add'
                n = newNo++
              } else if (l.type === '-') {
                cls = 'del'
                o = oldNo++
              } else if (l.type === '\\') {
                cls = 'meta'
              } else {
                o = oldNo++
                n = newNo++
              }
              const selectable = interactive && isChange(l)
              return (
                <div
                  key={l.idx}
                  className={`dl ${cls}${selectable ? ' selectable' : ''}${selected.has(l.idx) ? ' picked' : ''}`}
                  onMouseDown={
                    selectable
                      ? (e) => {
                          e.preventDefault()
                          clickLine(e, hunk, l.idx)
                        }
                      : undefined
                  }
                >
                  <span className="ln">{o}</span>
                  <span className="ln">{n}</span>
                  <span className="code">{l.text}</span>
                </div>
              )
            })}
          </div>
        )
      })}
      {budget <= 0 && <div className="dl meta px-4 py-2">… diff truncated</div>}
      {interactive && parsed.hunks.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 pt-4 font-sans text-xs text-muted">
          <MousePointerClick className="size-3.5" />
          Click lines to select them (Shift+click for a range), then use the buttons on the hunk header.
        </div>
      )}
    </div>
  )
}

export const DiffView = memo(DiffViewInner)
