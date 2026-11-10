import { Button, Input, Label, Modal, Spinner, TextField } from '@heroui/react'
import { AlertCircle, FolderGit2, FolderPlus, FolderSearch } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Repo } from '../lib/git'

interface Props {
  defaultLocation: string
  home: string
  onClose: () => void
  onCreated: (path: string) => void
}

/** Absolute path from what the user typed: expands a leading ~ and drops trailing slashes. */
const expand = (p: string, home: string) =>
  p
    .trim()
    .replace(/^~(?=$|\/)/, home)
    .replace(/(.)\/+$/, '$1')

export function NewRepoDialog({ defaultLocation, home, onClose, onCreated }: Props) {
  const [isOpen, setIsOpen] = useState(true)
  const [name, setName] = useState('')
  const [location, setLocation] = useState(defaultLocation)
  const [branch, setBranch] = useState('main')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Repo.defaultBranch().then((b) => setBranch((cur) => (cur === 'main' ? b : cur)))
  }, [])

  const parent = expand(location, home)
  const cleanName = name.trim()
  const target = cleanName && parent ? `${parent === '/' ? '' : parent}/${cleanName}` : ''

  const close = () => {
    setIsOpen(false)
    setTimeout(onClose, 200) // let the exit animation play
  }

  const browse = async () => {
    const p = await window.api.pickRepo({
      title: 'Choose where to create the repository',
      buttonLabel: 'Select',
      defaultPath: parent || home
    })
    if (p) {
      setLocation(p === home || p.startsWith(home + '/') ? '~' + p.slice(home.length) : p)
      setError(null)
    }
  }

  const create = async () => {
    if (busy) return
    setError(null)
    if (!cleanName) return setError('Enter a name for the repository.')
    if (cleanName.includes('/') || cleanName === '.' || cleanName === '..') return setError('The name can’t contain “/” or be “.” or “..”.')
    if (!parent.startsWith('/')) return setError('The location must be an absolute path, like ~/projects.')
    const b = branch.trim()
    setBusy(true)
    try {
      if (!(await window.api.exists('/', parent))) throw new Error(`The folder ${parent} doesn’t exist.`)
      if (!(await Repo.isValidBranchName(b))) throw new Error(`“${b}” isn’t a valid branch name.`)
      const err = await window.api.mkdir(target)
      if (err) throw new Error(err)
      await Repo.init(target, b)
      setIsOpen(false)
      onCreated(target)
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
              create()
            }}
          >
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <FolderPlus className="size-5" />
              </Modal.Icon>
              <Modal.Heading>New repository</Modal.Heading>
              <div className="mt-1.5 text-sm leading-5 text-muted">Creates a folder and initializes an empty Git repository in it.</div>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4 py-1">
              <TextField
                variant="secondary"
                className="w-full"
                value={name}
                onChange={(v) => {
                  setName(v)
                  setError(null)
                }}
                autoFocus
              >
                <Label>Name</Label>
                <Input placeholder="my-project" spellCheck={false} autoComplete="off" />
              </TextField>
              <div className="flex items-end gap-2">
                <TextField
                  variant="secondary"
                  className="min-w-0 flex-1"
                  value={location}
                  onChange={(v) => {
                    setLocation(v)
                    setError(null)
                  }}
                >
                  <Label>Location</Label>
                  <Input spellCheck={false} autoComplete="off" className="font-mono text-[13px]" />
                </TextField>
                <Button variant="secondary" onPress={browse} className="gap-2">
                  <FolderSearch className="size-4" />
                  Browse…
                </Button>
              </div>
              <TextField
                variant="secondary"
                className="w-full"
                value={branch}
                onChange={(v) => {
                  setBranch(v)
                  setError(null)
                }}
              >
                <Label>Initial branch</Label>
                <Input spellCheck={false} autoComplete="off" />
              </TextField>
              {target && (
                <div className="flex min-w-0 items-start gap-2 rounded-lg bg-surface-secondary px-3 py-2 text-xs text-muted">
                  <FolderGit2 className="size-4 flex-none" />
                  <span className="font-mono break-all">{target}</span>
                </div>
              )}
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
              <Button type="submit" variant="primary" isDisabled={!cleanName || busy} className="gap-2">
                {busy && <Spinner size="sm" color="current" />}
                Create repository
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
