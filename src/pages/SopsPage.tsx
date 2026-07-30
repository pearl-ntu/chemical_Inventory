import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { ConfirmDialog, EmptyState, Field, LoadingScreen, Modal, MultiSelect, SearchInput, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import type { Equipment, Sop, SopInput } from '../lib/types'
import { formatRelative } from '../lib/utils'

const BLANK: SopInput = { title: '', body: '', related_chemical_ids: [], related_equipment_id: null }

/**
 * "How do I safely handle this / operate this" — one click away from the
 * chemical or equipment record it applies to, not a separate library
 * nobody remembers exists. Plain text body (no markdown renderer in this
 * app yet) — kept proportional to what a small lab actually needs.
 */
export default function SopsPage() {
  const { canEdit, isAdmin, profile } = useAuth()
  const { chemicals } = useInventory()
  const toast = useToast()
  const [params] = useSearchParams()
  const [sops, setSops] = useState<Sop[]>([])
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Sop | null>(null)
  const [form, setForm] = useState<SopInput>(BLANK)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [toDelete, setToDelete] = useState<Sop | null>(null)

  async function load() {
    const [s, e] = await Promise.all([api.listSops(), api.listEquipment()])
    setSops(s)
    setEquipment(e)
  }

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [])

  const equipmentFilter = params.get('equipment')
  const chemicalFilter = params.get('chemical')

  const chemicalById = useMemo(() => new Map(chemicals.map((c) => [c.id, c])), [chemicals])
  const equipmentById = useMemo(() => new Map(equipment.map((e) => [e.id, e])), [equipment])
  const chemicalNameById = useMemo(() => new Map(chemicals.map((c) => [c.id, c.name])), [chemicals])
  const chemicalIdByName = useMemo(() => new Map(chemicals.map((c) => [c.name, c.id])), [chemicals])

  const filtered = useMemo(() => {
    let rows = sops
    if (equipmentFilter) rows = rows.filter((s) => s.related_equipment_id === equipmentFilter)
    if (chemicalFilter) rows = rows.filter((s) => s.related_chemical_ids.includes(chemicalFilter))
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      rows = rows.filter((s) => s.title.toLowerCase().includes(needle) || s.body.toLowerCase().includes(needle))
    }
    return rows
  }, [sops, equipmentFilter, chemicalFilter, q])

  function startCreate() {
    setEditing(null)
    setForm(BLANK)
    setFormOpen(true)
  }

  function startEdit(sop: Sop) {
    setEditing(sop)
    setForm({
      title: sop.title,
      body: sop.body,
      related_chemical_ids: sop.related_chemical_ids,
      related_equipment_id: sop.related_equipment_id,
    })
    setFormOpen(true)
  }

  async function save() {
    if (!profile || !form.title.trim()) {
      toast.error('Give the SOP a title.')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const updated = await api.updateSop(editing, form)
        setSops((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
        toast.success('SOP updated.')
      } else {
        const created = await api.createSop(form, profile)
        setSops((prev) => [...prev, created].sort((a, b) => a.title.localeCompare(b.title)))
        toast.success('SOP created.')
      }
      setFormOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that SOP.')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    try {
      await api.deleteSop(toDelete)
      setSops((prev) => prev.filter((s) => s.id !== toDelete.id))
      toast.success('SOP deleted.')
      setToDelete(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete that SOP.')
    }
  }

  if (loading) return <LoadingScreen label="Loading SOPs…" />

  return (
    <div>
      <PageHeader
        title="SOPs & Protocols"
        description="How to safely handle a chemical, or operate a piece of equipment — one click from the record it applies to."
        actions={
          canEdit && (
            <button className="btn-primary" onClick={startCreate}>
              <Plus className="h-4 w-4" /> New SOP
            </button>
          )
        }
      />

      <div className="mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Search SOPs…" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title={sops.length === 0 ? 'No SOPs yet' : 'No SOPs match'}
          description={
            sops.length === 0
              ? canEdit
                ? 'File your first SOP — how to handle a hazardous chemical, or how to operate a piece of equipment.'
                : 'Nothing here yet — check back once someone files the first one.'
              : undefined
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((sop) => {
            const isOpen = open.has(sop.id)
            const relatedEquipment = sop.related_equipment_id ? equipmentById.get(sop.related_equipment_id) : null
            return (
              <div key={sop.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() =>
                      setOpen((prev) => {
                        const next = new Set(prev)
                        if (next.has(sop.id)) next.delete(sop.id)
                        else next.add(sop.id)
                        return next
                      })
                    }
                  >
                    <p className="font-semibold text-ink-900 dark:text-ink-50">{sop.title}</p>
                    <p className="mt-0.5 text-xs text-ink-400">
                      {relatedEquipment && `${relatedEquipment.name} · `}
                      {sop.related_chemical_ids.length > 0 &&
                        `${sop.related_chemical_ids.map((id) => chemicalNameById.get(id)).filter(Boolean).join(', ')} · `}
                      Updated {formatRelative(sop.updated_at)}
                    </p>
                    {!isOpen && <p className="mt-1.5 line-clamp-2 text-sm text-ink-500 dark:text-ink-400">{sop.body}</p>}
                  </button>
                  {(isAdmin || sop.created_by === profile?.id) && (
                    <div className="flex shrink-0 gap-1">
                      <button className="btn-ghost p-1.5" onClick={() => startEdit(sop)} title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button className="btn-ghost p-1.5 text-rose-600" onClick={() => setToDelete(sop)} title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                {isOpen && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{sop.body}</p>}
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit SOP' : 'New SOP'}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={saving} onClick={() => void save()}>
              {saving ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Save
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Title">
            <input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label="Body">
            <textarea
              className="input min-h-[160px] resize-y"
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder="Step-by-step instructions…"
            />
          </Field>
          <Field label="Related equipment">
            <select
              className="input"
              value={form.related_equipment_id ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, related_equipment_id: e.target.value || null }))}
            >
              <option value="">None</option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </Field>
          <MultiSelect
            label="Related chemicals"
            options={chemicals.map((c) => c.name)}
            selected={form.related_chemical_ids.map((id) => chemicalById.get(id)?.name).filter((n): n is string => Boolean(n))}
            onChange={(names) =>
              setForm((f) => ({
                ...f,
                related_chemical_ids: names.map((n) => chemicalIdByName.get(n)).filter((id): id is string => Boolean(id)),
              }))
            }
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete this SOP?"
        confirmLabel="Delete"
        destructive
        message={toDelete && <p>"<strong>{toDelete.title}</strong>" will be removed for everyone.</p>}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
