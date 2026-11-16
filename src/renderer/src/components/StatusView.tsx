import { Button, Checkbox, TextArea } from '@heroui/react'
import { AlertTriangle, Check, CheckCheck, FileDiff, Minus, Plus, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { Repo } from '../lib/git'
import type { FileChange, WorkingStatus } from '../lib/types'
import { buildPatch, parseDiff } from '../lib/patch'
import { DiffView, EmptyHint, type PatchTarget } from './DiffView'
import { useDialog } from './Dialog'
import { FileName } from './HistoryView'
import { StatusIcon } from './ui'

interface Props {
  repo: Repo
  status: WorkingStatus
  reloadKey: number
  operation: string | null
  run: (label: string, fn: () => Promise<unknown>) => Promise<boolean>
  onCommit: (message: string, amend: boolean, push: boolean) => Promise<boolean>
  onFileMenu: (e: MouseEvent, f: FileChange, staged: boolean) => void
  onError: (e: unknown) => void
}

type Row = { path: string; staged: boolean }

export function StatusView({ repo, status, reloadKey, operation, run, onCommit, onFileMenu, onError }: Props) {
  const dialog = useDialog()
  const [selected, setSelected] = useState<Row[]>([])
  const anchor = useRef<Row | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [pushAfter, setPushAfter] = useState(() => {
    try {
      return localStorage.getItem('pushAfter') === '1'
    } catch {
      return false
    }
  })

  const unstagedAll = [...status.conflicted, ...status.unstaged]
  const primary: Row | null = selected.length ? selected[selected.length - 1] : null
  const find = (s: Row | null): FileChange | undefined =>
    s ? (s.staged ? status.staged : unstagedAll).find((f) => f.path === s.path) : undefined
  const selFile = find(primary)

  const selFiles = (staged: boolean): FileChange[] => {
    const list = staged ? status.staged : unstagedAll
    return selected
      .filter((s) => s.staged === staged)
      .map((s) => list.find((f) => f.path === s.path))
      .filter((f): f is FileChange => !!f)
  }
  const stagedSel = selFiles(true)
  const unstagedSel = selFiles(false)
  const canDiscard = unstagedSel.length > 0 && unstagedSel.every((f) => f.status !== '?' && f.status !== 'U')
  const canDelete = unstagedSel.length > 0 && unstagedSel.every((f) => f.status === '?')

  // Keep the selection valid after refreshes.
  useEffect(() => {
    setSelected((prev) => {
      const next: Row[] = []
      for (const s of prev) {
        if ((s.staged ? status.staged : unstagedAll).some((f) => f.path === s.path)) next.push(s)
        else if ((s.staged ? unstagedAll : status.staged).some((f) => f.path === s.path)) next.push({ path: s.path, staged: !s.staged })
      }
      return next.length === prev.length && next.every((r, i) => r.path === prev[i].path && r.staged === prev[i].staged) ? prev : next
    })
  }, [status])

  useEffect(() => {
    if (!selFile || !primary) {
      setDiff(null)
      return
    }
    let cancelled = false
    repo
      .workingDiff(selFile, primary.staged)
      .then((d) => !cancelled && setDiff(d))
      .catch(onError)
    return () => {
      cancelled = true
    }
  }, [primary?.path, primary?.staged, reloadKey, repo])

  // Amend: prefill the last commit message.
  useEffect(() => {
    if (!amend) return
    repo.tryRun(['log', '-1', '--format=%B']).then((m) => m && !message.trim() && setMessage(m.trim()))
  }, [amend])

  const toggleFile = (f: FileChange, staged: boolean) =>
    run(staged ? 'Unstaging…' : 'Staging…', () => (staged ? repo.unstage([f.path]) : repo.stage([f.path])))

  const discardFile = async (f: FileChange) => {
    if (await dialog.confirm('Discard changes', <>Discard all changes to <b>{f.path}</b>? This cannot be undone.</>, 'Discard', true))
      run('Discarding…', () => repo.discard([f]))
  }

  // Batch actions on the current multi-selection.
  const stageSelected = async () => {
    if (!unstagedSel.length) return
    if (await run('Staging…', () => repo.stage(unstagedSel.map((f) => f.path)))) setSelected([])
  }

  const unstageSelected = async () => {
    if (!stagedSel.length) return
    if (await run('Unstaging…', () => repo.unstage(stagedSel.map((f) => f.path)))) setSelected([])
  }

  const discardSelected = async () => {
    const n = unstagedSel.length
    if (!n || !canDiscard) return
    if (!(await dialog.confirm('Discard changes', <>Discard changes to <b>{n}</b> files? This cannot be undone.</>, 'Discard', true))) return
    if (await run('Discarding…', () => repo.discard(unstagedSel))) setSelected([])
  }

  const deleteSelected = async () => {
    const n = unstagedSel.length
    if (!n || !canDelete) return
    if (!(await dialog.confirm('Delete files', <>Delete <b>{n}</b> new files? This cannot be undone.</>, 'Delete', true))) return
    if (await run('Deleting…', () => repo.discard(unstagedSel))) setSelected([])
  }

  // Stage / unstage / discard a hunk or selected lines.
  const applyPartial = async (hunkIndex: number, offsets: number[] | null, target: PatchTarget) => {
    if (!selFile || !primary) return
    const file = selFile
    if (
      target === 'discard' &&
      !(await dialog.confirm(
        'Discard changes',
        <>
          Discard {offsets ? 'the selected lines' : 'this hunk'} in <b>{file.path}</b>? This cannot be undone.
        </>,
        'Discard',
        true
      ))
    )
      return
    await run(target === 'stage' ? 'Staging…' : target === 'unstage' ? 'Unstaging…' : 'Discarding…', async () => {
      let d = diff ?? ''
      if (file.status === '?') {
        // Untracked: register as intent-to-add so the file has an (empty) index entry.
        await repo.intentToAdd(file.path)
        d = await repo.workingDiff({ ...file, status: 'A' }, false)
      }
      const parsed = parseDiff(d)
      const hunk = parsed.hunks[hunkIndex]
      if (!hunk) throw new Error('The diff changed; please try again.')
      const selected = offsets ? new Set(offsets.map((o) => hunk.lines[o]?.idx).filter((i): i is number => i !== undefined)) : null
      const patch = buildPatch(parsed, hunk, selected, target !== 'stage')
      if (!patch) throw new Error('Select at least one added or removed line.')
      await repo.applyPatch(patch, target)
    })
  }

  const doCommit = async () => {
    if (!canCommit) return
    const ok = await onCommit(message.trim(), amend, pushAfter)
    if (ok) {
      setMessage('')
      setAmend(false)
    }
  }

  const canCommit = !!message.trim() && (status.staged.length > 0 || amend) && status.conflicted.length === 0
  const subjectLen = message.split('\n')[0].length

  const selectRow = (e: MouseEvent, f: FileChange, staged: boolean, files: FileChange[]) => {
    const row: Row = { path: f.path, staged }
    const sameList = anchor.current?.staged === staged
    if (e.shiftKey && sameList && primary?.staged === staged) {
      const a = files.findIndex((x) => x.path === anchor.current!.path)
      const b = files.findIndex((x) => x.path === f.path)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        setSelected(files.slice(lo, hi + 1).map((x) => ({ path: x.path, staged })))
        return
      }
    }
    if ((e.metaKey || e.ctrlKey) && primary?.staged === staged) {
      setSelected((prev) =>
        prev.some((s) => s.path === row.path) ? prev.filter((s) => s.path !== row.path) : [...prev, row]
      )
      anchor.current = row
      return
    }
    setSelected([row])
    anchor.current = row
  }

  const renderList = (files: FileChange[], staged: boolean) =>
    files.map((f) => {
      const isSel = selected.some((s) => s.path === f.path && s.staged === staged)
      return (
        <div
          key={(staged ? 's:' : 'u:') + f.path}
          className={`list-row group h-7 px-2 ${isSel ? 'selected' : ''}`}
          onClick={(e) => selectRow(e, f, staged, files)}
          onDoubleClick={() => toggleFile(f, staged)}
          onContextMenu={(e) => {
            setSelected([{ path: f.path, staged }])
            anchor.current = { path: f.path, staged }
            onFileMenu(e, f, staged)
          }}
          title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
        >
          <button
            type="button"
            aria-label={staged ? `Unstage ${f.path}` : `Stage ${f.path}`}
            className={`flex size-4 flex-none items-center justify-center rounded-[5px] border transition-colors ${
              staged ? 'border-accent bg-accent text-accent-foreground' : 'border-border-tertiary hover:border-accent'
            }`}
            onClick={(e) => {
              e.stopPropagation()
              toggleFile(f, staged)
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {staged && <Check className="size-3" strokeWidth={3} />}
          </button>
          <StatusIcon status={f.status} />
          <FileName path={f.path} />
        </div>
      )
    })

  // Called as a function (not <ListPanel/>) so the scroll containers aren't remounted on refresh.
  const listPanel = ({
    title,
    count,
    files,
    staged,
    action
  }: {
    title: string
    count: number
    files: FileChange[]
    staged: boolean
    action: React.ReactNode
  }) => (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 flex-none items-center gap-2 px-3">
        <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</span>
        <span className="rounded-full bg-default px-1.5 text-[11px] leading-[18px] font-semibold text-muted tabular-nums">{count}</span>
        <span className="ml-auto">{action}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {files.length ? (
          renderList(files, staged)
        ) : (
          <div className="px-2 py-3 text-xs text-muted">{staged ? 'Nothing staged yet' : 'Working tree clean'}</div>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {operation && (
        <div className="flex flex-none items-center gap-2 border-b border-warning/30 bg-warning-soft px-4 py-2 text-sm text-warning-soft-foreground">
          <AlertTriangle className="size-4 flex-none" />
          <span>
            A <b>{operation.toLowerCase()}</b> is in progress.{' '}
            {status.conflicted.length > 0
              ? `Resolve ${status.conflicted.length} conflicted file${status.conflicted.length > 1 ? 's' : ''}, stage them, then continue from the status bar.`
              : 'All conflicts resolved — commit or continue from the status bar.'}
          </span>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[36%] min-w-72 flex-col border-r border-separator">
          {listPanel({
            title: 'Staged',
            count: status.staged.length,
            files: status.staged,
            staged: true,
            action: (
              <>
                {stagedSel.length > 0 && (
                  <Button size="sm" variant="secondary" className="mr-1 h-6 px-2 text-xs" onPress={unstageSelected}>
                    <Minus className="size-3.5" /> Unstage {stagedSel.length}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-2 text-xs"
                  isDisabled={!status.staged.length}
                  onPress={() => run('Unstaging…', () => repo.unstage(status.staged.map((f) => f.path)))}
                >
                  <Minus className="size-3.5" /> Unstage all
                </Button>
              </>
            )
          })}
          <div className="h-px flex-none bg-separator" />
          {listPanel({
            title: 'Unstaged',
            count: unstagedAll.length,
            files: unstagedAll,
            staged: false,
            action: (
              <>
                {unstagedSel.length > 0 && (
                  <>
                    <Button size="sm" variant="primary" className="h-6 px-2 text-xs" onPress={stageSelected}>
                      <Plus className="size-3.5" />{' '}
                      {unstagedSel.length === 1 ? 'Stage 1 file' : `Stage ${unstagedSel.length} files`}
                    </Button>
                    <span
                      className="ml-1 inline-block align-middle"
                      title={canDiscard ? undefined : 'Only files with modifications can be discarded — new and conflicted files are not allowed'}
                    >
                      <Button size="sm" variant="danger-soft" className="h-6 px-2 text-xs" isDisabled={!canDiscard} onPress={discardSelected}>
                        <Undo2 className="size-3.5" /> Discard {unstagedSel.length}
                      </Button>
                    </span>
                    <span
                      className="ml-1 inline-block align-middle"
                      title={canDelete ? undefined : 'Only new (untracked, status “?”) files can be deleted'}
                    >
                      <Button size="sm" variant="danger-soft" className="h-6 px-2 text-xs" isDisabled={!canDelete} onPress={deleteSelected}>
                        <Trash2 className="size-3.5" /> Delete {unstagedSel.length}
                      </Button>
                    </span>
                  </>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-2 text-xs"
                  isDisabled={!unstagedAll.length}
                  onPress={() => run('Staging…', () => repo.run(['add', '-A']))}
                >
                  <CheckCheck className="size-3.5" /> Stage all
                </Button>
              </>
            )
          })}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {selFile && primary ? (
            <div className="flex h-9 flex-none items-center gap-2 border-b border-separator px-3 text-sm">
              <StatusIcon status={selFile.status} />
              <span className="min-w-0 truncate font-medium">
                <FileName path={selFile.path} />
              </span>
              <span className="rounded-full bg-default px-2 text-[11px] leading-5 text-muted">{primary.staged ? 'Staged' : 'Unstaged'}</span>
              {selected.length > 1 && <span className="rounded-full bg-default px-2 text-[11px] leading-5 text-muted">{selected.length} selected</span>}
              <span className="ml-auto flex gap-1">
                {!primary.staged && selFile.status !== 'U' && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-danger" onPress={() => discardFile(selFile)}>
                    <Undo2 className="size-3.5" /> Discard file
                  </Button>
                )}
                <Button size="sm" variant="secondary" className="h-7 gap-1 px-2 text-xs" onPress={() => toggleFile(selFile, primary.staged)}>
                  {primary.staged ? <Minus className="size-3.5" /> : selFile.status === 'U' ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                  {primary.staged ? 'Unstage file' : selFile.status === 'U' ? 'Mark resolved' : 'Stage file'}
                </Button>
              </span>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto">
            {selFile ? (
              <DiffView diff={diff} mode={selFile.status !== 'U' ? (primary?.staged ? 'staged' : 'unstaged') : undefined} onApply={applyPartial} />
            ) : (
              <EmptyHint icon={<FileDiff className="size-8 opacity-40" strokeWidth={1.5} />}>Select a file to review its changes</EmptyHint>
            )}
          </div>
        </div>
      </div>

      {/* Commit composer */}
      <div className="flex-none border-t border-separator bg-background-secondary/40 p-3">
        <div className="relative">
          <TextArea
            aria-label="Commit message"
            variant="secondary"
            fullWidth
            placeholder="Summary of your changes  —  Ctrl+Enter to commit"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                doCommit()
              }
            }}
            className="min-h-20 resize-y text-[13px]"
            spellCheck
          />
          {subjectLen > 0 && (
            <span
              className={`pointer-events-none absolute top-2 right-3 text-[11px] tabular-nums ${subjectLen > 72 ? 'text-danger' : subjectLen > 50 ? 'text-warning' : 'text-muted'}`}
              title="Summary line length (aim for 50, max 72)"
            >
              {subjectLen}
            </span>
          )}
        </div>
        <div className="mt-2.5 flex items-center gap-5">
          <Checkbox variant="secondary" className="group" isSelected={amend} onChange={(v: boolean) => setAmend(v)}>
            <Checkbox.Content>
              <Checkbox.Control className="border border-border-tertiary group-data-[selected=true]:border-transparent">
                <Checkbox.Indicator />
              </Checkbox.Control>
              <span className="text-[13px]">Amend last commit</span>
            </Checkbox.Content>
          </Checkbox>
          <Checkbox
            variant="secondary"
            className="group"
            isSelected={pushAfter}
            onChange={(v: boolean) => {
              setPushAfter(v)
              try {
                localStorage.setItem('pushAfter', v ? '1' : '0')
              } catch {
                /* ignore */
              }
            }}
          >
            <Checkbox.Content>
              <Checkbox.Control className="border border-border-tertiary group-data-[selected=true]:border-transparent">
                <Checkbox.Indicator />
              </Checkbox.Control>
              <span className="text-[13px]">Push after commit</span>
            </Checkbox.Content>
          </Checkbox>
          <span className="ml-auto text-xs text-muted">
            {status.staged.length} file{status.staged.length === 1 ? '' : 's'} staged
          </span>
          <Button variant="primary" size="sm" isDisabled={!canCommit} onPress={doCommit} className="gap-1.5 px-4">
            <Check className="size-4" />
            {amend ? 'Amend' : 'Commit'}
            {pushAfter ? ' & push' : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}
