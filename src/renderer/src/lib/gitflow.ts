// Native git-flow implementation. Config is stored under the same `gitflow.*`
// keys that Sourcetree / git-flow (AVH) use, so existing repos just work.
import type { Repo } from './git'

export type FlowType = 'feature' | 'release' | 'hotfix'

export interface FlowConfig {
  main: string
  develop: string
  feature: string
  release: string
  hotfix: string
  versionTag: string
}

export const FLOW_DEFAULTS: FlowConfig = {
  main: 'main',
  develop: 'develop',
  feature: 'feature/',
  release: 'release/',
  hotfix: 'hotfix/',
  versionTag: 'v'
}

const KEYS: Record<keyof FlowConfig, string> = {
  main: 'gitflow.branch.master',
  develop: 'gitflow.branch.develop',
  feature: 'gitflow.prefix.feature',
  release: 'gitflow.prefix.release',
  hotfix: 'gitflow.prefix.hotfix',
  versionTag: 'gitflow.prefix.versiontag'
}

export async function readFlowConfig(repo: Repo): Promise<FlowConfig | null> {
  const main = await repo.config(KEYS.main)
  const develop = await repo.config(KEYS.develop)
  if (!main || !develop) return null
  const cfg = { ...FLOW_DEFAULTS, main, develop }
  for (const k of ['feature', 'release', 'hotfix', 'versionTag'] as const) {
    const v = await repo.config(KEYS[k])
    if (v !== null) cfg[k] = v
  }
  return cfg
}

export async function initFlow(repo: Repo, cfg: FlowConfig): Promise<void> {
  if (!(await repo.tryRun(['rev-parse', '--verify', '-q', 'HEAD']))) {
    throw new Error('The repository has no commits yet. Make an initial commit first.')
  }
  if (!(await repo.branchExists(cfg.main))) {
    throw new Error(`Production branch "${cfg.main}" does not exist.`)
  }
  for (const k of Object.keys(KEYS) as (keyof FlowConfig)[]) {
    await repo.run(['config', KEYS[k], cfg[k]])
  }
  if (!(await repo.branchExists(cfg.develop))) {
    // Prefer tracking an existing remote develop branch.
    const remoteDev = await repo.tryRun(['rev-parse', '--verify', '-q', `refs/remotes/origin/${cfg.develop}`])
    if (remoteDev) await repo.run(['branch', '--track', cfg.develop, `origin/${cfg.develop}`])
    else await repo.run(['branch', cfg.develop, cfg.main])
  }
}

/** Which flow branch (if any) is this, and what is its short name? */
export function classify(branch: string | null, cfg: FlowConfig | null): { type: FlowType; name: string } | null {
  if (!branch || !cfg) return null
  for (const type of ['feature', 'release', 'hotfix'] as const) {
    const prefix = cfg[type]
    if (prefix && branch.startsWith(prefix) && branch.length > prefix.length) {
      return { type, name: branch.slice(prefix.length) }
    }
  }
  return null
}

export function baseFor(type: FlowType, cfg: FlowConfig): string {
  return type === 'hotfix' ? cfg.main : cfg.develop
}

export async function startFlow(repo: Repo, cfg: FlowConfig, type: FlowType, name: string, base?: string) {
  name = name.trim()
  if (!name) throw new Error('A name is required.')
  const branch = cfg[type] + name
  if (await repo.branchExists(branch)) throw new Error(`Branch "${branch}" already exists.`)
  await repo.createBranch(branch, base || baseFor(type, cfg), true)
}

export interface FinishOptions {
  keepBranch: boolean
  tagMessage?: string // release/hotfix
  push: boolean
  remotes: string[]
}

/**
 * Finish a flow branch. Safe to re-run after resolving a merge conflict:
 * merges that are already done are no-ops and an existing tag is kept.
 */
export async function finishFlow(
  repo: Repo,
  cfg: FlowConfig,
  type: FlowType,
  name: string,
  opts: FinishOptions,
  log: (msg: string) => void
): Promise<void> {
  const branch = cfg[type] + name
  if (!(await repo.branchExists(branch))) throw new Error(`Branch "${branch}" does not exist.`)
  if (!(await repo.isClean())) throw new Error('You have uncommitted changes. Commit or stash them first.')

  const mergeInto = async (target: string, source = branch) => {
    log(`Merging ${source} into ${target}…`)
    await repo.checkout(target)
    const what = source === branch ? `branch '${source}'` : `tag '${source}'`
    try {
      await repo.merge(source, true, `Merge ${what} into ${target}`)
    } catch (e) {
      throw new Error(
        `Merge conflict while merging ${source} into ${target}.\n` +
          `Resolve the conflicts and commit, then run "Finish ${type}" again.\n\n${(e as Error).message}`
      )
    }
  }

  let tag: string | null = null
  if (type === 'feature') {
    await mergeInto(cfg.develop)
  } else {
    await mergeInto(cfg.main)
    tag = cfg.versionTag + name
    const tagExists = await repo.tryRun(['rev-parse', '--verify', '-q', `refs/tags/${tag}`])
    if (!tagExists) {
      log(`Tagging ${tag}…`)
      await repo.createTag(tag, cfg.main, opts.tagMessage || `${type === 'release' ? 'Release' : 'Hotfix'} ${name}`)
    }
    // Like git-flow/Sourcetree: back-merge the tag so develop contains the release commit.
    await mergeInto(cfg.develop, tag)
  }

  const remote = opts.remotes.includes('origin') ? 'origin' : opts.remotes[0]
  const hadRemote = remote
    ? !!(await repo.tryRun(['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${branch}`]))
    : false

  if (!opts.keepBranch) {
    log(`Deleting ${branch}…`)
    await repo.deleteBranch(branch, false)
  }

  if (opts.push && remote) {
    log(`Pushing to ${remote}…`)
    const refs = type === 'feature' ? [cfg.develop] : [cfg.main, cfg.develop]
    await repo.pushRefs(remote, refs)
    if (tag) await repo.pushRefs(remote, [`refs/tags/${tag}`])
    if (!opts.keepBranch && hadRemote) await repo.run(['push', remote, '--delete', branch])
  }
}
