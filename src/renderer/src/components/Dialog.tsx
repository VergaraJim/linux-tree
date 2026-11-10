import { Button, Checkbox, Input, Label, ListBox, Modal, Select, TextArea, TextField } from '@heroui/react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

export type Field =
  | { name: string; label: string; type: 'text' | 'password'; value?: string; placeholder?: string }
  | { name: string; label: string; type: 'textarea'; value?: string; placeholder?: string }
  | { name: string; label: string; type: 'checkbox'; value?: boolean }
  | { name: string; label: string; type: 'select'; value?: string; options: { value: string; label: string }[] }

export interface DialogSpec {
  title: string
  message?: ReactNode
  fields?: Field[]
  okLabel?: string
  danger?: boolean
  hideCancel?: boolean
  icon?: ReactNode
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

type Values = Record<string, string | boolean>

interface Ctx {
  prompt: (spec: DialogSpec) => Promise<Values | null>
  confirm: (title: string, message: ReactNode, okLabel?: string, danger?: boolean) => Promise<boolean>
  alert: (title: string, message: ReactNode) => Promise<void>
}

const DialogContext = createContext<Ctx | null>(null)

export function useDialog(): Ctx {
  const c = useContext(DialogContext)
  if (!c) throw new Error('useDialog outside DialogProvider')
  return c
}

let nextId = 1

interface Open {
  id: number
  spec: DialogSpec
  resolve: (v: Values | null) => void
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Open | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const prompt = useCallback(
    (spec: DialogSpec) =>
      new Promise<Values | null>((resolve) => {
        setCurrent((prev) => {
          prev?.resolve(null) // a newer dialog replaces an unanswered one
          return { id: nextId++, spec, resolve }
        })
        setIsOpen(true)
      }),
    []
  )
  const confirm = useCallback(
    async (title: string, message: ReactNode, okLabel = 'OK', danger = false) =>
      (await prompt({ title, message, okLabel, danger })) !== null,
    [prompt]
  )
  const alert = useCallback(
    async (title: string, message: ReactNode) => {
      await prompt({ title, message, okLabel: 'Close', hideCancel: true })
    },
    [prompt]
  )

  const finish = (v: Values | null) => {
    current?.resolve(v)
    setIsOpen(false)
  }

  return (
    <DialogContext.Provider value={{ prompt, confirm, alert }}>
      {children}
      {current && <DialogBox key={current.id} spec={current.spec} isOpen={isOpen} onFinish={finish} />}
    </DialogContext.Provider>
  )
}

function initialValues(spec: DialogSpec): Values {
  const v: Values = {}
  for (const f of spec.fields ?? []) {
    if (f.type === 'checkbox') v[f.name] = !!f.value
    else if (f.type === 'select') v[f.name] = f.value ?? f.options[0]?.value ?? ''
    else v[f.name] = f.value ?? ''
  }
  return v
}

function DialogBox({ spec, isOpen, onFinish }: { spec: DialogSpec; isOpen: boolean; onFinish: (v: Values | null) => void }) {
  const [values, setValues] = useState<Values>(() => initialValues(spec))
  const done = useRef(false)
  const set = (name: string, v: string | boolean) => setValues((s) => ({ ...s, [name]: v }))

  const finishOnce = (v: Values | null) => {
    if (done.current) return
    done.current = true
    onFinish(v)
  }

  const firstText = spec.fields?.find((f) => f.type === 'text' || f.type === 'password' || f.type === 'textarea')?.name

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && finishOnce(null)} variant="blur">
      <Modal.Container size={spec.size ?? 'sm'} placement="top" className="mt-[10vh]">
        <Modal.Dialog>
          <form
            className="flex flex-col"
            onSubmit={(e) => {
              e.preventDefault()
              finishOnce(values)
            }}
          >
            <Modal.Header>
              {spec.icon && (
                <Modal.Icon className={spec.danger ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent-soft-foreground'}>
                  {spec.icon}
                </Modal.Icon>
              )}
              <Modal.Heading>{spec.title}</Modal.Heading>
              {spec.message && (
                <div className="selectable-text mt-1.5 text-sm leading-5 text-muted [&_b]:font-semibold [&_b]:text-foreground">
                  {spec.message}
                </div>
              )}
            </Modal.Header>
            {!!spec.fields?.length && (
              <Modal.Body className="flex flex-col gap-4 py-1">
                {spec.fields.map((f) => {
                  if (f.type === 'checkbox') {
                    return (
                      <Checkbox key={f.name} variant="secondary" isSelected={!!values[f.name]} onChange={(v: boolean) => set(f.name, v)}>
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          {f.label}
                        </Checkbox.Content>
                      </Checkbox>
                    )
                  }
                  if (f.type === 'select') {
                    return (
                      <Select
                        key={f.name}
                        variant="secondary"
                        className="w-full"
                        value={values[f.name] as string}
                        onChange={(k) => {
                          if (k !== null && !Array.isArray(k)) set(f.name, String(k))
                        }}
                      >
                        <Label>{f.label}</Label>
                        <Select.Trigger>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {f.options.map((o) => (
                              <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                                {o.label}
                                <ListBox.ItemIndicator />
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    )
                  }
                  return (
                    <TextField
                      key={f.name}
                      variant="secondary"
                      className="w-full"
                      type={f.type === 'password' ? 'password' : 'text'}
                      value={values[f.name] as string}
                      onChange={(v) => set(f.name, v)}
                      autoFocus={f.name === firstText}
                    >
                      <Label>{f.label}</Label>
                      {f.type === 'textarea' ? (
                        <TextArea placeholder={f.placeholder} className="min-h-24 font-mono text-sm" spellCheck={false} />
                      ) : (
                        <Input placeholder={f.placeholder} spellCheck={false} autoComplete="off" />
                      )}
                    </TextField>
                  )
                })}
              </Modal.Body>
            )}
            <Modal.Footer className="mt-2">
              {!spec.hideCancel && (
                <Button variant="secondary" onPress={() => finishOnce(null)}>
                  Cancel
                </Button>
              )}
              <Button type="submit" variant={spec.danger ? 'danger' : 'primary'} autoFocus={!firstText}>
                {spec.okLabel ?? 'OK'}
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
