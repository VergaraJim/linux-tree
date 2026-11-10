import { Button, Dropdown, Spinner } from '@heroui/react'
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  Check,
  Cherry,
  Clipboard,
  Copy,
  ExternalLink,
  Flag,
  FolderOpen,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequestArrow,
  ListOrdered,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Settings2,
  Tag,
  Trash2,
  Undo2,
  Workflow
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Repo } from '../lib/git'
import { classify, finishFlow, FLOW_DEFAULTS, initFlow, readFlowConfig, startFlow, type FlowConfig, type FlowType } from '../lib/gitflow'
import type { Branch, Commit, FileChange, RepoState, Stash } from '../lib/types'
import { ContextMenu, MenuBody, type MenuItem, type MenuState } from './ContextMenu'
import { useDialog } from './Dialog'
import { HistoryView } from './HistoryView'
import { RebaseDialog } from './RebaseDialog'
import { Sidebar, type View } from './Sidebar'
import { StatusView } from './StatusView'
import { IconButton, notifyError, notifySuccess, ToolbarButton } from './ui'

const FLOW_LABEL: Record<FlowType, string> = { feature: 'Feature', release: 'Release', hotfix: 'Hotfix' }
const I = 'size-4'
let menuId = 1

interface Props {
  path: string
  active: boolean
  onStateChange?: (path: string, info: { head: string | null; changes: number }) => void
}

export function RepoWorkspace({ path, active, onStateChange }: Props) {
  const dialog = useDialog()
  const repo = useMemo(() => new Repo(path), [path])
  const [state, setState] = useState<RepoState | null>(null)
  const [flow, setFlow] = useState<FlowConfig | null>(null)
  const [view, setView] = useState<View>('history')
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [selectRef, setSelectRef] = useState<{ ref: string; nonce: number } | null>(null)
  const [rebase, setRebase] = useState<{ base: string | null; label: string } | null>(null)
  const busyRef = useRef(false)
  const firstLoad = useRef(true)

  // ---------- helpers ----------

  const onError = useCallback((e: unknown) => notifyError('Git error', e), [])

  const refresh = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([repo.state(), readFlowConfig(repo)])
      setState(s)
      setFlow(f)
      setReloadKey((k) => k + 1)
      // A repository without commits has no history to show: start on the commit view.
      if (firstLoad.current) {
        firstLoad.current = false
        if (!s.headHash) setView('status')
      }
    } catch (e) {
      onError(e)
    }
  }, [repo, onError])

  /** Run a git operation with a busy indicator, error toast and refresh. */
  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>, successMsg?: string): Promise<boolean> => {
      busyRef.current = true
      setBusy(label)
      try {
        await fn()
        if (successMsg) notifySuccess(successMsg)
        return true
      } catch (e) {
        notifyError(`${label.replace(/…$/, '')} failed`, e)
        return false
      } finally {
        busyRef.current = false
        setBusy(null)
        await refresh()
      }
    },
    [refresh]
  )

  // ---------- lifecycle ----------

  // Refresh whenever this tab becomes visible (and on first mount).
  useEffect(() => {
    if (active) refresh()
  }, [active, refresh])

  useEffect(() => {
    if (!state) return
    onStateChange?.(path, {
      head: state.head ?? (state.headHash ? state.headHash.slice(0, 7) : null),
      changes: state.status.staged.length + state.status.unstaged.length + state.status.conflicted.length
    })
  }, [state])

  useEffect(() => {
    if (!active) return
    let t: ReturnType<typeof setTimeout> | undefined
    const off = window.api.onFocus(() => {
      clearTimeout(t)
      t = setTimeout(() => !busyRef.current && refresh(), 150)
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5' || (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'r')) {
        e.preventDefault()
        refresh()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      off()
      window.removeEventListener('keydown', onKey)
    }
  }, [active, refresh])

  const openMenu = (e: MouseEvent, items: MenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items, id: menuId++ })
  }

  const head = state?.head ?? null
  const remotes = state?.remotes ?? []
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  const localBranches = state?.branches.filter((b) => !b.remote) ?? []
  const currentBranch = localBranches.find((b) => b.current)
  const dirty = state ? state.status.staged.length + state.status.unstaged.length + state.status.conflicted.length > 0 : false

  // ---------- actions ----------

  const pushCurrent = async () => {
    if (!head) throw new Error('HEAD is detached — check out a branch to push.')
    const hasUpstream = !!currentBranch?.upstream && !currentBranch.gone
    await repo.push(head, remotes, !hasUpstream)
  }

  const doPush = async () => {
    if (!head) return onError('HEAD is detached — check out a branch to push.')
    const v = await dialog.prompt({
      title: 'Push',
      icon: <ArrowUpFromLine className="size-5" />,
      message: (
        <>
          Push <b>{head}</b> to <b>{remote ?? '(no remote)'}</b>
          {!currentBranch?.upstream && ' and set it as the upstream branch'}.
        </>
      ),
      fields: [{ name: 'tags', label: 'Also push all tags', type: 'checkbox' }],
      okLabel: 'Push'
    })
    if (!v) return
    await run(
      'Pushing…',
      async () => {
        await pushCurrent()
        if (v.tags) await repo.pushRefs(remote, [], true)
      },
      `Pushed ${head}`
    )
  }

  const doCommit = (message: string, amend: boolean, push: boolean) =>
    run(push ? 'Committing and pushing…' : 'Committing…', async () => {
      await repo.commit(message, amend)
      if (push) await pushCurrent()
    })

  const newBranch = async (start: string | null, startLabel?: string) => {
    const v = await dialog.prompt({
      title: 'New branch',
      icon: <GitBranchPlus className="size-5" />,
      message: startLabel ? (
        <>
          Starting from <b>{startLabel}</b>
        </>
      ) : (
        <>
          Starting from <b>{head ?? 'HEAD'}</b>
        </>
      ),
      fields: [
        { name: 'name', label: 'Branch name', type: 'text', placeholder: 'e.g. feature/login' },
        { name: 'checkout', label: 'Check out the new branch', type: 'checkbox', value: true }
      ],
      okLabel: 'Create branch'
    })
    if (!v || !String(v.name).trim()) return
    run('Creating branch…', () => repo.createBranch(String(v.name).trim(), start, !!v.checkout))
  }

  const mergeDialog = async (preset?: string) => {
    const options = state!.branches.filter((b) => !b.current).map((b) => ({ value: b.name, label: (b.remote ? '☁ ' : '') + b.name }))
    if (!options.length) return onError('No other branches to merge.')
    const v = await dialog.prompt({
      title: `Merge into ${head ?? 'HEAD'}`,
      icon: <GitMerge className="size-5" />,
      fields: [
        { name: 'ref', label: 'Branch to merge', type: 'select', options, value: preset },
        { name: 'noff', label: 'Always create a merge commit (--no-ff)', type: 'checkbox' }
      ],
      okLabel: 'Merge'
    })
    if (!v) return
    run('Merging…', () => repo.merge(String(v.ref), !!v.noff), `Merged ${v.ref} into ${head ?? 'HEAD'}`)
  }

  const stashDialog = async () => {
    if (!dirty) return onError('No local changes to stash.')
    const v = await dialog.prompt({
      title: 'Stash changes',
      icon: <Archive className="size-5" />,
      fields: [
        { name: 'msg', label: 'Message', type: 'text', placeholder: 'optional' },
        { name: 'untracked', label: 'Include untracked files', type: 'checkbox', value: true }
      ],
      okLabel: 'Stash'
    })
    if (!v) return
    run('Stashing…', () => repo.stashPush(String(v.msg), !!v.untracked), 'Changes stashed')
  }

  const checkoutBranch = async (b: Branch) => {
    if (b.current) return
    if (b.remote) return run('Checking out…', () => repo.checkoutRemote(b.name))
    return run('Checking out…', () => repo.checkout(b.name))
  }

  const deleteBranch = async (b: Branch) => {
    if (b.remote) {
      if (!(await dialog.confirm('Delete remote branch', <>Delete <b>{b.name}</b> from the remote server?</>, 'Delete', true))) return
      return run('Deleting remote branch…', () => repo.deleteRemoteBranch(b.name))
    }
    if (!(await dialog.confirm('Delete branch', <>Delete local branch <b>{b.name}</b>?</>, 'Delete', true))) return
    try {
      await repo.deleteBranch(b.name, false)
      await refresh()
    } catch (e) {
      const msg = (e as Error).message
      if (/not fully merged/.test(msg)) {
        if (
          await dialog.confirm(
            'Branch not fully merged',
            <>
              <b>{b.name}</b> has commits that aren't merged anywhere. Delete it anyway? Those commits may be lost.
            </>,
            'Force delete',
            true
          )
        )
          run('Deleting…', () => repo.deleteBranch(b.name, true))
      } else onError(e)
    }
  }

  // ---------- git-flow ----------

  const suggestVersion = (type: FlowType): string => {
    const prefix = flow?.versionTag ?? 'v'
    const versions = (state?.tags ?? [])
      .filter((t) => t.startsWith(prefix))
      .map((t) => t.slice(prefix.length).split('.').map(Number))
      .filter((p) => p.length >= 2 && p.every((n) => !isNaN(n)))
      .sort((a, b) => b[0] - a[0] || b[1] - a[1] || (b[2] ?? 0) - (a[2] ?? 0))
    const [maj, min, pat] = versions[0] ?? [0, 0, 0]
    return type === 'hotfix' ? `${maj}.${min}.${(pat ?? 0) + 1}` : `${maj}.${min + 1}.0`
  }

  const flowInit = async () => {
    const hasMain = await repo.branchExists('main')
    const hasMaster = await repo.branchExists('master')
    const d = flow ?? { ...FLOW_DEFAULTS, main: hasMain || !hasMaster ? 'main' : 'master' }
    const v = await dialog.prompt({
      title: flow ? 'Git-flow settings' : 'Initialize git-flow',
      icon: <Workflow className="size-5" />,
      message: 'Stored in .git/config using the same keys as Sourcetree / git-flow.',
      size: 'md',
      fields: [
        { name: 'main', label: 'Production branch', type: 'text', value: d.main },
        { name: 'develop', label: 'Development branch', type: 'text', value: d.develop },
        { name: 'feature', label: 'Feature prefix', type: 'text', value: d.feature },
        { name: 'release', label: 'Release prefix', type: 'text', value: d.release },
        { name: 'hotfix', label: 'Hotfix prefix', type: 'text', value: d.hotfix },
        { name: 'versionTag', label: 'Version tag prefix', type: 'text', value: d.versionTag }
      ],
      okLabel: flow ? 'Save' : 'Initialize'
    })
    if (!v) return
    const cfg = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, String(val).trim()])) as unknown as FlowConfig
    run('Initializing git-flow…', () => initFlow(repo, cfg), flow ? 'Git-flow settings saved' : 'Git-flow initialized')
  }

  const flowStart = async (type: FlowType) => {
    if (!flow) return
    const isVersion = type !== 'feature'
    const base = type === 'hotfix' ? flow.main : flow.develop
    const v = await dialog.prompt({
      title: `Start new ${type}`,
      icon: <Workflow className="size-5" />,
      message: (
        <>
          Creates <b>{flow[type]}…</b> from <b>{base}</b>
        </>
      ),
      fields: [
        {
          name: 'name',
          label: isVersion ? 'Version' : 'Feature name',
          type: 'text',
          value: isVersion ? suggestVersion(type) : '',
          placeholder: isVersion ? '' : 'e.g. login-page'
        }
      ],
      okLabel: `Start ${type}`
    })
    if (!v) return
    run(`Starting ${type}…`, () => startFlow(repo, flow, type, String(v.name)), `Started ${flow[type]}${String(v.name).trim()}`)
  }

  const flowFinish = async (type: FlowType, preset?: string) => {
    if (!flow) return
    const names = localBranches
      .map((b) => classify(b.name, flow))
      .filter((c) => c?.type === type)
      .map((c) => c!.name)
    if (!names.length) return onError(`There are no ${type} branches to finish.`)
    const into = type === 'feature' ? flow.develop : `${flow.main} and ${flow.develop}`
    const fields: Parameters<typeof dialog.prompt>[0]['fields'] = [
      { name: 'name', label: `${FLOW_LABEL[type]} to finish`, type: 'select', options: names.map((n) => ({ value: n, label: flow[type] + n })), value: preset },
      { name: 'keep', label: 'Keep branch after finishing', type: 'checkbox' }
    ]
    if (type !== 'feature') fields.push({ name: 'tagMsg', label: 'Tag message', type: 'text', placeholder: 'optional' })
    fields.push({ name: 'push', label: `Push ${into}${type !== 'feature' ? ' and the tag' : ''} to ${remote ?? 'remote'}`, type: 'checkbox', value: remotes.length > 0 })
    const v = await dialog.prompt({
      title: `Finish ${type}`,
      icon: <Flag className="size-5" />,
      size: 'md',
      message: (
        <>
          Merges into <b>{into}</b>
          {type !== 'feature' && (
            <>
              , tags the release on <b>{flow.main}</b>
            </>
          )}
          , then deletes the branch.
        </>
      ),
      fields,
      okLabel: `Finish ${type}`
    })
    if (!v) return
    const name = String(v.name)
    run(
      `Finishing ${type}…`,
      () =>
        finishFlow(
          repo,
          flow,
          type,
          name,
          { keepBranch: !!v.keep, tagMessage: String(v.tagMsg ?? '') || undefined, push: !!v.push, remotes },
          (m) => setBusy(m)
        ),
      `Finished ${flow[type]}${name}`
    )
  }

  const flowCur = classify(head, flow)
  const flowItems: MenuItem[] = !flow
    ? [{ label: 'Initialize git-flow…', action: flowInit, icon: <Workflow className={I} /> }]
    : [
        ...(flowCur
          ? ([
              { header: `Current: ${head}` },
              { label: `Finish ${flowCur.type} “${flowCur.name}”…`, action: () => flowFinish(flowCur.type, flowCur.name), icon: <Flag className={I} /> },
              { separator: true }
            ] as MenuItem[])
          : []),
        { header: 'Start' },
        { label: 'New feature…', action: () => flowStart('feature'), icon: <Plus className={I} /> },
        { label: 'New release…', action: () => flowStart('release'), icon: <Plus className={I} /> },
        { label: 'New hotfix…', action: () => flowStart('hotfix'), icon: <Plus className={I} /> },
        { separator: true },
        { header: 'Finish' },
        { label: 'Finish feature…', action: () => flowFinish('feature'), icon: <Flag className={I} /> },
        { label: 'Finish release…', action: () => flowFinish('release'), icon: <Flag className={I} /> },
        { label: 'Finish hotfix…', action: () => flowFinish('hotfix'), icon: <Flag className={I} /> },
        { separator: true },
        { label: 'Git-flow settings…', action: flowInit, icon: <Settings2 className={I} /> }
      ]

  // ---------- context menus ----------

  const branchMenu = (e: MouseEvent, b: Branch) => {
    const items: MenuItem[] = [{ header: b.name }]
    if (b.remote) {
      items.push({ label: `Check out`, action: () => checkoutBranch(b), icon: <ArrowRightLeft className={I} /> })
      items.push({ label: `Merge into ${head ?? 'HEAD'}`, action: () => mergeDialog(b.name), icon: <GitMerge className={I} /> })
      items.push({ label: `New branch from here…`, action: () => newBranch(b.name, b.name), icon: <GitBranchPlus className={I} /> })
      items.push({ separator: true })
      items.push({ label: `Delete from remote…`, action: () => deleteBranch(b), danger: true, icon: <Trash2 className={I} /> })
    } else {
      items.push({ label: `Check out`, action: () => checkoutBranch(b), disabled: b.current, icon: <ArrowRightLeft className={I} /> })
      items.push({ label: `Merge into ${head ?? 'HEAD'}`, action: () => mergeDialog(b.name), disabled: b.current, icon: <GitMerge className={I} /> })
      items.push({
        label: `Rebase ${head ?? 'HEAD'} onto this`,
        disabled: b.current,
        icon: <GitPullRequestArrow className={I} />,
        action: async () => {
          if (
            await dialog.confirm(
              'Rebase',
              <>
                Rebase <b>{head}</b> onto <b>{b.name}</b>? This rewrites the commits of {head}.
              </>,
              'Rebase',
              true
            )
          )
            run('Rebasing…', () => repo.rebase(b.name))
        }
      })
      items.push({ separator: true })
      items.push({ label: `New branch from here…`, action: () => newBranch(b.name, b.name), icon: <GitBranchPlus className={I} /> })
      items.push({
        label: 'Rename…',
        icon: <Pencil className={I} />,
        action: async () => {
          const v = await dialog.prompt({
            title: 'Rename branch',
            icon: <Pencil className="size-5" />,
            fields: [{ name: 'name', label: 'New name', type: 'text', value: b.name }],
            okLabel: 'Rename'
          })
          if (v && String(v.name).trim() && v.name !== b.name) run('Renaming…', () => repo.renameBranch(b.name, String(v.name).trim()))
        }
      })
      items.push({
        label: b.upstream ? 'Push' : 'Push (set upstream)',
        disabled: !remotes.length,
        icon: <ArrowUpFromLine className={I} />,
        action: () => run('Pushing…', () => repo.push(b.name, remotes, !b.upstream || b.gone), `Pushed ${b.name}`)
      })
      const c = classify(b.name, flow)
      if (c) {
        items.push({ separator: true })
        items.push({ label: `Finish ${c.type} “${c.name}”…`, action: () => flowFinish(c.type, c.name), icon: <Flag className={I} /> })
      }
      items.push({ separator: true })
      items.push({ label: `Delete…`, action: () => deleteBranch(b), danger: true, disabled: b.current, icon: <Trash2 className={I} /> })
    }
    openMenu(e, items)
  }

  const commitMenu = (e: MouseEvent, c: Commit) => {
    const short = c.hash.slice(0, 7)
    openMenu(e, [
      { header: `${short} · ${c.subject}` },
      {
        label: 'Check out this commit',
        icon: <ArrowRightLeft className={I} />,
        action: async () => {
          if (
            await dialog.confirm(
              'Detached HEAD',
              <>
                Check out <b>{short}</b>? You'll be in “detached HEAD” state — create a branch to keep new commits.
              </>,
              'Check out'
            )
          )
            run('Checking out…', () => repo.checkout(c.hash))
        }
      },
      { label: 'New branch here…', action: () => newBranch(c.hash, short), icon: <GitBranchPlus className={I} /> },
      {
        label: 'New tag here…',
        icon: <Tag className={I} />,
        action: async () => {
          const v = await dialog.prompt({
            title: `Tag ${short}`,
            icon: <Tag className="size-5" />,
            fields: [
              { name: 'name', label: 'Tag name', type: 'text', placeholder: 'e.g. v1.2.0' },
              { name: 'msg', label: 'Message (annotated tag)', type: 'text', placeholder: 'optional' },
              { name: 'push', label: 'Push tag to remote', type: 'checkbox', value: false }
            ],
            okLabel: 'Create tag'
          })
          if (!v || !String(v.name).trim()) return
          const name = String(v.name).trim()
          run('Tagging…', async () => {
            await repo.createTag(name, c.hash, String(v.msg) || undefined)
            if (v.push && remotes.length) await repo.pushRefs(remote, [`refs/tags/${name}`])
          })
        }
      },
      { separator: true },
      {
        label: `Interactive rebase after ${short}…`,
        disabled: !head || c.hash === state?.headHash,
        icon: <ListOrdered className={I} />,
        action: () => setRebase({ base: c.hash, label: `${short} ${c.subject}` })
      },
      {
        label: `Interactive rebase including ${short}…`,
        disabled: !head,
        icon: <ListOrdered className={I} />,
        action: () =>
          setRebase({
            base: c.parents[0] ?? null,
            label: c.parents[0] ? `${c.parents[0].slice(0, 7)} (parent of ${short})` : 'the root commit'
          })
      },
      { separator: true },
      {
        label: `Cherry-pick onto ${head ?? 'HEAD'}`,
        icon: <Cherry className={I} />,
        action: async () => {
          if (
            await dialog.confirm(
              'Cherry-pick',
              <>
                Apply <b>{short}</b> onto <b>{head ?? 'HEAD'}</b>?
              </>,
              'Cherry-pick'
            )
          )
            run('Cherry-picking…', () => repo.cherryPick(c.hash))
        }
      },
      {
        label: 'Revert commit',
        icon: <Undo2 className={I} />,
        action: async () => {
          if (await dialog.confirm('Revert', <>Create a new commit that undoes <b>{short}</b>?</>, 'Revert'))
            run('Reverting…', () => repo.revert(c.hash))
        }
      },
      {
        label: `Reset ${head ?? 'HEAD'} to here…`,
        icon: <RotateCcw className={I} />,
        action: async () => {
          const v = await dialog.prompt({
            title: `Reset ${head ?? 'HEAD'} to ${short}`,
            icon: <RotateCcw className="size-5" />,
            size: 'md',
            fields: [
              {
                name: 'mode',
                label: 'Mode',
                type: 'select',
                value: 'mixed',
                options: [
                  { value: 'soft', label: 'Soft — keep all changes staged' },
                  { value: 'mixed', label: 'Mixed — keep changes, unstaged' },
                  { value: 'keep', label: 'Keep — reset, but stop if local changes would be lost' },
                  { value: 'hard', label: 'Hard — DISCARD all local changes' }
                ]
              }
            ],
            okLabel: 'Reset',
            danger: true
          })
          if (!v) return
          if (v.mode === 'hard' && !(await dialog.confirm('Hard reset', 'All uncommitted changes will be permanently lost. Continue?', 'Reset hard', true)))
            return
          run('Resetting…', () => repo.reset(c.hash, v.mode as 'soft' | 'mixed' | 'hard' | 'keep'))
        }
      },
      { separator: true },
      { label: 'Copy SHA', action: () => window.api.copy(c.hash), icon: <Copy className={I} /> }
    ])
  }

  const tagMenu = (e: MouseEvent, tag: string) =>
    openMenu(e, [
      { header: tag },
      { label: `Check out`, action: () => run('Checking out…', () => repo.checkout(tag)), icon: <ArrowRightLeft className={I} /> },
      { label: `New branch from here…`, action: () => newBranch(tag, tag), icon: <GitBranchPlus className={I} /> },
      {
        label: `Push to ${remote ?? 'remote'}`,
        disabled: !remotes.length,
        icon: <ArrowUpFromLine className={I} />,
        action: () => run('Pushing tag…', () => repo.pushRefs(remote, [`refs/tags/${tag}`]), `Pushed ${tag}`)
      },
      { separator: true },
      {
        label: `Delete…`,
        danger: true,
        icon: <Trash2 className={I} />,
        action: async () => {
          const v = await dialog.prompt({
            title: 'Delete tag',
            icon: <Trash2 className="size-5" />,
            message: (
              <>
                Delete tag <b>{tag}</b>?
              </>
            ),
            fields: [{ name: 'remote', label: 'Also delete it from the remote', type: 'checkbox' }],
            okLabel: 'Delete',
            danger: true
          })
          if (!v) return
          run('Deleting tag…', async () => {
            await repo.deleteTag(tag)
            if (v.remote && remotes.length) await repo.run(['push', remote, '--delete', `refs/tags/${tag}`])
          })
        }
      }
    ])

  const applyStash = async (s: Stash) => {
    const v = await dialog.prompt({
      title: 'Apply stash',
      icon: <ArchiveRestore className="size-5" />,
      message: (
        <>
          Apply <b>{s.message}</b> to your working copy?
        </>
      ),
      fields: [{ name: 'drop', label: 'Delete the stash after applying', type: 'checkbox' }],
      okLabel: 'Apply'
    })
    if (v) run('Applying stash…', () => repo.stashApply(s.ref, !!v.drop))
  }

  const stashMenu = (e: MouseEvent, s: Stash) =>
    openMenu(e, [
      { header: s.message },
      { label: 'Apply stash…', action: () => applyStash(s), icon: <ArchiveRestore className={I} /> },
      {
        label: 'Delete stash…',
        danger: true,
        icon: <Trash2 className={I} />,
        action: async () => {
          if (await dialog.confirm('Delete stash', <>Permanently delete <b>{s.message}</b>?</>, 'Delete', true)) run('Deleting stash…', () => repo.stashDrop(s.ref))
        }
      }
    ])

  const remoteMenu = (e: MouseEvent, name: string) =>
    openMenu(e, [{ label: `Fetch ${name}`, action: () => run('Fetching…', () => repo.run(['fetch', '--prune', name]), `Fetched ${name}`), icon: <RefreshCw className={I} /> }])

  const fileMenu = (e: MouseEvent, f: FileChange, staged: boolean) => {
    const items: MenuItem[] = []
    if (f.status === 'U') {
      items.push({ label: 'Mark resolved (stage)', action: () => run('Staging…', () => repo.stage([f.path])), icon: <Check className={I} /> })
      items.push({
        label: 'Resolve using mine (ours)',
        icon: <ArrowRightLeft className={I} />,
        action: () =>
          run('Resolving…', async () => {
            await repo.run(['checkout', '--ours', '--', f.path])
            await repo.stage([f.path])
          })
      })
      items.push({
        label: 'Resolve using theirs',
        icon: <ArrowRightLeft className={I} />,
        action: () =>
          run('Resolving…', async () => {
            await repo.run(['checkout', '--theirs', '--', f.path])
            await repo.stage([f.path])
          })
      })
    } else if (staged) {
      items.push({ label: 'Unstage', action: () => run('Unstaging…', () => repo.unstage([f.path])), icon: <Minus className={I} /> })
    } else {
      items.push({ label: 'Stage', action: () => run('Staging…', () => repo.stage([f.path])), icon: <Plus className={I} /> })
      items.push({
        label: f.status === '?' ? 'Delete file…' : 'Discard changes…',
        danger: true,
        icon: f.status === '?' ? <Trash2 className={I} /> : <Undo2 className={I} />,
        action: async () => {
          if (await dialog.confirm('Discard changes', <>Discard all changes to <b>{f.path}</b>? This cannot be undone.</>, 'Discard', true))
            run('Discarding…', () => repo.discard([f]))
        }
      })
    }
    items.push({ separator: true })
    items.push({ label: 'Open file', action: () => window.api.openPath(`${repo.path}/${f.path}`), icon: <ExternalLink className={I} /> })
    items.push({ label: 'Copy path', action: () => window.api.copy(f.path), icon: <Clipboard className={I} /> })
    openMenu(e, items)
  }

  // ---------- render ----------

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <header className="flex h-14 flex-none items-center gap-1 px-2">
        <ToolbarButton icon={<GitCommitHorizontal className="size-[18px]" />} label="Commit" tooltip="Review and commit changes" onPress={() => setView('status')} />
        <ToolbarButton
          icon={<ArrowDownToLine className="size-[18px]" />}
          label="Pull"
          tooltip={currentBranch?.behind ? `Pull ${currentBranch.behind} new commit(s)` : 'Pull from remote'}
          badge={currentBranch?.behind}
          isDisabled={!remotes.length}
          onPress={() => run('Pulling…', () => repo.pull(), 'Pull complete')}
        />
        <ToolbarButton
          icon={<ArrowUpFromLine className="size-[18px]" />}
          label="Push"
          tooltip={currentBranch?.ahead ? `Push ${currentBranch.ahead} commit(s)` : 'Push to remote'}
          badge={currentBranch?.ahead}
          isDisabled={!remotes.length}
          onPress={doPush}
        />
        <ToolbarButton
          icon={<RefreshCw className="size-[18px]" />}
          label="Fetch"
          tooltip="Fetch all remotes"
          isDisabled={!remotes.length}
          onPress={() => run('Fetching…', () => repo.fetch(), 'Fetch complete')}
        />
        <div className="mx-1.5 h-7 w-px bg-separator" />
        <ToolbarButton icon={<GitBranchPlus className="size-[18px]" />} label="Branch" tooltip="Create a branch" onPress={() => newBranch(null)} />
        <ToolbarButton icon={<GitMerge className="size-[18px]" />} label="Merge" tooltip="Merge a branch into the current one" onPress={() => mergeDialog()} />
        <ToolbarButton icon={<Archive className="size-[18px]" />} label="Stash" tooltip="Stash local changes" onPress={stashDialog} />
        <Dropdown>
          <ToolbarButton
            icon={<Workflow className="size-[18px]" />}
            label={flowCur ? `Finish ${flowCur.type}` : 'Git-flow'}
            highlight={!!flowCur}
          />
          <Dropdown.Popover placement="bottom start" className="min-w-60">
            <MenuBody items={flowItems} label="Git-flow" />
          </Dropdown.Popover>
        </Dropdown>
        <div className="flex-1" />
        {head || state?.headHash ? (
          <div className="mr-1 flex h-8 items-center gap-2 rounded-full bg-surface px-3 text-[13px] shadow-surface">
            <GitBranch className="size-4 text-accent" />
            <span className="max-w-56 truncate font-medium">{head ?? `detached at ${state?.headHash?.slice(0, 7)}`}</span>
            {currentBranch?.upstream && (
              <span className="max-w-48 truncate text-xs text-muted">→ {currentBranch.upstream}</span>
            )}
          </div>
        ) : null}
        <IconButton label="Open folder" onPress={() => window.api.openPath(repo.path)}>
          <FolderOpen className="size-[18px]" />
        </IconButton>
        <IconButton label="Refresh (F5)" onPress={refresh}>
          <RotateCw className="size-[18px]" />
        </IconButton>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 gap-1 px-2">
        <Sidebar
          repoPath={path}
          state={state}
          view={view}
          onView={setView}
          onBranchOpen={checkoutBranch}
          onBranchMenu={branchMenu}
          onRefSelect={(ref) => {
            setView('history')
            setSelectRef({ ref, nonce: Date.now() })
          }}
          onTagMenu={tagMenu}
          onStashOpen={applyStash}
          onStashMenu={stashMenu}
          onRemoteMenu={remoteMenu}
        />
        <main className="min-w-0 flex-1 overflow-hidden rounded-xl border border-separator bg-surface shadow-surface">
          {state && view === 'history' && (
            <HistoryView repo={repo} reloadKey={reloadKey} remotes={remotes} selectRef={selectRef} onCommitMenu={commitMenu} onError={onError} />
          )}
          {state && view === 'status' && (
            <StatusView
              repo={repo}
              status={state.status}
              reloadKey={reloadKey}
              operation={state.operation}
              run={run}
              onCommit={doCommit}
              onFileMenu={fileMenu}
              onError={onError}
            />
          )}
          {!state && (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          )}
        </main>
      </div>

      {/* Status bar */}
      <footer className="flex h-8 flex-none items-center gap-3 px-4 text-xs text-muted">
        {state?.operation && (
          <span className="flex items-center gap-2 font-medium text-warning">
            {state.operation}
            <Button
              size="sm"
              variant="primary"
              className="h-6 px-2 text-xs"
              isDisabled={state.status.conflicted.length > 0}
              onPress={() => run('Continuing…', () => repo.continueOperation(state.operation!))}
            >
              Continue
            </Button>
            {state.operation === 'REBASING' && (
              <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onPress={() => run('Skipping commit…', () => repo.skipRebase())}>
                Skip
              </Button>
            )}
            <Button size="sm" variant="danger-soft" className="h-6 px-2 text-xs" onPress={() => run('Aborting…', () => repo.abortOperation(state.operation!))}>
              Abort
            </Button>
          </span>
        )}
        <span className="truncate font-mono text-[11px] opacity-70" title={repo.path}>
          {repo.path}
        </span>
        <span className="flex-1" />
        {currentBranch && (currentBranch.ahead > 0 || currentBranch.behind > 0) && (
          <span className="tabular-nums">
            {currentBranch.ahead > 0 && `↑${currentBranch.ahead} `}
            {currentBranch.behind > 0 && `↓${currentBranch.behind}`}
          </span>
        )}
        {flow && (
          <span className="flex items-center gap-1">
            <Workflow className="size-3.5" />
            {flow.main} / {flow.develop}
          </span>
        )}
        {busy && (
          <span className="flex items-center gap-2 text-accent">
            <Spinner size="sm" />
            {busy}
          </span>
        )}
      </footer>

      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      {rebase && (
        <RebaseDialog
          repo={repo}
          base={rebase.base}
          baseLabel={rebase.label}
          onCancel={() => setRebase(null)}
          onStart={(todo) => {
            const base = rebase.base
            setRebase(null)
            run('Rebasing…', () => repo.interactiveRebase(base, todo), 'Rebase complete')
          }}
        />
      )}
    </div>
  )
}
