import { Button, Checkbox, Input, Label, Modal, Spinner, TextField } from '@heroui/react'
import { AlertCircle, Cloud, CloudCog } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Repo } from '../lib/git'

export interface RemoteDialogResult {
  name: string
  /** The user asked to fetch from the remote once the dialog closes. */
  fetch: boolean
}

interface Props {
  repo: Repo
  /** Remotes that already exist (to catch duplicate names before git does). */
  existing: string[]
  /** Edit this remote; omitted = add a new one. */
  edit?: { name: string; url: string }
  /** Extra line under the title, e.g. why the dialog opened. */
  intro?: ReactNode
  onClose: () => void
  onDone: (r: RemoteDialogResult) => void
}

/** Add a remote, or rename it / change its URL. Validation errors stay in the dialog so nothing typed is lost. */
export function RemoteDialog({ repo, existing, edit, intro, onClose, onDone }: Props) {
  const [isOpen, setIsOpen] = useState(true)
  const [name, setName] = useState(edit?.name ?? (existing.includes('origin') ? '' : 'origin'))
  const [url, setUrl] = useState(edit?.url ?? '')
  const [fetch, setFetch] = useState(!edit)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const close = () => {
    setIsOpen(false)
    setTimeout(onClose, 200) // let the exit animation play
  }

  const save = async () => {
    if (busy) return
    const n = name.trim()
    const u = url.trim()
    setError(null)
    if (!n) return setError('Enter a name for the remote, like origin.')
    if (!u) return setError('Enter the remote’s URL.')
    if (n !== edit?.name && existing.includes(n)) return setError(`A remote named “${n}” already exists.`)
    setBusy(true)
    try {
      if (n !== edit?.name && !(await Repo.isValidRemoteName(n))) throw new Error(`“${n}” isn’t a valid remote name.`)
      if (!edit) await repo.addRemote(n, u)
      else {
        if (n !== edit.name) await repo.renameRemote(edit.name, n)
        if (u !== edit.url) await repo.setRemoteUrl(n, u)
      }
      setIsOpen(false)
      onDone({ name: n, fetch })
      setTimeout(onClose, 200)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const clear = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setError(null)
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
                {edit ? <CloudCog className="size-5" /> : <Cloud className="size-5" />}
              </Modal.Icon>
              <Modal.Heading>{edit ? `Edit remote “${edit.name}”` : 'Add remote'}</Modal.Heading>
              <div className="mt-1.5 text-sm leading-5 text-muted [&_b]:font-semibold [&_b]:text-foreground">
                {intro ?? (edit ? 'Rename the remote or point it at a different URL.' : 'Connect this repository to a server you can push to and pull from.')}
              </div>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4 py-1">
              <TextField variant="secondary" className="w-full" value={name} onChange={clear(setName)} autoFocus={!!edit || !name}>
                <Label>Name</Label>
                <Input placeholder="origin" spellCheck={false} autoComplete="off" />
              </TextField>
              <TextField variant="secondary" className="w-full" value={url} onChange={clear(setUrl)} autoFocus={!edit && !!name}>
                <Label>URL</Label>
                <Input placeholder="git@github.com:user/repo.git" spellCheck={false} autoComplete="off" className="font-mono text-[13px]" />
              </TextField>
              <Checkbox variant="secondary" isSelected={fetch} onChange={setFetch}>
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  Fetch from the remote afterwards
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
              <Button type="submit" variant="primary" isDisabled={busy} className="gap-2">
                {busy && <Spinner size="sm" color="current" />}
                {edit ? 'Save' : 'Add remote'}
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
