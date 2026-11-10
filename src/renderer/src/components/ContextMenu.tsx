import { Dropdown, Header, Label, Separator } from '@heroui/react'
import { Button as AriaButton } from 'react-aria-components'
import type { Key, ReactNode } from 'react'

export type MenuItem =
  | { label: string; action: () => void; danger?: boolean; disabled?: boolean; icon?: ReactNode }
  | { separator: true }
  | { header: string }

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
  id: number
}

type Action = Extract<MenuItem, { action: () => void }>

interface Group {
  header?: string
  items: { key: string; item: Action }[]
}

/** Split a flat item list into sections at separators (HeroUI menus render sections + separators). */
function groups(items: MenuItem[]): Group[] {
  const out: Group[] = [{ items: [] }]
  items.forEach((it, i) => {
    const g = out[out.length - 1]
    if ('separator' in it) {
      if (g.items.length || g.header) out.push({ items: [] })
    } else if ('header' in it) {
      if (g.items.length) out.push({ header: it.header, items: [] })
      else g.header = it.header
    } else {
      g.items.push({ key: String(i), item: it })
    }
  })
  return out.filter((g) => g.items.length)
}

/** Menu body shared by right-click menus and toolbar dropdowns. */
export function MenuBody({ items, label }: { items: MenuItem[]; label: string }) {
  const gs = groups(items)
  const byKey = new Map(gs.flatMap((g) => g.items.map((x) => [x.key, x.item] as const)))
  const disabled = [...byKey].filter(([, it]) => it.disabled).map(([k]) => k)
  const hasIcons = [...byKey.values()].some((it) => it.icon)
  return (
    <Dropdown.Menu aria-label={label} disabledKeys={disabled} onAction={(key: Key) => byKey.get(String(key))?.action()}>
      {gs.flatMap((g, gi) => {
        const section = (
          <Dropdown.Section key={`s${gi}`}>
            {g.header && <Header className="max-w-80 truncate">{g.header}</Header>}
            {g.items.map(({ key, item }) => (
              <Dropdown.Item key={key} id={key} textValue={item.label} variant={item.danger ? 'danger' : 'default'}>
                {hasIcons && (
                  <span className={`flex size-4 flex-none items-center justify-center ${item.danger ? 'text-danger' : 'text-muted'}`}>
                    {item.icon}
                  </span>
                )}
                <Label className="max-w-96 truncate">{item.label}</Label>
              </Dropdown.Item>
            ))}
          </Dropdown.Section>
        )
        return gi === 0 ? [section] : [<Separator key={`sep${gi}`} />, section]
      })}
    </Dropdown.Menu>
  )
}

/** Right-click menu anchored at the cursor via an invisible trigger. */
export function ContextMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
  if (!menu) return null
  return (
    <Dropdown key={menu.id} isOpen onOpenChange={(open) => !open && onClose()}>
      <AriaButton
        aria-hidden
        style={{ position: 'fixed', left: menu.x, top: menu.y, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
      <Dropdown.Popover placement="bottom start" offset={2} className="min-w-56">
        <MenuBody items={menu.items} label="Context menu" />
      </Dropdown.Popover>
    </Dropdown>
  )
}
