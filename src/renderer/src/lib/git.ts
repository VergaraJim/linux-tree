import type {
  Branch,
  Commit,
  CommitDetail,
  FileChange,
  RefLabel,
  RepoState,
  Stash,
  WorkingStatus
} from './types'

export class GitError extends Error {
  constructor(
    public args: string[],
    public stderr: string,
    public code: number
  ) {
    super(stderr.trim() || `git ${args[0]} failed (exit ${code})`)
  }
}

// Normalised diff output regardless of user config (needed for patch building).
const DIFF_OPTS = ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/']

const FS = '\x1f' // field separator
const RS = '\x1e' // record separator

export class Repo {
  constructor(public path: string) {}

  async run(args: string[], allowCodes: number[] = [], opts?: { input?: string; env?: Record<string, string> }): Promise<string> {
    const r = await window.api.git(this.path, args, opts)
    if (!r.ok && !allowCodes.includes(r.code)) throw new GitError(args, r.stderr || r.stdout, r.code)
    return r.stdout
  }

  async tryRun(args: string[]): Promise<string | null> {
    const r = await window.api.git(this.path, args)
    return r.ok ? r.stdout : null
  }

  // ---------- reading ----------

  static async isRepo(path: string): Promise<string | null> {
    return (await Repo.locate(path)).top
  }

  /** Top level of the repository containing `path`. `notRepo` = git says it's not inside one
   *  (as opposed to other failures like "dubious ownership", which are reported as-is). */
  static async locate(path: string): Promise<{ top: string | null; notRepo: boolean; error: string }> {
    const r = await window.api.git(path, ['rev-parse', '--show-toplevel'])
    if (r.ok) return { top: r.stdout.trim(), notRepo: false, error: '' }
    return { top: null, notRepo: /not a git repository/i.test(r.stderr), error: r.stderr.trim() }
  }

  /** The user's init.defaultBranch, or "main". */
  static async defaultBranch(): Promise<string> {
    const r = await window.api.git('/', ['config', '--get', 'init.defaultBranch'])
    return (r.ok && r.stdout.trim()) || 'main'
  }

  static async isValidBranchName(name: string): Promise<boolean> {
    return !!name && (await window.api.git('/', ['check-ref-format', '--branch', name])).ok
  }

  /** Same rule git uses: the name must work inside refs/remotes/<name>/… */
  static async isValidRemoteName(name: string): Promise<boolean> {
    return !!name && (await window.api.git('/', ['check-ref-format', `refs/remotes/${name}/test`])).ok
  }

  static async init(path: string, branch: string): Promise<void> {
    const args = ['init', `--initial-branch=${branch}`]
    const r = await window.api.git(path, args)
    if (!r.ok) throw new GitError(args, r.stderr, r.code)
  }

  async state(): Promise<RepoState> {
    const [head, headHash, branches, tags, remotes, remoteUrls, stashes, status, operation] = await Promise.all([
      this.tryRun(['symbolic-ref', '--short', '-q', 'HEAD']),
      this.tryRun(['rev-parse', '--verify', '-q', 'HEAD']),
      this.branches(),
      this.tags(),
      this.remotes(),
      this.remoteUrls(),
      this.stashes(),
      this.status(),
      this.operation()
    ])
    return {
      head: head?.trim() || null,
      headHash: headHash?.trim() || null,
      branches,
      tags,
      remotes,
      remoteUrls,
      stashes,
      status,
      operation
    }
  }

  async branches(): Promise<Branch[]> {
    const fmt = ['%(refname)', '%(refname:short)', '%(HEAD)', '%(upstream:short)', '%(upstream:track)'].join(FS)
    const out = await this.run(['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes'])
    const res: Branch[] = []
    for (const line of out.split('\n')) {
      if (!line) continue
      const [full, short, head, upstream, track] = line.split(FS)
      if (full.endsWith('/HEAD')) continue
      const remote = full.startsWith('refs/remotes/')
      const ahead = /ahead (\d+)/.exec(track)
      const behind = /behind (\d+)/.exec(track)
      res.push({
        name: remote ? full.slice('refs/remotes/'.length) : full.slice('refs/heads/'.length) || short,
        remote,
        current: head === '*',
        upstream: upstream || undefined,
        ahead: ahead ? +ahead[1] : 0,
        behind: behind ? +behind[1] : 0,
        gone: track.includes('gone')
      })
    }
    return res
  }

  async tags(): Promise<string[]> {
    const out = await this.run(['tag', '--sort=-creatordate'])
    return out.split('\n').filter(Boolean)
  }

  async remotes(): Promise<string[]> {
    const out = await this.run(['remote'])
    return out.split('\n').filter(Boolean)
  }

  /** Configured fetch URL of each remote (as written in .git/config, before insteadOf rewrites). */
  async remoteUrls(): Promise<Record<string, string>> {
    const out = await this.tryRun(['config', '--get-regexp', '^remote\\..*\\.url$']) // exits 1 when there are none
    const res: Record<string, string> = {}
    for (const line of (out ?? '').split('\n')) {
      const m = /^remote\.(.+)\.url (.*)$/.exec(line)
      if (m && !(m[1] in res)) res[m[1]] = m[2]
    }
    return res
  }

  addRemote(name: string, url: string) {
    return this.run(['remote', 'add', name, url])
  }

  setRemoteUrl(name: string, url: string) {
    return this.run(['remote', 'set-url', name, url])
  }

  renameRemote(oldName: string, newName: string) {
    return this.run(['remote', 'rename', oldName, newName])
  }

  removeRemote(name: string) {
    return this.run(['remote', 'remove', name])
  }

  fetchRemote(name: string) {
    return this.run(['fetch', '--prune', name])
  }

  async stashes(): Promise<Stash[]> {
    const out = await this.run(['stash', 'list', `--format=%gd${FS}%s`])
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [ref, message] = l.split(FS)
        return { ref, message }
      })
  }

  async operation(): Promise<string | null> {
    // Rebase state lives in a directory (REBASE_HEAD can be left behind stale);
    // merge / cherry-pick / revert leave a pseudo-ref that is removed when done.
    for (const d of ['rebase-merge', 'rebase-apply']) {
      const p = (await this.tryRun(['rev-parse', '--git-path', d]))?.trim()
      if (p && (await window.api.exists(this.path, p))) return 'REBASING'
    }
    const checks: [string, string][] = [
      ['MERGE_HEAD', 'MERGING'],
      ['CHERRY_PICK_HEAD', 'CHERRY-PICKING'],
      ['REVERT_HEAD', 'REVERTING']
    ]
    for (const [ref, label] of checks) {
      if (await this.tryRun(['rev-parse', '-q', '--verify', ref])) return label
    }
    return null
  }

  async status(): Promise<WorkingStatus> {
    const out = await this.run(['--no-optional-locks', 'status', '--porcelain=v1', '-z', '-uall'])
    const parts = out.split('\0')
    const staged: FileChange[] = []
    const unstaged: FileChange[] = []
    const conflicted: FileChange[] = []
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i]
      if (!entry) continue
      const x = entry[0]
      const y = entry[1]
      const path = entry.slice(3)
      let oldPath: string | undefined
      if (x === 'R' || x === 'C') oldPath = parts[++i]
      const xy = x + y
      if (xy === '??') {
        unstaged.push({ path, status: '?' })
      } else if (x === 'U' || y === 'U' || xy === 'AA' || xy === 'DD') {
        conflicted.push({ path, status: 'U' })
      } else {
        if (x !== ' ') staged.push({ path, oldPath, status: x })
        if (y !== ' ') unstaged.push({ path, status: y })
      }
    }
    return { staged, unstaged, conflicted }
  }

  async log(limit: number, allBranches: boolean, remoteNames: string[]): Promise<Commit[]> {
    const fmt = ['%H', '%P', '%an', '%ae', '%at', '%s', '%D'].join(FS) + RS
    const args = ['log', '--date-order', `--pretty=format:${fmt}`, `-n${limit}`]
    // Not --all: that would include refs/stash and its internal commits.
    args.push(...(allBranches ? ['--branches', '--remotes', '--tags', 'HEAD'] : ['HEAD']))
    const r = await window.api.git(this.path, args)
    if (!r.ok) {
      // Empty repository (no commits yet) is not an error for the UI.
      if (/does not have any commits|unknown revision|bad default revision/.test(r.stderr)) return []
      throw new GitError(args, r.stderr, r.code)
    }
    return r.stdout
      .split(RS)
      .map((s) => s.replace(/^\n/, ''))
      .filter(Boolean)
      .map((rec) => {
        const [hash, parents, author, email, at, subject, refs] = rec.split(FS)
        return {
          hash,
          parents: parents ? parents.split(' ') : [],
          author,
          email,
          date: +at,
          subject,
          refs: parseRefs(refs, remoteNames)
        }
      })
  }

  async commitDetail(hash: string): Promise<CommitDetail> {
    const fmt = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%B'].join(FS)
    const head = await this.run(['show', '-s', `--format=${fmt}`, hash])
    const [h, parents, author, email, at, committer, body] = head.split(FS)
    const names = await this.run([
      'show',
      '--format=',
      '--name-status',
      '-z',
      '--diff-merges=first-parent',
      hash
    ])
    return {
      hash: h,
      parents: parents ? parents.split(' ') : [],
      author,
      email,
      date: +at,
      committer,
      body: body.trim(),
      files: parseNameStatus(names)
    }
  }

  async commitDiff(hash: string, file: FileChange): Promise<string> {
    const paths = file.oldPath ? [file.oldPath, file.path] : [file.path]
    return this.run(['show', ...DIFF_OPTS, '--format=', '--diff-merges=first-parent', '-M', hash, '--', ...paths])
  }

  async workingDiff(file: FileChange, staged: boolean): Promise<string> {
    if (file.status === '?') {
      return this.run(['diff', ...DIFF_OPTS, '--no-index', '--', '/dev/null', file.path], [1])
    }
    const args = ['diff', ...DIFF_OPTS, '-M']
    if (staged) args.push('--cached')
    args.push('--', ...(file.oldPath ? [file.oldPath, file.path] : [file.path]))
    return this.run(args)
  }

  async config(key: string): Promise<string | null> {
    const v = await this.tryRun(['config', '--get', key])
    return v === null ? null : v.trim()
  }

  async branchExists(name: string): Promise<boolean> {
    return (await this.tryRun(['show-ref', '--verify', '-q', `refs/heads/${name}`])) !== null
  }

  async isClean(): Promise<boolean> {
    const out = await this.run(['status', '--porcelain', '-uno'])
    return out.trim() === ''
  }

  // ---------- writing ----------

  stage(paths: string[]) {
    return this.run(['add', '-A', '--', ...paths])
  }

  async unstage(paths: string[]) {
    const hasHead = await this.tryRun(['rev-parse', '--verify', '-q', 'HEAD'])
    if (hasHead) return this.run(['reset', '-q', 'HEAD', '--', ...paths])
    return this.run(['rm', '--cached', '-r', '-q', '--', ...paths])
  }

  async discard(files: FileChange[]) {
    const untracked = files.filter((f) => f.status === '?').map((f) => f.path)
    const tracked = files.filter((f) => f.status !== '?').map((f) => f.path)
    if (tracked.length) await this.run(['checkout', '--', ...tracked])
    if (untracked.length) await this.run(['clean', '-f', '-q', '--', ...untracked])
  }

  /** Apply a partial patch. target: 'stage' | 'unstage' (index) | 'discard' (working tree). */
  applyPatch(patch: string, target: 'stage' | 'unstage' | 'discard') {
    const args = ['apply', '--recount', '--whitespace=nowarn']
    if (target !== 'discard') args.push('--cached')
    if (target !== 'stage') args.push('-R')
    return this.run([...args, '-'], [], { input: patch })
  }

  /** Mark an untracked file as intent-to-add so its hunks can be staged individually. */
  intentToAdd(path: string) {
    return this.run(['add', '-N', '--', path])
  }

  /** Continue an in-progress operation without opening an editor. */
  continueOperation(op: string) {
    const cmd = op === 'MERGING' ? 'merge' : op === 'REBASING' ? 'rebase' : op === 'CHERRY-PICKING' ? 'cherry-pick' : 'revert'
    return this.run([cmd, '--continue'], [], { env: { GIT_EDITOR: 'true' } })
  }

  skipRebase() {
    return this.run(['rebase', '--skip'])
  }

  /** Commits after `base` up to HEAD, oldest first (as in a rebase todo). */
  async rebaseRange(base: string | null): Promise<{ hash: string; subject: string; parents: number }[]> {
    const fmt = ['%H', '%s', '%P'].join(FS)
    const out = await this.run(['log', '--reverse', `--format=${fmt}`, base ? `${base}..HEAD` : 'HEAD'])
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [hash, subject, parents] = l.split(FS)
        return { hash, subject, parents: parents ? parents.split(' ').length : 0 }
      })
  }

  /** Run `git rebase -i` with a prepared todo list (no editor ever opens). */
  async interactiveRebase(base: string | null, todo: string) {
    const todoPath = await window.api.writeTemp(todo)
    const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
    return this.run(['rebase', '-i', '--autostash', ...(base ? [base] : ['--root'])], [], {
      env: { GIT_SEQUENCE_EDITOR: `cp ${q(todoPath)}`, GIT_EDITOR: 'true' }
    })
  }

  commit(message: string, amend: boolean) {
    const args = ['commit', '-m', message]
    if (amend) args.push('--amend')
    return this.run(args)
  }

  fetch() {
    return this.run(['fetch', '--all', '--prune', '--tags'])
  }

  pull() {
    return this.run(['pull'])
  }

  async push(branch: string, remotes: string[], setUpstream: boolean) {
    if (!remotes.length) throw new Error('This repository has no remotes.')
    const remote = remotes.includes('origin') ? 'origin' : remotes[0]
    const args = ['push']
    if (setUpstream) args.push('-u')
    args.push(remote, branch)
    return this.run(args)
  }

  pushRefs(remote: string, refs: string[], tags = false) {
    return this.run(['push', remote, ...refs, ...(tags ? ['--tags'] : [])])
  }

  /** Push several local branches to one remote in as few commands as possible. */
  async pushBranches(remote: string, branches: { local: string; remoteName: string; setUpstream: boolean }[], tags: boolean) {
    if (!branches.length) throw new Error('Choose at least one branch to push.')
    const withUpstream = branches.filter((b) => b.setUpstream)
    const withoutUpstream = branches.filter((b) => !b.setUpstream)
    for (const [group, up] of [[withUpstream, true], [withoutUpstream, false]] as const) {
      if (!group.length) continue
      const args = ['push', ...(up ? ['-u'] : []), remote, ...group.map((b) => `${b.local}:${b.remoteName}`)]
      await this.run(args)
    }
    if (tags) await this.pushRefs(remote, [], true)
  }

  checkout(ref: string) {
    return this.run(['checkout', ref])
  }

  async checkoutRemote(remoteBranch: string) {
    const local = remoteBranch.slice(remoteBranch.indexOf('/') + 1)
    if (await this.branchExists(local)) return this.run(['checkout', local])
    return this.run(['checkout', '-b', local, '--track', remoteBranch])
  }

  createBranch(name: string, start: string | null, checkout: boolean) {
    const args = checkout ? ['checkout', '-b', name] : ['branch', name]
    if (start) args.push(start)
    return this.run(args)
  }

  renameBranch(oldName: string, newName: string) {
    return this.run(['branch', '-m', oldName, newName])
  }

  deleteBranch(name: string, force: boolean) {
    return this.run(['branch', force ? '-D' : '-d', name])
  }

  deleteRemoteBranch(remoteBranch: string) {
    const i = remoteBranch.indexOf('/')
    return this.run(['push', remoteBranch.slice(0, i), '--delete', remoteBranch.slice(i + 1)])
  }

  merge(ref: string, noFF: boolean, message?: string) {
    const args = ['merge']
    if (noFF) args.push('--no-ff')
    if (message) args.push('-m', message)
    else args.push('--no-edit')
    args.push(ref)
    return this.run(args)
  }

  rebase(onto: string) {
    return this.run(['rebase', onto])
  }

  abortOperation(op: string) {
    const cmd = op === 'MERGING' ? 'merge' : op === 'REBASING' ? 'rebase' : op === 'CHERRY-PICKING' ? 'cherry-pick' : 'revert'
    return this.run([cmd, '--abort'])
  }

  createTag(name: string, ref: string, message?: string) {
    return message ? this.run(['tag', '-a', name, '-m', message, ref]) : this.run(['tag', name, ref])
  }

  deleteTag(name: string) {
    return this.run(['tag', '-d', name])
  }

  cherryPick(hash: string) {
    return this.run(['cherry-pick', hash])
  }

  revert(hash: string) {
    return this.run(['revert', '--no-edit', hash])
  }

  reset(hash: string, mode: 'soft' | 'mixed' | 'hard' | 'keep') {
    return this.run(['reset', `--${mode}`, hash])
  }

  stashPush(message: string, includeUntracked: boolean) {
    const args = ['stash', 'push']
    if (includeUntracked) args.push('-u')
    if (message) args.push('-m', message)
    return this.run(args)
  }

  stashApply(ref: string, pop: boolean) {
    return this.run(['stash', pop ? 'pop' : 'apply', ref])
  }

  stashDrop(ref: string) {
    return this.run(['stash', 'drop', ref])
  }
}

function parseRefs(d: string, remoteNames: string[]): RefLabel[] {
  if (!d) return []
  const res: RefLabel[] = []
  for (let part of d.split(', ')) {
    part = part.trim()
    if (!part) continue
    if (part.startsWith('HEAD -> ')) {
      res.push({ name: 'HEAD', kind: 'head' })
      res.push({ name: part.slice(8), kind: 'local' })
    } else if (part === 'HEAD') {
      res.push({ name: 'HEAD', kind: 'head' })
    } else if (part.startsWith('tag: ')) {
      res.push({ name: part.slice(5), kind: 'tag' })
    } else if (part.endsWith('/HEAD')) {
      continue
    } else if (remoteNames.some((r) => part.startsWith(r + '/'))) {
      res.push({ name: part, kind: 'remote' })
    } else {
      res.push({ name: part, kind: 'local' })
    }
  }
  return res
}

function parseNameStatus(out: string): FileChange[] {
  const parts = out.split('\0').filter((p, i, a) => p !== '' || i < a.length - 1)
  const files: FileChange[] = []
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].trim()
    if (!code) continue
    const letter = code[0]
    if (letter === 'R' || letter === 'C') {
      files.push({ status: letter, oldPath: parts[i + 1], path: parts[i + 2] })
      i += 2
    } else {
      files.push({ status: letter, path: parts[i + 1] })
      i += 1
    }
  }
  return files
}
