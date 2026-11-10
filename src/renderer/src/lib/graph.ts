import type { Commit } from './types'

export interface GraphRow {
  col: number
  before: (string | null)[] // lanes entering the row from above
  after: (string | null)[] // lanes leaving the row downward
}

/**
 * Lane assignment for a commit list in display order (newest first).
 * Each lane holds the hash of the commit it is "waiting for".
 */
export function layoutGraph(commits: Commit[]): { rows: GraphRow[]; maxLanes: number } {
  let lanes: (string | null)[] = []
  let maxLanes = 1
  const rows: GraphRow[] = []
  for (const c of commits) {
    let col = lanes.indexOf(c.hash)
    if (col === -1) {
      col = lanes.indexOf(null)
      if (col === -1) {
        col = lanes.length
        lanes.push(null)
      }
      lanes[col] = c.hash
    }
    const before = lanes.slice()
    const after = lanes.map((h) => (h === c.hash ? null : h))
    const [first, ...rest] = c.parents
    if (first && !after.includes(first)) after[col] = first
    for (const p of rest) {
      if (after.includes(p)) continue
      let free = after.indexOf(null)
      if (free === -1) {
        free = after.length
        after.push(null)
      }
      after[free] = p
    }
    while (after.length && after[after.length - 1] === null) after.pop()
    rows.push({ col, before, after })
    lanes = after
    maxLanes = Math.max(maxLanes, before.length, after.length)
  }
  return { rows, maxLanes }
}

export const LANE_W = 16
export const ROW_H = 28
export const LANE_COLORS = ['#4fa3ff', '#e5a33a', '#57c27a', '#d36ad6', '#e5605a', '#3cc6c6', '#c8c84a', '#9a8cff']

export const laneX = (i: number): number => LANE_W / 2 + i * LANE_W + 4
export const laneColor = (i: number): string => LANE_COLORS[i % LANE_COLORS.length]
