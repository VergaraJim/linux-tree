export interface Commit {
  hash: string
  parents: string[]
  author: string
  email: string
  date: number // unix seconds
  subject: string
  refs: RefLabel[]
}

export interface RefLabel {
  name: string
  kind: 'head' | 'local' | 'remote' | 'tag'
}

export interface Branch {
  name: string // short name, e.g. "feature/login" or "origin/feature/login"
  remote: boolean
  current: boolean
  upstream?: string
  ahead: number
  behind: number
  gone: boolean
}

export interface FileChange {
  path: string
  oldPath?: string
  status: string // single letter: M A D R C U ?
}

export interface WorkingStatus {
  staged: FileChange[]
  unstaged: FileChange[]
  conflicted: FileChange[]
}

export interface Stash {
  ref: string // stash@{0}
  message: string
}

export interface RepoState {
  head: string | null // current branch, null when detached
  headHash: string | null
  branches: Branch[]
  tags: string[]
  remotes: string[]
  remoteUrls: Record<string, string> // remote name → URL
  stashes: Stash[]
  status: WorkingStatus
  operation: string | null // "MERGING", "REBASING", ...
}

export interface CommitDetail {
  hash: string
  parents: string[]
  author: string
  email: string
  date: number
  committer: string
  body: string
  files: FileChange[]
}
