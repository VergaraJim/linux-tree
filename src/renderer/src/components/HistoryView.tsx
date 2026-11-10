import { Button, Label, ListBox, SearchField, Select, Tooltip } from '@heroui/react'
import { Copy, GitCommitHorizontal, GitMerge, Tag } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react'
import type { Repo } from '../lib/git'
import type { Commit, CommitDetail, FileChange } from '../lib/types'
import { layoutGraph, laneColor, laneX, LANE_W, ROW_H, type GraphRow } from '../lib/graph'
import { DiffView, EmptyHint } from './DiffView'
import { Avatar, formatDate, StatusIcon } from './ui'

const PAGE = 400

interface Props {
  repo: Repo
  reloadKey: number
  remotes: string[]
  selectRef: { ref: string; nonce: number } | null
  onCommitMenu: (e: MouseEvent, c: Commit) => void
  onError: (e: unknown) => void
}

export function HistoryView({ repo, reloadKey, remotes, selectRef, onCommitMenu, onError }: Props) {
  const [commits, setCommits] = useState<Commit[]>([])
  const [loaded, setLoaded] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [allBranches, setAllBranches] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [selFile, setSelFile] = useState<FileChange | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)
  const [bottomH, setBottomH] = useState(340)
  const listRef = useRef<HTMLDivElement>(null)
  const pendingRef = useRef<string | null>(null)

  // Load log.
  useEffect(() => {
    let cancelled = false
    repo
      .log(limit, allBranches, remotes)
      .then((c) => {
        if (cancelled) return
        setCommits(c)
        setLoaded(true)
      })
      .catch(onError)
    return () => {
      cancelled = true
    }
  }, [repo, reloadKey, limit, allBranches, remotes.join(',')])

  const graph = useMemo(() => layoutGraph(commits), [commits])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    return commits.filter(
      (c) =>
        c.subject.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.hash.startsWith(q) ||
        c.refs.some((r) => r.name.toLowerCase().includes(q))
    )
  }, [commits, search])
  const list = filtered ?? commits
  const graphW = filtered ? 0 : Math.min(graph.maxLanes * LANE_W + 12, 280)

  // Track viewport height for virtualization.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scrollToIndex = (i: number) => {
    const el = listRef.current
    if (!el) return
    const top = i * ROW_H
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - ROW_H * 2) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3)
    }
  }

  const selectHash = (hash: string) => {
    pendingRef.current = hash
    const i = commits.findIndex((c) => c.hash === hash)
    if (i >= 0) {
      setSearch('')
      setSelected(hash)
      requestAnimationFrame(() => scrollToIndex(i))
      pendingRef.current = null
    } else {
      setSelected(hash)
      if (commits.length >= limit && limit < 20000) setLimit((l) => l + PAGE * 5)
    }
  }

  // Jump to a branch/tag selected in the sidebar.
  useEffect(() => {
    if (!selectRef) return
    setSearch('')
    repo.tryRun(['rev-parse', '--verify', '-q', `${selectRef.ref}^{commit}`]).then((h) => {
      const hash = h?.trim()
      if (hash) selectHash(hash)
    })
  }, [selectRef?.nonce])

  useEffect(() => {
    const h = pendingRef.current
    if (!h) return
    const i = commits.findIndex((c) => c.hash === h)
    if (i >= 0) {
      setSelected(h)
      requestAnimationFrame(() => scrollToIndex(i))
      pendingRef.current = null
    }
  }, [commits])

  // Load details of the selected commit.
  useEffect(() => {
    setDetail(null)
    setSelFile(null)
    setDiff(null)
    if (!selected) return
    let cancelled = false
    repo
      .commitDetail(selected)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        if (d.files.length) setSelFile(d.files[0])
      })
      .catch(onError)
    return () => {
      cancelled = true
    }
  }, [selected, repo])

  useEffect(() => {
    if (!selected || !selFile) return
    let cancelled = false
    repo
      .commitDiff(selected, selFile)
      .then((d) => !cancelled && setDiff(d))
      .catch(onError)
    return () => {
      cancelled = true
    }
  }, [selFile, selected, repo])

  const onScroll = () => {
    const el = listRef.current!
    setScrollTop(el.scrollTop)
    if (!filtered && el.scrollTop + el.clientHeight > el.scrollHeight - ROW_H * 40 && commits.length >= limit) {
      setLimit((l) => l + PAGE)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = list.findIndex((c) => c.hash === selected)
    const next = Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
    if (list[next]) {
      setSelected(list[next].hash)
      scrollToIndex(next)
    }
  }

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 10)
  const end = Math.min(list.length, Math.ceil((scrollTop + viewH) / ROW_H) + 10)
  const indexOf = useMemo(() => new Map(commits.map((c, i) => [c.hash, i])), [commits])

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const y0 = e.clientY
    const h0 = bottomH
    const move = (ev: globalThis.MouseEvent) =>
      setBottomH(Math.max(140, Math.min(window.innerHeight - 260, h0 - (ev.clientY - y0))))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const graphCol = Math.max(graphW, 56)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Filters */}
      <div className="flex flex-none items-center gap-2 border-b border-separator px-3 py-2">
        <Select
          aria-label="Branches to show"
          variant="secondary"
          className="w-44"
          value={allBranches ? 'all' : 'current'}
          onChange={(k) => setAllBranches(k === 'all')}
        >
          <Select.Trigger className="h-8 min-h-8">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="all" textValue="All branches">
                All branches
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="current" textValue="Current branch">
                Current branch
                <ListBox.ItemIndicator />
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
        <SearchField aria-label="Search commits" variant="secondary" value={search} onChange={setSearch} className="max-w-md flex-1">
          <SearchField.Group className="h-8 min-h-8">
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search message, author, hash or ref…" spellCheck={false} />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <span className="ml-auto text-xs text-muted tabular-nums">
          {filtered ? `${filtered.length} of ` : ''}
          {commits.length.toLocaleString()} commits
        </span>
      </div>

      {/* Column headers */}
      <div className="flex h-7 flex-none items-center border-b border-separator text-[11px] font-semibold tracking-wide text-muted uppercase">
        <div className="pl-3" style={{ width: graphCol }}>
          Graph
        </div>
        <div className="min-w-0 flex-1 px-2">Description</div>
        <div className="w-36 flex-none px-2">Date</div>
        <div className="w-44 flex-none px-2">Author</div>
        <div className="w-20 flex-none px-2">Commit</div>
      </div>

      {/* Commit list */}
      <div className="relative min-h-24 flex-1 overflow-auto outline-none" ref={listRef} onScroll={onScroll} tabIndex={0} onKeyDown={onKeyDown}>
        <div style={{ height: list.length * ROW_H, position: 'relative' }}>
          {list.slice(start, end).map((c, k) => {
            const i = start + k
            const gi = indexOf.get(c.hash)!
            return (
              <div
                key={c.hash}
                className={`log-row${selected === c.hash ? ' selected' : ''}`}
                style={{ top: i * ROW_H, height: ROW_H }}
                onMouseDown={() => setSelected(c.hash)}
                onContextMenu={(e) => {
                  setSelected(c.hash)
                  onCommitMenu(e, c)
                }}
              >
                <div className="flex-none" style={{ width: graphCol }}>
                  {!filtered && <GraphCell commit={c} row={graph.rows[gi]} width={graphW} />}
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2">
                  {c.refs.map((r) => (
                    <span key={r.kind + r.name} className={`ref-pill ref-${r.kind}`}>
                      {r.kind === 'tag' && <Tag className="size-3" />}
                      {r.name}
                    </span>
                  ))}
                  <span className={`truncate ${c.parents.length > 1 ? 'text-muted' : ''}`}>{c.subject}</span>
                </div>
                <div className="w-36 flex-none px-2 text-xs text-muted tabular-nums">{formatDate(c.date)}</div>
                <div className="flex w-44 flex-none items-center gap-2 px-2" title={c.email}>
                  <Avatar name={c.author} email={c.email} size={18} />
                  <span className="truncate text-[13px]">{c.author}</span>
                </div>
                <div className="w-20 flex-none px-2 font-mono text-xs text-muted">{c.hash.slice(0, 7)}</div>
              </div>
            )
          })}
        </div>
        {loaded && list.length === 0 && (
          <EmptyHint icon={<GitCommitHorizontal className="size-8 opacity-40" />}>{filtered ? 'No matching commits' : 'No commits yet'}</EmptyHint>
        )}
      </div>

      <div className="splitter-h" onMouseDown={startDrag} />

      {/* Commit details */}
      <div className="flex min-h-0 flex-none" style={{ height: bottomH }}>
        <div className="flex w-[38%] min-w-72 flex-col overflow-hidden border-r border-separator">
          {detail ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <CommitMeta detail={detail} onSelect={selectHash} />
              <div className="flex h-8 flex-none items-center px-3 text-[11px] font-semibold tracking-wide text-muted uppercase">
                {detail.files.length} file{detail.files.length === 1 ? '' : 's'} changed
              </div>
              <div className="px-1.5 pb-2">
                {detail.files.map((f) => (
                  <div
                    key={f.path}
                    className={`list-row h-7 px-2 ${selFile?.path === f.path ? 'selected' : ''}`}
                    onClick={() => setSelFile(f)}
                    title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                  >
                    <StatusIcon status={f.status} />
                    <FileName path={f.path} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyHint icon={<GitCommitHorizontal className="size-8 opacity-40" />}>Select a commit to see its details</EmptyHint>
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-auto">
          <DiffView diff={selFile ? diff : null} placeholder={detail ? 'Select a file' : ' '} />
        </div>
      </div>
    </div>
  )
}

export function FileName({ path }: { path: string }) {
  const i = path.lastIndexOf('/')
  return (
    <span className="truncate">
      {i >= 0 && <span className="text-muted">{path.slice(0, i + 1)}</span>}
      {path.slice(i + 1)}
    </span>
  )
}

function CommitMeta({ detail, onSelect }: { detail: CommitDetail; onSelect: (hash: string) => void }) {
  const [subject, ...rest] = detail.body.split('\n')
  const body = rest.join('\n').trim()
  return (
    <div className="selectable-text flex flex-none flex-col gap-3 border-b border-separator p-4">
      <div>
        <div className="text-[15px] leading-snug font-semibold">{subject}</div>
        {body && <div className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap text-muted">{body}</div>}
      </div>
      <div className="flex items-center gap-2.5">
        <Avatar name={detail.author} email={detail.email} size={28} />
        <div className="min-w-0 leading-tight">
          <div className="truncate font-medium">{detail.author}</div>
          <div className="truncate text-xs text-muted">
            {detail.email} · {formatDate(detail.date)}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Tooltip delay={400}>
          <Button size="sm" variant="secondary" className="h-6 gap-1.5 px-2 font-mono text-xs" onPress={() => window.api.copy(detail.hash)}>
            {detail.hash.slice(0, 10)}
            <Copy className="size-3" />
          </Button>
          <Tooltip.Content>Copy full SHA</Tooltip.Content>
        </Tooltip>
        {detail.parents.length > 0 && (
          <>
            <span className="ml-1 flex items-center gap-1 text-muted">
              {detail.parents.length > 1 ? <GitMerge className="size-3.5" /> : null}
              {detail.parents.length > 1 ? 'Parents' : 'Parent'}
            </span>
            {detail.parents.map((p) => (
              <Button key={p} size="sm" variant="ghost" className="h-6 px-1.5 font-mono text-xs text-accent" onPress={() => onSelect(p)}>
                {p.slice(0, 7)}
              </Button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

const GraphCell = memo(function GraphCell({ commit: c, row, width }: { commit: Commit; row: GraphRow; width: number }) {
  const mid = ROW_H / 2
  const els: JSX.Element[] = []
  const seg = (key: string, x1: number, y1: number, x2: number, y2: number, color: string) => {
    if (x1 === x2) {
      els.push(<line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} />)
    } else {
      const my = (y1 + y2) / 2
      els.push(<path key={key} d={`M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`} stroke={color} strokeWidth={2} fill="none" />)
    }
  }
  row.before.forEach((h, i) => {
    if (!h) return
    if (h === c.hash) seg(`in${i}`, laneX(i), 0, laneX(row.col), mid, laneColor(i))
    else {
      const j = row.after.indexOf(h)
      if (j !== -1) seg(`pass${i}`, laneX(i), 0, laneX(j), ROW_H, laneColor(j))
    }
  })
  c.parents.forEach((p, k) => {
    const j = row.after.indexOf(p)
    if (j !== -1) seg(`out${k}`, laneX(row.col), mid, laneX(j), ROW_H, laneColor(k === 0 ? row.col : j))
  })
  const color = laneColor(row.col)
  const x = laneX(row.col)
  const isHead = c.refs.some((r) => r.kind === 'head')
  return (
    <svg width={width} height={ROW_H} className="block">
      {els}
      {isHead && <circle cx={x} cy={mid} r={8} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={3} />}
      {c.parents.length > 1 ? (
        <circle cx={x} cy={mid} r={4.5} fill="var(--graph-bg)" stroke={color} strokeWidth={2.5} />
      ) : (
        <circle cx={x} cy={mid} r={5} fill={color} stroke="var(--graph-bg)" strokeWidth={1.5} />
      )}
    </svg>
  )
})
