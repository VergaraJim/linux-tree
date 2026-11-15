import { Button, Modal, Spinner } from '@heroui/react'
import { AlertCircle, GitMerge } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Repo } from '../lib/git'
import type { FileChange } from '../lib/types'
import { useDialog } from './Dialog'

interface Props {
  repo: Repo
  /** The conflicted files to resolve (parent passes status.conflicted). */
  files: FileChange[]
  /** Path to select first. */
  initialPath?: string
  /** Parent's helper: runs a git operation, reports errors and refreshes the repo state. */
  run: (label: string, fn: () => Promise<unknown>) => Promise<boolean>
  onClose: () => void
}

interface Stages {
  base: string
  ours: string
  theirs: string
}

interface Pane {
  title: string
  text: string
  empty: string
}

/** Side-by-side view of the three conflict stages, with the actions to resolve each path. */
export function ConflictResolver({ repo, files, initialPath, run, onClose }: Props) {
  const dialog = useDialog()
  const [isOpen, setIsOpen] = useState(true)
  const [paths, setPaths] = useState<string[]>(() => files.map((f) => f.path))
  const [current, setCurrent] = useState<string | null>(() =>
    initialPath && files.some((f) => f.path === initialPath) ? initialPath : (files[0]?.path ?? null)
  )
  const [stages, setStages] = useState<Stages | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setIsOpen(false)
    setTimeout(onClose, 200) // let the exit animation play
  }

  useEffect(() => {
    if (!current) {
      setStages(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    repo
      .conflictStages(current)
      .then((s) => !cancelled && setStages(s))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [current, repo])

  /** Drop `current` from the list and select the path that followed it (else the first remaining). */
  const removeCurrent = () => {
    const i = current ? paths.indexOf(current) : -1
    const remaining = paths.filter((p) => p !== current)
    setPaths(remaining)
    setCurrent(remaining[i < 0 ? 0 : i] ?? remaining[0] ?? null)
  }

  const markResolved = async () => {
    if (!current) return
    if (await run('Staging…', () => repo.stage([current]))) removeCurrent()
  }

  const useSide = async (side: 'ours' | 'theirs') => {
    if (!current) return
    const mine = side === 'ours'
    const ok = await dialog.confirm(
      mine ? 'Resolve with your version' : 'Resolve with their version',
      mine ? (
        <>
          Take <b>{current}</b> from your side? The other side's changes are discarded.
        </>
      ) : (
        <>
          Take <b>{current}</b> from the other side? Your changes are discarded.
        </>
      ),
      mine ? 'Use mine' : 'Use theirs',
      true
    )
    if (!ok) return
    if (await run('Resolving…', () => repo.checkoutSide(current, side))) removeCurrent()
  }

  const deleteFile = async () => {
    if (!current) return
    const ok = await dialog.confirm(
      'Delete file',
      <>
        Delete <b>{current}</b> to resolve the conflict?
      </>,
      'Delete',
      true
    )
    if (!ok) return
    if (await run('Resolving…', () => repo.resolveDeleted(current))) removeCurrent()
  }

  const panes: Pane[] = [
    { title: 'Mine (ours)', text: stages?.ours ?? '', empty: 'Deleted on your side' },
    { title: 'Base', text: stages?.base ?? '', empty: 'No common base version' },
    { title: 'Theirs', text: stages?.theirs ?? '', empty: 'Deleted on their side' }
  ]

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(o) => !o && close()} variant="blur">
      <Modal.Container size="lg" placement="top" className="mt-[6vh]">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Icon className="bg-warning-soft text-warning-soft-foreground">
              <GitMerge className="size-5" />
            </Modal.Icon>
            <Modal.Heading>Resolve conflicts</Modal.Heading>
            <div className="mt-1.5 text-sm leading-5 text-muted">
              {paths.length} conflicted file{paths.length === 1 ? '' : 's'} left
            </div>
          </Modal.Header>

          <Modal.Body className="flex gap-3 py-1">
            {paths.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-sm text-muted">
                All conflicts resolved
              </div>
            ) : (
              <>
                <div className="max-h-[60vh] w-56 flex-none overflow-y-auto rounded-lg border border-separator">
                  {paths.map((p) => (
                    <div
                      key={p}
                      className={`list-row h-7 px-2 text-xs ${p === current ? 'selected' : ''}`}
                      title={p}
                      onClick={() => setCurrent(p)}
                    >
                      <span className="truncate">{p.slice(p.lastIndexOf('/') + 1)}</span>
                    </div>
                  ))}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex h-5 items-center gap-2">
                    <span className="min-w-0 truncate font-mono text-xs text-muted" title={current ?? undefined}>
                      {current}
                    </span>
                    {loading && <Spinner size="sm" />}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {panes.map((p) => (
                      <div key={p.title} className="min-w-0">
                        <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{p.title}</div>
                        {p.text ? (
                          <pre className="max-h-[50vh] overflow-auto rounded-lg border border-separator bg-background-secondary/40 px-2 py-1 font-mono text-[11px] leading-4 whitespace-pre">
                            {p.text}
                          </pre>
                        ) : (
                          <div className="rounded-lg border border-separator px-2 py-1 text-[11px] leading-4 text-muted">
                            {p.empty}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {error && (
                    <div role="alert" className="mt-2 flex items-start gap-2 text-sm text-danger">
                      <AlertCircle className="mt-0.5 size-4 flex-none" />
                      <span className="selectable-text">{error}</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </Modal.Body>

          <Modal.Footer className="mt-2">
            <Button variant="secondary" onPress={close}>
              Close
            </Button>
            {paths.length > 0 && (
              <>
                <Button variant="danger-soft" onPress={deleteFile} isDisabled={!current}>
                  Delete file
                </Button>
                <Button variant="primary" onPress={() => useSide('theirs')} isDisabled={!current}>
                  Use theirs
                </Button>
                <Button variant="primary" onPress={() => useSide('ours')} isDisabled={!current}>
                  Use mine (ours)
                </Button>
                <Button variant="secondary" onPress={markResolved} isDisabled={!current}>
                  Mark resolved
                </Button>
              </>
            )}
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
