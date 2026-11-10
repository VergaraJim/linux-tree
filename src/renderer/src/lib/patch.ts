// Parse a single-file unified diff and build partial patches (hunks / lines)
// for `git apply`.

export interface DiffLine {
  type: '+' | '-' | ' ' | '\\'
  text: string // full line including the leading marker
  idx: number // index in the original diff text (stable id for selection)
}

export interface Hunk {
  header: string
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

export interface ParsedDiff {
  header: string[] // "diff --git", "index", "---", "+++" ...
  hunks: Hunk[]
}

export function parseDiff(diff: string): ParsedDiff {
  const lines = diff.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const header: string[] = []
  const hunks: Hunk[] = []
  let cur: Hunk | null = null
  let combined = false // `git diff` of a conflicted file: "@@@ -a -b +c @@@", two prefix columns
  lines.forEach((l, idx) => {
    if (l.startsWith('@@')) {
      combined = l.startsWith('@@@')
      const m = combined ? /@@@ -(\d+)(?:,\d+)? -\d+(?:,\d+)? \+(\d+)/.exec(l) : /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l)
      cur = { header: l, oldStart: m ? +m[1] : 0, newStart: m ? +m[2] : 0, lines: [] }
      hunks.push(cur)
    } else if (!cur) {
      header.push(l)
    } else if (combined) {
      // Display-only (partial staging is disabled for conflicted files).
      const cols = l.slice(0, 2)
      const t = l[0] === '\\' ? '\\' : cols.includes('+') ? '+' : cols.includes('-') ? '-' : ' '
      cur.lines.push({ type: t, text: l === '' ? ' ' : l, idx })
    } else {
      const t = l[0]
      if (t === '+' || t === '-' || t === '\\') cur.lines.push({ type: t, text: l, idx })
      else cur.lines.push({ type: ' ', text: l === '' ? ' ' : l, idx })
    }
  })
  return { header, hunks }
}

/**
 * Build a patch containing only the selected changed lines of one hunk.
 * - selected === null → whole hunk.
 * - reverse === false (stage): unselected '+' dropped, unselected '-' kept as context.
 * - reverse === true  (unstage/discard, applied with -R): unselected '-' dropped,
 *   unselected '+' kept as context.
 */
export function buildPatch(parsed: ParsedDiff, hunk: Hunk, selected: Set<number> | null, reverse: boolean): string | null {
  const out: string[] = []
  let oldCount = 0
  let newCount = 0
  let changes = 0
  let lastKept = false

  for (const l of hunk.lines) {
    if (l.type === '\\') {
      if (lastKept) out.push(l.text)
      continue
    }
    const sel = selected === null || selected.has(l.idx)
    if (l.type === ' ') {
      out.push(l.text)
      oldCount++
      newCount++
      lastKept = true
    } else if (sel) {
      out.push(l.text)
      if (l.type === '+') newCount++
      else oldCount++
      changes++
      lastKept = true
    } else if ((l.type === '-' && !reverse) || (l.type === '+' && reverse)) {
      out.push(' ' + l.text.slice(1)) // becomes context
      oldCount++
      newCount++
      lastKept = true
    } else {
      lastKept = false // dropped
    }
  }
  if (!changes) return null

  // Present new/deleted files as edits of an existing (possibly empty) file, so a
  // partial patch applies to an intent-to-add entry or leaves a partial deletion.
  const minus = parsed.header.find((h) => h.startsWith('--- '))
  const plus = parsed.header.find((h) => h.startsWith('+++ '))
  const path = (plus && plus !== '+++ /dev/null' ? plus.slice(6) : minus?.slice(6)) ?? ''
  const header = parsed.header
    .filter((h) => !/^(new|deleted) file mode/.test(h))
    .map((h) => (h === '--- /dev/null' ? `--- a/${path}` : h === '+++ /dev/null' ? `+++ b/${path}` : h))
  const h = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`
  return [...header, h, ...out].join('\n') + '\n'
}

export function isChange(l: DiffLine): boolean {
  return l.type === '+' || l.type === '-'
}
