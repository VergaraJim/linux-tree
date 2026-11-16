import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'

export interface MigrateInput {
  settingsPath: string // absolute path of this app's own settings.json
  homeDir: string // app.getPath('home')
  sandboxed: boolean // true when process.env.FLATPAK_ID is set
}

// Returns the path that was copied, or null when nothing was migrated.
export function migrateLegacySettings(input: MigrateInput): string | null {
  if (!input.sandboxed) return null
  if (existsSync(input.settingsPath)) return null
  const legacy = join(input.homeDir, '.config', 'Linux Tree', 'settings.json')
  if (!existsSync(legacy)) return null
  try {
    JSON.parse(readFileSync(legacy, 'utf8'))
  } catch {
    return null
  }
  mkdirSync(dirname(input.settingsPath), { recursive: true })
  copyFileSync(legacy, input.settingsPath)
  return input.settingsPath
}
