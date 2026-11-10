import { Button, Input, ListBox, Modal, Select } from '@heroui/react'
import { AlertTriangle, ArrowDown, ArrowUp, GitPullRequestArrow } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Repo } from '../lib/git'

type Action = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop'

interface Item {
  hash: string
  subject: string
  action: Action
  message: string
}

const ACTIONS: { value: Action; label: string; hint: string; color: string }[] = [
  { value: 'pick', label: 'Pick', hint: 'Keep commit as is', color: 'text-foreground' },
  { value: 'reword', label: 'Reword', hint: 'Keep commit, change its message', color: 'text-accent' },
  { value: 'edit', label: 'Edit', hint: 'Stop after this commit so you can amend it', color: 'text-warning' },
  { value: 'squash', label: 'Squash', hint: 'Meld into the previous commit, keep both messages', color: 'text-accent' },
  { value: 'fixup', label: 'Fixup', hint: 'Meld into the previous commit, discard this message', color: 'text-accent' },
  { value: 'drop', label: 'Drop', hint: 'Remove the commit', color: 'text-danger' }
]

interface Props {
  repo: Repo
  base: string | null // rebase commits after this (null = from root)
  baseLabel: string
  onCancel: () => void
  onStart: (todo: string) => void
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export function RebaseDialog({ repo, base, baseLabel, onCancel, onStart }: Props) {
  const [isOpen, setIsOpen] = useState(true)
  const [items, setItems] = useState<Item[] | null>(null)
  const [orig, setOrig] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    repo
      .rebaseRange(base)
      .then((list) => {
        if (list.some((c) => c.parents > 1)) {
          setError('This range contains merge commits. Interactive rebase of merges is not supported — pick a more recent base commit.')
          return
        }
        if (!list.length) {
          setError('There are no commits after this one on the current branch.')
          return
        }
        setOrig(list.map((c) => c.hash))
        setItems(list.map((c) => ({ hash: c.hash, subject: c.subject, action: 'pick', message: '' })))
      })
      .catch((e) => setError(e.message))
  }, [repo, base])

  const close = () => {
    setIsOpen(false)
    setTimeout(onCancel, 200) // let the exit animation play
  }

  const update = (i: number, patch: Partial<Item>) => setItems((list) => list!.map((it, k) => (k === i ? { ...it, ...patch } : it)))

  const move = (i: number, dir: -1 | 1) =>
    setItems((list) => {
      const next = [...list!]
      const j = i + dir
      if (j < 0 || j >= next.length) return next
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const kept = items?.filter((i) => i.action !== 'drop') ?? []
  const firstInvalid = kept[0] && (kept[0].action === 'squash' || kept[0].action === 'fixup')
  const rewordEmpty = items?.some((i) => i.action === 'reword' && !i.message.trim())
  const unchanged = items?.every((it, k) => it.action === 'pick' && it.hash === orig[k])

  const start = async () => {
    if (!items) return
    setBusy(true)
    const lines: string[] = []
    for (const it of items) {
      if (it.action === 'reword') {
        const file = await window.api.writeTemp(it.message.trim() + '\n')
        lines.push(`pick ${it.hash} ${it.subject}`)
        lines.push(`exec git commit --amend --only --no-verify --allow-empty -F ${shq(file)}`)
      } else {
        lines.push(`${it.action} ${it.hash} ${it.subject}`)
      }
    }
    setIsOpen(false)
    onStart(lines.join('\n') + '\n')
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(o) => !o && close()} variant="blur">
      <Modal.Container size="lg" placement="top" className="mt-[8vh]">
        <Modal.Dialog className="sm:max-w-3xl">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <GitPullRequestArrow className="size-5" />
            </Modal.Icon>
            <Modal.Heading>Interactive rebase</Modal.Heading>
            <p className="mt-1.5 text-sm leading-5 text-muted">
              Rewrite the commits after <b className="font-semibold text-foreground">{baseLabel}</b> on the current branch, oldest at the top.
              Uncommitted changes are stashed and restored automatically.
            </p>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-3">
            {error && <Notice tone="danger">{error}</Notice>}
            {items && (
              <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-separator">
                {items.map((it, i) => {
                  const meta = ACTIONS.find((a) => a.value === it.action)!
                  const melded = it.action === 'squash' || it.action === 'fixup'
                  return (
                    <div key={it.hash} className="flex items-center gap-2 border-b border-separator px-2 py-1.5 last:border-b-0">
                      <div className="flex flex-none flex-col">
                        <button
                          type="button"
                          aria-label="Move up"
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                          className="rounded p-0.5 text-muted hover:bg-default hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowUp className="size-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          disabled={i === items.length - 1}
                          onClick={() => move(i, 1)}
                          className="rounded p-0.5 text-muted hover:bg-default hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowDown className="size-3" />
                        </button>
                      </div>
                      <Select
                        aria-label={`Action for ${it.hash.slice(0, 7)}`}
                        variant="secondary"
                        className="w-28 flex-none"
                        value={it.action}
                        onChange={(k) => {
                          if (k !== null && !Array.isArray(k)) update(i, { action: k as Action, message: it.message || it.subject })
                        }}
                      >
                        <Select.Trigger className={`h-8 min-h-8 ${meta.color}`}>
                          <Select.Value>{({ selectedText }) => selectedText}</Select.Value>
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover className="min-w-64">
                          <ListBox>
                            {ACTIONS.map((a) => (
                              <ListBox.Item key={a.value} id={a.value} textValue={a.label}>
                                <div className="flex flex-col">
                                  <span className={`font-medium ${a.color}`}>{a.label}</span>
                                  <span className="text-xs text-muted">{a.hint}</span>
                                </div>
                                <ListBox.ItemIndicator />
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <span className={`w-16 flex-none font-mono text-xs text-muted ${melded ? 'pl-3' : ''}`}>{it.hash.slice(0, 7)}</span>
                      {it.action === 'reword' ? (
                        <Input
                          aria-label="New commit message"
                          variant="secondary"
                          className="h-8 min-w-0 flex-1"
                          value={it.message}
                          onChange={(e) => update(i, { message: e.target.value })}
                          spellCheck={false}
                          autoFocus
                        />
                      ) : (
                        <span className={`min-w-0 flex-1 truncate ${it.action === 'drop' ? 'text-muted line-through' : ''}`}>
                          {melded && <span className="mr-1.5 text-accent">↳</span>}
                          {it.subject}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {firstInvalid && <Notice tone="warning">The first kept commit can't be squashed or fixed up — there's nothing before it to meld into.</Notice>}
            {items && (
              <Notice tone="muted">Don't rebase commits that others have already pulled — it rewrites history.</Notice>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onPress={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              isDisabled={!items || busy || !!firstInvalid || !!rewordEmpty || !kept.length || !!unchanged}
              onPress={start}
            >
              Start rebase
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function Notice({ tone, children }: { tone: 'danger' | 'warning' | 'muted'; children: React.ReactNode }) {
  const cls =
    tone === 'danger'
      ? 'bg-danger-soft text-danger-soft-foreground'
      : tone === 'warning'
        ? 'bg-warning-soft text-warning-soft-foreground'
        : 'bg-default/60 text-muted'
  return (
    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${cls}`}>
      <AlertTriangle className="mt-0.5 size-4 flex-none" />
      <span>{children}</span>
    </div>
  )
}
