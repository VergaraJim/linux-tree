import { Button, Tooltip, toast } from '@heroui/react'
import { memo, type ReactNode } from 'react'

// ---------- notifications ----------

export function notifyError(title: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  toast.danger(title, {
    description: (
      <pre className="selectable-text max-h-56 overflow-auto font-mono text-xs whitespace-pre-wrap break-words">{msg}</pre>
    ),
    timeout: 0
  })
}

export function notifySuccess(title: string, description?: ReactNode): void {
  toast.success(title, { description })
}

// ---------- dates ----------

export function formatDate(sec: number): string {
  const d = new Date(sec * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const units: [number, string][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
    [2592000, 'month'],
    [31536000, 'year']
  ]
  let unit = units[0]
  for (const u of units) if (s >= u[0]) unit = u
  const n = Math.floor(s / unit[0])
  return `${n} ${unit[1]}${n > 1 ? 's' : ''} ago`
}

// ---------- avatars ----------

function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

export const Avatar = memo(function Avatar({ name, email, size = 20 }: { name: string; email?: string; size?: number }) {
  const parts = name.trim().split(/\s+/)
  const initials = ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
  const hue = hashHue(email || name)
  return (
    <span
      className="inline-flex flex-none items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, size * 0.42),
        background: `oklch(0.62 0.13 ${hue})`
      }}
      aria-hidden
    >
      {initials}
    </span>
  )
})

// ---------- toolbar ----------

interface ToolbarButtonProps {
  icon: ReactNode
  label: string
  tooltip?: string
  onPress?: () => void
  isDisabled?: boolean
  badge?: number
  highlight?: boolean
}

export function ToolbarButton({ icon, label, tooltip, onPress, isDisabled, badge, highlight }: ToolbarButtonProps) {
  const button = (
      <Button
        variant="ghost"
        size="sm"
        isDisabled={isDisabled}
        onPress={onPress}
        className={`relative h-12 min-w-14 flex-col gap-0.5 px-2 ${highlight ? 'text-warning' : 'text-foreground'}`}
      >
        <span className="relative">
          {icon}
          {!!badge && (
            <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 font-semibold text-accent-foreground">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </span>
        <span className={`text-[11px] font-medium ${highlight ? 'text-warning' : 'text-muted'}`}>{label}</span>
      </Button>
  )
  // Without a tooltip the Button is returned bare so it can act as a Dropdown trigger.
  if (!tooltip) return button
  return (
    <Tooltip delay={600}>
      {button}
      <Tooltip.Content>{tooltip}</Tooltip.Content>
    </Tooltip>
  )
}

export function IconButton({
  label,
  onPress,
  children,
  isDisabled,
  className = ''
}: {
  label: string
  onPress: () => void
  children: ReactNode
  isDisabled?: boolean
  className?: string
}) {
  return (
    <Tooltip delay={500}>
      <Button isIconOnly variant="ghost" size="sm" aria-label={label} onPress={onPress} isDisabled={isDisabled} className={className}>
        {children}
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  )
}

// ---------- file status ----------

const STATUS: Record<string, [string, string, string]> = {
  M: ['M', 'bg-warning/90 text-warning-foreground', 'Modified'],
  A: ['A', 'bg-success/90 text-success-foreground', 'Added'],
  D: ['D', 'bg-danger/90 text-danger-foreground', 'Deleted'],
  R: ['R', 'bg-accent/90 text-accent-foreground', 'Renamed'],
  C: ['C', 'bg-accent/90 text-accent-foreground', 'Copied'],
  '?': ['?', 'bg-default text-muted', 'Untracked'],
  U: ['!', 'bg-danger text-danger-foreground', 'Conflicted'],
  T: ['T', 'bg-warning/90 text-warning-foreground', 'Type changed']
}

export function StatusIcon({ status }: { status: string }) {
  const [t, c, title] = STATUS[status] ?? [status, 'bg-default text-muted', status]
  return (
    <span title={title} className={`inline-flex size-4 flex-none items-center justify-center rounded-[4px] text-[10px] font-bold ${c}`}>
      {t}
    </span>
  )
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex h-9 flex-none items-center justify-between gap-2 px-3 text-xs font-semibold tracking-wide text-muted uppercase">
      <span className="flex items-center gap-2">{children}</span>
      {right}
    </div>
  )
}
