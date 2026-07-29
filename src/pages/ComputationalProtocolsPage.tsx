import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Copy, Download, Pencil, Play, Plus, Search, Trash2 } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { Field, Modal, SearchInput } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import {
  activateProtocol,
  createProtocol,
  loadProtocols,
  saveProtocols,
  type ComputationalProtocol,
  type ComputationalProtocolInput,
} from '../lib/computationalProtocols'
import type { QuantumMode, QuantumSoftware, Scheduler, StateType } from '../lib/quantumGenerator'
import { cx, download } from '../lib/utils'

function blank(): ComputationalProtocolInput {
  return {
    title: 'New PEARL protocol',
    software: 'gaussian',
    method: 'm062x',
    basis: 'def2SVP',
    solventModel: 'SMD',
    solventName: 'DMSO',
    mode: 'single',
    step: 4,
    multiSteps: [1, 2, 4],
    scheduler: 'pbs',
    queue: 'normal',
    nproc: 64,
    memory: '128GB',
    maxcoreMb: 4000,
    walltime: '24:00:00',
    project: '15002108',
    tdStates: 3,
    tdRoot: 1,
    stateType: 'singlet',
    popFull: false,
    dispersion: false,
    socEnable: false,
    notes: '',
    tags: [],
  }
}

function parseTags(value: string) {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean)
}

function stepsText(protocol: ComputationalProtocol) {
  if (protocol.mode === 'full') return 'Full workflow'
  if (protocol.mode === 'multiple') return `Steps ${protocol.multiSteps.join(', ')}`
  return `Step ${protocol.step}`
}

export default function ComputationalProtocolsPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [protocols, setProtocols] = useState(() => loadProtocols(profile?.id))
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<ComputationalProtocol | 'new' | null>(null)
  const [form, setForm] = useState<ComputationalProtocolInput>(blank)
  const [tagText, setTagText] = useState('')

  function persist(rows: ComputationalProtocol[]) {
    setProtocols(rows)
    saveProtocols(profile?.id, rows)
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return protocols
    return protocols.filter((protocol) => [
      protocol.title,
      protocol.software,
      protocol.method,
      protocol.basis,
      protocol.solventName,
      protocol.notes,
      protocol.tags.join(' '),
    ].some((value) => value.toLowerCase().includes(needle)))
  }, [protocols, q])

  function openEditor(protocol?: ComputationalProtocol) {
    if (protocol) {
      setEditing(protocol)
      const { id: _id, updatedAt: _updatedAt, ...input } = protocol
      setForm(input)
      setTagText(protocol.tags.join(', '))
    } else {
      setEditing('new')
      setForm(blank())
      setTagText('')
    }
  }

  function save() {
    const input = { ...form, tags: parseTags(tagText) }
    if (!input.title.trim()) return toast.error('Protocol needs a title.')
    const next = editing && editing !== 'new'
      ? protocols.map((row) => row.id === editing.id ? { ...input, id: editing.id, updatedAt: new Date().toISOString() } : row)
      : [createProtocol(input), ...protocols]
    persist(next)
    setEditing(null)
    toast.success('Protocol saved.')
  }

  function remove(protocol: ComputationalProtocol) {
    persist(protocols.filter((row) => row.id !== protocol.id))
    toast.success('Protocol removed from your library.')
  }

  function duplicate(protocol: ComputationalProtocol) {
    const { id: _id, updatedAt: _updatedAt, ...input } = protocol
    persist([createProtocol({ ...input, title: `${protocol.title} copy` }), ...protocols])
    toast.success('Protocol duplicated.')
  }

  function useInWorkbench(protocol: ComputationalProtocol) {
    activateProtocol(protocol)
    toast.success('Protocol loaded for the Workbench.')
    navigate('/computational/workbench')
  }

  function exportJson() {
    download('pearl-computational-protocols.json', JSON.stringify(protocols, null, 2), 'application/json;charset=utf-8')
  }

  return (
    <>
      <PageHeader
        title="Method Library"
        description="Private reusable calculation recipes for Gaussian, ORCA, scheduler resources, TD settings, solvent models, and notes."
        actions={
          <>
            <button className="btn-secondary" onClick={exportJson}>
              <Download className="h-4 w-4" /> Export
            </button>
            <button className="btn-primary" onClick={() => openEditor()}>
              <Plus className="h-4 w-4" /> New protocol
            </button>
          </>
        }
      />

      <div className="mb-4 max-w-xl">
        <SearchInput value={q} onChange={setQ} placeholder="Search method, basis, solvent, tags, notes..." />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {filtered.map((protocol) => (
          <section key={protocol.id} className="card flex min-h-[250px] flex-col p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <Badge label={protocol.software} />
                  <Badge label={stepsText(protocol)} muted />
                </div>
                <h2 className="line-clamp-2 text-base font-bold text-ink-900 dark:text-ink-50">{protocol.title}</h2>
                <p className="mt-1 text-xs text-ink-500">{protocol.method} / {protocol.basis} {protocol.solventModel !== 'none' ? `in ${protocol.solventName || protocol.solventModel}` : 'gas phase'}</p>
              </div>
              <BookOpen className="h-5 w-5 shrink-0 text-pearl-600" />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <Info label="CPUs" value={protocol.nproc} />
              <Info label="Memory" value={protocol.software === 'orca' ? `${protocol.maxcoreMb} MB/core` : protocol.memory} />
              <Info label="Walltime" value={protocol.walltime} />
              <Info label="Queue" value={protocol.queue || '-'} />
              <Info label="TD states" value={protocol.tdStates} />
              <Info label="State" value={protocol.stateType} />
            </dl>
            {protocol.notes && <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-ink-500">{protocol.notes}</p>}
            {protocol.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {protocol.tags.map((tag) => <span key={tag} className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600 dark:bg-ink-800 dark:text-ink-300">{tag}</span>)}
              </div>
            )}
            <div className="mt-auto flex flex-wrap gap-2 pt-4">
              <button className="btn-primary py-1.5 text-xs" onClick={() => useInWorkbench(protocol)}>
                <Play className="h-3.5 w-3.5" /> Use
              </button>
              <button className="btn-secondary py-1.5 text-xs" onClick={() => openEditor(protocol)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              <button className="btn-secondary py-1.5 text-xs" onClick={() => duplicate(protocol)}>
                <Copy className="h-3.5 w-3.5" /> Copy
              </button>
              <button className="btn-ghost py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10" onClick={() => remove(protocol)}>
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            </div>
          </section>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="card">
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <Search className="h-6 w-6 text-ink-400" />
            <p className="mt-3 text-sm font-semibold text-ink-900 dark:text-ink-50">No matching protocols</p>
          </div>
        </div>
      )}

      {editing && (
        <Modal open={Boolean(editing)} title={editing === 'new' ? 'New protocol' : 'Edit protocol'} onClose={() => setEditing(null)} size="xl">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Title">
              <input className="input" value={form.title} onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))} />
            </Field>
            <Field label="Software">
              <select className="input" value={form.software} onChange={(event) => setForm((f) => ({ ...f, software: event.target.value as QuantumSoftware }))}>
                <option value="gaussian">Gaussian</option>
                <option value="orca">ORCA</option>
              </select>
            </Field>
            <Field label="Method">
              <input className="input" value={form.method} onChange={(event) => setForm((f) => ({ ...f, method: event.target.value }))} />
            </Field>
            <Field label="Basis">
              <input className="input" value={form.basis} onChange={(event) => setForm((f) => ({ ...f, basis: event.target.value }))} />
            </Field>
            <Field label="Solvent model">
              <select className="input" value={form.solventModel} onChange={(event) => setForm((f) => ({ ...f, solventModel: event.target.value as ComputationalProtocolInput['solventModel'] }))}>
                <option value="none">Gas phase</option>
                <option value="SMD">SMD</option>
                <option value="PCM">PCM</option>
                <option value="IEFPCM">IEFPCM</option>
                <option value="CPCM">CPCM</option>
              </select>
            </Field>
            <Field label="Solvent">
              <input className="input" value={form.solventName} onChange={(event) => setForm((f) => ({ ...f, solventName: event.target.value }))} />
            </Field>
            <Field label="Mode">
              <select className="input" value={form.mode} onChange={(event) => setForm((f) => ({ ...f, mode: event.target.value as QuantumMode }))}>
                <option value="single">Single</option>
                <option value="multiple">Multiple</option>
                <option value="full">Full workflow</option>
              </select>
            </Field>
            <Field label="Step">
              <input className="input" type="number" min={1} value={form.step} onChange={(event) => setForm((f) => ({ ...f, step: Number(event.target.value) }))} />
            </Field>
            <Field label="Multiple steps">
              <input className="input" value={form.multiSteps.join(', ')} onChange={(event) => setForm((f) => ({ ...f, multiSteps: event.target.value.split(',').map((v) => Number(v.trim())).filter(Number.isFinite) }))} />
            </Field>
            <Field label="Scheduler">
              <select className="input" value={form.scheduler} onChange={(event) => setForm((f) => ({ ...f, scheduler: event.target.value as Scheduler }))}>
                <option value="pbs">PBS</option>
                <option value="slurm">SLURM</option>
                <option value="local">Local</option>
              </select>
            </Field>
            <Field label="Queue">
              <input className="input" value={form.queue} onChange={(event) => setForm((f) => ({ ...f, queue: event.target.value }))} />
            </Field>
            <Field label="Project/account">
              <input className="input" value={form.project} onChange={(event) => setForm((f) => ({ ...f, project: event.target.value }))} />
            </Field>
            <Field label="CPUs">
              <input className="input" type="number" min={1} value={form.nproc} onChange={(event) => setForm((f) => ({ ...f, nproc: Number(event.target.value) }))} />
            </Field>
            <Field label="Memory">
              <input className="input" value={form.memory} onChange={(event) => setForm((f) => ({ ...f, memory: event.target.value }))} />
            </Field>
            <Field label="ORCA MaxCore MB">
              <input className="input" type="number" min={500} value={form.maxcoreMb} onChange={(event) => setForm((f) => ({ ...f, maxcoreMb: Number(event.target.value) }))} />
            </Field>
            <Field label="Walltime">
              <input className="input" value={form.walltime} onChange={(event) => setForm((f) => ({ ...f, walltime: event.target.value }))} />
            </Field>
            <Field label="TD states">
              <input className="input" type="number" min={1} value={form.tdStates} onChange={(event) => setForm((f) => ({ ...f, tdStates: Number(event.target.value) }))} />
            </Field>
            <Field label="TD root">
              <input className="input" type="number" min={1} value={form.tdRoot} onChange={(event) => setForm((f) => ({ ...f, tdRoot: Number(event.target.value) }))} />
            </Field>
            <Field label="State type">
              <select className="input" value={form.stateType} onChange={(event) => setForm((f) => ({ ...f, stateType: event.target.value as StateType }))}>
                <option value="singlet">Singlet</option>
                <option value="triplet">Triplet</option>
                <option value="mixed">Mixed</option>
              </select>
            </Field>
            <Field label="Tags">
              <input className="input" value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="gaussian, tddft, emission" />
            </Field>
            <div className="grid gap-2 md:col-span-2 sm:grid-cols-3">
              <Toggle label="Pop full" checked={form.popFull} onChange={(value) => setForm((f) => ({ ...f, popFull: value }))} />
              <Toggle label="GD3BJ" checked={form.dispersion} onChange={(value) => setForm((f) => ({ ...f, dispersion: value }))} />
              <Toggle label="SOC prep" checked={form.socEnable} onChange={(value) => setForm((f) => ({ ...f, socEnable: value, stateType: value ? 'mixed' : f.stateType }))} />
            </div>
            <Field label="Notes">
              <textarea className="input min-h-[120px]" value={form.notes} onChange={(event) => setForm((f) => ({ ...f, notes: event.target.value }))} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={save}>Save protocol</button>
          </div>
        </Modal>
      )}
    </>
  )
}

function Badge({ label, muted = false }: { label: string; muted?: boolean }) {
  return (
    <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', muted ? 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-300' : 'bg-pearl-50 text-pearl-700 dark:bg-pearl-500/10 dark:text-pearl-300')}>
      {label}
    </span>
  )
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-ink-50 p-2 dark:bg-ink-900/70">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-ink-800 dark:text-ink-100">{value}</dd>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-800">
      <span className="font-medium text-ink-700 dark:text-ink-200">{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}
