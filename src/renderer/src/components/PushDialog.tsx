import { Button, Checkbox, Label, ListBox, Modal, Select, Spinner } from '@heroui/react'
import { AlertCircle, ArrowUpFromLine } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Repo } from '../lib/git'
import type { Branch } from '../lib/types'

interface Props {
  repo: Repo
  /** Local branches only. */
  branches: Branch[]
  remotes: string[]
  onClose: () => void
  onDone: (pushed: string[]) => void
}

interface Row {
  branch: Branch
  tracked: boolean
  remoteName: string
  status: string
  ahead: boolean
}

/** Sourcetree-style multi-branch push: pick a remote, tick branches, optionally push all tags. */
export function PushDialog({ repo, branches, remotes, onClose, onDone }: Props) {
  const [isOpen, setIsOpen] = useState(true)
  const [remote, setRemote] = useState(() => (remotes.includes('origin') ? 'origin' : (remotes[0] ?? '')))
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [track, setTrack] = useState<Record<string, boolean>>({})
  const [pushTags, setPushTags] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo<Row[]>(
    () =>
      branches
        .map((b) => {
          const tracked = !!b.upstream && !b.gone && b.upstream.startsWith(remote + '/')
          return {
            branch: b,
            tracked,
            remoteName: tracked ? b.upstream!.slice(remote.length + 1) : b.name,
            status: tracked ? (b.ahead ? `${b.ahead} ahead` : 'up to date') : 'new',
            ahead: tracked && b.ahead > 0
          }
        })
        .sort((a, b) => {
          if (a.branch.current !== b.branch.current) return a.branch.current ? -1 : 1
          return a.branch.name.localeCompare(b.branch.name)
        }),
    [branches, remote]
  )

  // Re-derive the defaults whenever the target remote changes.
  useEffect(() => {
    const nextChecked: Record<string, boolean> = {}
    const nextTrack: Record<string, boolean> = {}
    for (const r of rows) {
      nextChecked[r.branch.name] = r.branch.current || r.ahead
      nextTrack[r.branch.name] = !r.tracked
    }
    setChecked(nextChecked)
    setTrack(nextTrack)
    setError(null)
  }, [rows])

  const close = () => {
    setIsOpen(false)
    setTimeout(onClose, 200) // let the exit animation play
  }

  const selectedNames = rows.filter((r) => checked[r.branch.name]).map((r) => r.branch.name)
  const allSelected = rows.length > 0 && selectedNames.length === rows.length

  const toggleAll = (value: boolean) => {
    const next: Record<string, boolean> = {}
    for (const r of rows) next[r.branch.name] = value
    setChecked(next)
    setError(null)
  }

  const save = async () => {
    if (busy) return
    if (!selectedNames.length) return setError('Choose at least one branch to push.')
    setError(null)
    setBusy(true)
    try {
      await repo.pushBranches(
        remote,
        rows
          .filter((r) => checked[r.branch.name])
          .map((r) => ({ local: r.branch.name, remoteName: r.remoteName, setUpstream: !!track[r.branch.name] })),
        pushTags
      )
      setIsOpen(false)
      onDone(selectedNames)
      setTimeout(onClose, 200)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(o) => !o && close()} variant="blur">
      <Modal.Container size="md" placement="top" className="mt-[10vh]">
        <Modal.Dialog>
          <form
            className="flex flex-col"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <ArrowUpFromLine className="size-5" />
              </Modal.Icon>
              <Modal.Heading>Push</Modal.Heading>
              <div className="mt-1.5 text-sm leading-5 text-muted">Choose the branches to push.</div>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4 py-1">
              {remotes.length > 1 && (
                <Select
                  variant="secondary"
                  className="w-full"
                  value={remote}
                  onChange={(k) => {
                    if (k !== null && !Array.isArray(k)) {
                      setRemote(String(k))
                      setError(null)
                    }
                  }}
                >
                  <Label>Remote</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {remotes.map((r) => (
                        <ListBox.Item key={r} id={r} textValue={r}>
                          {r}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              )}

              {!branches.length ? (
                <div className="text-sm text-muted">No local branches to push.</div>
              ) : (
                <>
                  <Checkbox variant="secondary" isSelected={allSelected} onChange={toggleAll}>
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      Select all
                    </Checkbox.Content>
                  </Checkbox>

                  <div className="max-h-72 overflow-y-auto rounded-lg border border-separator">
                    {rows.map((r) => (
                      <div key={r.branch.name} className="flex h-9 items-center gap-3 border-b border-separator px-3 last:border-b-0">
                        <Checkbox
                          variant="secondary"
                          className="flex-none"
                          aria-label={`Push ${r.branch.name}`}
                          isSelected={!!checked[r.branch.name]}
                          onChange={(v: boolean) => {
                            setChecked((c) => ({ ...c, [r.branch.name]: v }))
                            setError(null)
                          }}
                        >
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                          </Checkbox.Content>
                        </Checkbox>
                        <span className="flex min-w-0 flex-none basis-[34%] items-center gap-1.5">
                          <span className="truncate font-medium">{r.branch.name}</span>
                          {r.branch.current && <span className="flex-none text-xs text-muted">current</span>}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
                          → {remote}/{r.remoteName}
                        </span>
                        <span className={`flex-none text-xs tabular-nums ${r.ahead ? 'text-accent' : 'text-muted'}`}>{r.status}</span>
                        <Checkbox
                          variant="secondary"
                          className="flex-none"
                          aria-label={`Set upstream for ${r.branch.name}`}
                          isSelected={!!track[r.branch.name]}
                          onChange={(v: boolean) => setTrack((t) => ({ ...t, [r.branch.name]: v }))}
                        >
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                            <span className="text-xs text-muted">Track</span>
                          </Checkbox.Content>
                        </Checkbox>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <Checkbox variant="secondary" isSelected={pushTags} onChange={setPushTags}>
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  Push all tags
                </Checkbox.Content>
              </Checkbox>

              {error && (
                <div role="alert" className="flex items-start gap-2 text-sm text-danger">
                  <AlertCircle className="mt-0.5 size-4 flex-none" />
                  <span className="selectable-text">{error}</span>
                </div>
              )}
            </Modal.Body>
            <Modal.Footer className="mt-2">
              <Button variant="secondary" onPress={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                isDisabled={busy || !selectedNames.length}
                className="gap-2"
              >
                {busy && <Spinner size="sm" color="current" />}
                {selectedNames.length > 1 ? `Push ${selectedNames.length} branches` : 'Push'}
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
