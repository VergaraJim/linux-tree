export interface IgnoreOption {
  value: string
  label: string
  description?: string
}

// Characters with a special meaning in a gitignore pattern.
const SPECIAL = /[\\*?[]/g

function escapeSegment(s: string): string {
  const escaped = s.replace(SPECIAL, '\\$&')
  return escaped.endsWith(' ') ? escaped.slice(0, -1) + '\\ ' : escaped
}

// A leading # or ! is only special at the start of an unanchored pattern.
function escapeUnanchored(s: string): string {
  return s.startsWith('#') || s.startsWith('!') ? '\\' + s : s
}

function pathPattern(p: string): string {
  return '/' + p.split('/').map(escapeSegment).join('/')
}

function folderPattern(dir: string): string {
  return '/' + dir.split('/').map(escapeSegment).join('/') + '/'
}

function baseName(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? p : p.slice(i + 1)
}

function extension(p: string): string | null {
  const n = baseName(p)
  const i = n.lastIndexOf('.')
  return i > 0 && i < n.length - 1 ? n.slice(i + 1) : null
}

/** Parent folders of a file, nearest first. */
function parentDirs(p: string): string[] {
  const parts = p.split('/')
  parts.pop()
  const res: string[] = []
  for (let i = parts.length; i > 0; i--) res.push(parts.slice(0, i).join('/'))
  return res
}

function pushOption(opts: IgnoreOption[], value: string, label: string): void {
  if (!value || opts.some((o) => o.value === value)) return
  opts.push({ value, label, description: value })
}

/** Ignore patterns for repository-relative paths ('/' separated). */
export function ignoreOptions(paths: string[]): IgnoreOption[] {
  const clean = paths.filter(Boolean).filter((p, i, a) => a.indexOf(p) === i)
  const opts: IgnoreOption[] = []
  if (!clean.length) return opts

  if (clean.length === 1) {
    const p = clean[0]
    const name = baseName(p)
    const ext = extension(p)
    pushOption(opts, pathPattern(p), 'This file only')
    pushOption(opts, escapeUnanchored(escapeSegment(name)), `All ${name} files`)
    if (ext) pushOption(opts, '*.' + escapeSegment(ext), `All .${ext} files`)
    for (const dir of parentDirs(p)) pushOption(opts, folderPattern(dir), `Everything in ${dir}/`)
    return opts
  }

  pushOption(
    opts,
    clean.map(pathPattern).join('\n'),
    'These files only'
  )

  const exts = clean.map(extension)
  if (exts.every((e): e is string => !!e)) {
    const unique = exts.filter((e, i, a) => a.indexOf(e) === i)
    pushOption(
      opts,
      unique.map((e) => '*.' + escapeSegment(e)).join('\n'),
      `All ${unique.map((e) => '.' + e).join(', ')} files`
    )
  }

  const first = parentDirs(clean[0])
  const rest = clean.slice(1).map(parentDirs)
  for (const dir of first) {
    if (rest.every((dirs) => dirs.includes(dir))) pushOption(opts, folderPattern(dir), `Everything in ${dir}/`)
  }
  return opts
}
