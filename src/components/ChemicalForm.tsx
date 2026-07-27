import { useEffect, useMemo, useState } from 'react'
import { Sparkles, TriangleAlert } from 'lucide-react'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import { hazardHint } from '../lib/hazardHints'
import * as pubchem from '../lib/pubchem'
import { HAZARDS, SIZE_UNITS, STATUSES, STATUS_LABEL, type Chemical, type ChemicalInput } from '../lib/types'
import { cx, todayISO, uniqueSorted, validateCAS } from '../lib/utils'
import { Field, Modal, Spinner } from './ui'
import { useAuth } from '../context/AuthContext'

function blank(defaults: Partial<ChemicalInput>, registeredBy: string): ChemicalInput {
  return {
    name: '',
    cas: null,
    system: null,
    supplier: null,
    catalog_no: null,
    location: null,
    sub_location: null,
    formula: null,
    mol_weight: null,
    purity: null,
    quantity: 1,
    size_value: null,
    size_unit: 'g',
    price: null,
    currency: 'SGD',
    owner: registeredBy,
    project: null,
    registration_date: todayISO(),
    opened_date: null,
    expiry_date: null,
    status: 'active',
    date_emptied: null,
    hazards: [],
    storage_class: null,
    remarks: null,
    registered_by: registeredBy,
    ...defaults,
  }
}

export function ChemicalForm({
  open,
  onClose,
  editing,
}: {
  open: boolean
  onClose: () => void
  /** Pass an existing row to edit it; omit to register a new container. */
  editing?: Chemical | null
}) {
  // Suggestions and the duplicate check draw from the vetted shelf, not
  // someone else's not-yet-approved submission.
  const { approvedChemicals: chemicals, create, update } = useInventory()
  const { profile, isAdmin } = useAuth()
  const toast = useToast()

  const [form, setForm] = useState<ChemicalInput>(() => blank({}, profile?.full_name ?? ''))
  const [busy, setBusy] = useState(false)
  const [looking, setLooking] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setErrors({})
    setForm(editing ? { ...editing } : blank({}, profile?.full_name ?? ''))
  }, [open, editing, profile])

  const locations = useMemo(() => uniqueSorted(chemicals.map((c) => c.location)), [chemicals])
  const suppliers = useMemo(() => uniqueSorted(chemicals.map((c) => c.supplier)), [chemicals])
  const systems = useMemo(() => uniqueSorted(chemicals.map((c) => c.system)), [chemicals])
  const projects = useMemo(() => uniqueSorted(chemicals.map((c) => c.project)), [chemicals])

  const casCheck = form.cas ? validateCAS(form.cas) : { ok: true }

  /** Warn about an existing bottle rather than blocking — duplicates are legal. */
  const duplicate = useMemo(() => {
    if (!form.cas && !form.name.trim()) return null
    return chemicals.find(
      (c) =>
        c.id !== editing?.id &&
        c.status !== 'empty' &&
        ((form.cas && c.cas === form.cas.trim()) ||
          (!form.cas && c.name.trim().toLowerCase() === form.name.trim().toLowerCase())),
    )
  }, [chemicals, form.cas, form.name, editing])

  const hint = useMemo(() => hazardHint(form.cas, form.name), [form.cas, form.name])
  const missingHints = hint ? hint.hazards.filter((h) => !form.hazards.includes(h)) : []

  function set<K extends keyof ChemicalInput>(key: K, value: ChemicalInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function autofill() {
    if (!form.cas && !form.name.trim()) {
      toast.info('Enter a CAS number or a name first.')
      return
    }
    setLooking(true)
    try {
      const info = await pubchem.lookup(form.cas, form.name)
      if (!info) {
        toast.info('PubChem had no match — fill the details in by hand.')
        return
      }
      setForm((f) => ({
        ...f,
        formula: info.formula ?? f.formula,
        mol_weight: info.molecularWeight ?? f.mol_weight,
      }))
      toast.success(`Filled in from PubChem (CID ${info.cid}).`)
    } catch {
      toast.error('Could not reach PubChem. Check the connection, or fill it in by hand.')
    } finally {
      setLooking(false)
    }
  }

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!form.name.trim()) next.name = 'A chemical name is required.'
    if (form.cas && !casCheck.ok) next.cas = casCheck.reason ?? 'Invalid CAS number.'
    if (form.quantity < 0) next.quantity = 'Quantity cannot be negative.'
    if (form.size_value != null && form.size_value < 0) next.size_value = 'Size cannot be negative.'
    if (form.expiry_date && form.registration_date && form.expiry_date < form.registration_date) {
      next.expiry_date = 'Expiry cannot be before the registration date.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function save() {
    if (!validate()) return
    setBusy(true)
    try {
      const payload: ChemicalInput = {
        ...form,
        name: form.name.trim(),
        cas: form.cas?.trim() || null,
        // Keep the emptied date consistent with the status, whichever way it moved.
        date_emptied:
          form.status === 'empty' ? (form.date_emptied ?? todayISO()) : null,
      }
      if (editing) {
        const row = await update(editing.id, payload)
        if (row.review_status === 'pending' && editing.review_status !== 'pending') {
          toast.info(`${row.name} updated and sent back for admin approval.`)
        } else {
          toast.success(`${row.name} updated.`)
        }
      } else {
        const row = await create(payload)
        if (row.review_status === 'pending') {
          toast.info(`${row.name} submitted as ${row.code} — an admin needs to approve it before the group sees it.`)
        } else {
          toast.success(`${row.name} registered as ${row.code}.`)
        }
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${editing.code}` : 'Register a new container'}
      description={
        editing
          ? editing.review_status !== 'approved'
            ? 'Saving sends this back to an admin for another look.'
            : 'Changes are logged with your name and the time.'
          : isAdmin
            ? 'One row per physical bottle. A PEARL code and QR label are generated for you.'
            : 'One row per physical bottle. It’ll wait for an admin to approve it before the rest of the group sees it.'
      }
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy}>
            {busy && <Spinner />}
            {editing ? 'Save changes' : 'Register container'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* -------------------------------------------------- identity */}
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">Identity</h3>

          <Field label="Chemical name" required error={errors.name}>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. 4-bromo-2-hydroxybenzaldehyde"
              autoFocus
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field
              label="CAS number"
              error={errors.cas}
              hint={form.cas && casCheck.ok ? 'Check digit verified.' : 'Format 123-45-6'}
            >
              <input
                className="input font-mono"
                value={form.cas ?? ''}
                onChange={(e) => set('cas', e.target.value)}
                placeholder="22532-62-3"
              />
            </Field>
            <div className="flex items-end">
              <button
                type="button"
                className="btn-secondary w-full sm:w-auto"
                onClick={() => void autofill()}
                disabled={looking}
                title="Look the compound up on PubChem and fill in the formula and molar mass"
              >
                {looking ? <Spinner /> : <Sparkles className="h-4 w-4" />}
                Auto-fill
              </button>
            </div>
          </div>

          {duplicate && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="leading-snug text-amber-900 dark:text-amber-200">
                The lab already holds <strong>{duplicate.name}</strong> ({duplicate.code}) in{' '}
                {duplicate.location ?? 'an unrecorded location'}. Check before ordering more — or
                carry on if this really is a second bottle.
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Molecular formula">
              <input
                className="input font-mono"
                value={form.formula ?? ''}
                onChange={(e) => set('formula', e.target.value || null)}
                placeholder="C7H5BrO2"
              />
            </Field>
            <Field label="Molar mass (g/mol)">
              <input
                className="input"
                type="number"
                step="0.01"
                value={form.mol_weight ?? ''}
                onChange={(e) => set('mol_weight', e.target.value ? Number(e.target.value) : null)}
              />
            </Field>
            <Field label="Purity / grade">
              <input
                className="input"
                value={form.purity ?? ''}
                onChange={(e) => set('purity', e.target.value || null)}
                placeholder="98%"
              />
            </Field>
          </div>
        </section>

        {/* -------------------------------------------------- amount */}
        <section className="space-y-3 border-t border-ink-200 pt-4 dark:border-ink-800">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
            Amount &amp; location
          </h3>

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Containers" error={errors.quantity}>
              <input
                className="input"
                type="number"
                min={0}
                value={form.quantity}
                onChange={(e) => set('quantity', Number(e.target.value))}
              />
            </Field>
            <Field label="Size each" error={errors.size_value}>
              <input
                className="input"
                type="number"
                step="any"
                min={0}
                value={form.size_value ?? ''}
                onChange={(e) => set('size_value', e.target.value ? Number(e.target.value) : null)}
                placeholder="25"
              />
            </Field>
            <Field label="Unit">
              <select
                className="input"
                value={form.size_unit}
                onChange={(e) => set('size_unit', e.target.value)}
              >
                {SIZE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                className="input"
                value={form.status}
                onChange={(e) => set('status', e.target.value as ChemicalInput['status'])}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Location" hint="Pick an existing shelf or type a new one.">
              <input
                className="input"
                list="pearl-locations"
                value={form.location ?? ''}
                onChange={(e) => set('location', e.target.value || null)}
                placeholder="Fridge S5"
              />
              <datalist id="pearl-locations">
                {locations.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </Field>
            <Field label="Shelf / position">
              <input
                className="input"
                value={form.sub_location ?? ''}
                onChange={(e) => set('sub_location', e.target.value || null)}
                placeholder="Second shelf, left"
              />
            </Field>
          </div>
        </section>

        {/* -------------------------------------------------- safety */}
        <section className="space-y-3 border-t border-ink-200 pt-4 dark:border-ink-800">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">Safety</h3>

          <div>
            <span className="label">GHS hazard classes</span>
            <div className="flex flex-wrap gap-1.5">
              {HAZARDS.map((h) => {
                const on = form.hazards.includes(h)
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() =>
                      set('hazards', on ? form.hazards.filter((x) => x !== h) : [...form.hazards, h])
                    }
                    className={cx(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      on
                        ? 'border-pearl-600 bg-pearl-600 text-white'
                        : 'border-ink-200 text-ink-600 hover:border-ink-300 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800',
                    )}
                  >
                    {h}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-ink-400">
              The supplier’s Safety Data Sheet is the authority — these tags are for filtering and
              segregation checks, not a substitute for it.
            </p>
          </div>

          {hint && missingHints.length > 0 && (
            <div className="rounded-lg border border-pearl-200 bg-pearl-50 p-3 text-sm dark:border-pearl-500/30 dark:bg-pearl-500/10">
              <p className="text-pearl-900 dark:text-pearl-100">
                Commonly tagged for this compound:{' '}
                <strong>{missingHints.join(', ')}</strong>
                {hint.note && <span className="block mt-1 text-xs">{hint.note}</span>}
              </p>
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-pearl-700 underline dark:text-pearl-300"
                onClick={() => {
                  set('hazards', Array.from(new Set([...form.hazards, ...hint.hazards])))
                  if (!form.storage_class) set('storage_class', hint.storageClass)
                }}
              >
                Apply these suggestions
              </button>
            </div>
          )}

          <Field label="Storage class" hint="How this must be segregated on the shelf.">
            <input
              className="input"
              value={form.storage_class ?? ''}
              onChange={(e) => set('storage_class', e.target.value || null)}
              placeholder="Flammable solvent"
            />
          </Field>
        </section>

        {/* -------------------------------------------------- provenance */}
        <section className="space-y-3 border-t border-ink-200 pt-4 dark:border-ink-800">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
            Purchase &amp; ownership
          </h3>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Supplier">
              <input
                className="input"
                list="pearl-suppliers"
                value={form.supplier ?? ''}
                onChange={(e) => set('supplier', e.target.value || null)}
              />
              <datalist id="pearl-suppliers">
                {suppliers.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="Catalogue no.">
              <input
                className="input font-mono"
                value={form.catalog_no ?? ''}
                onChange={(e) => set('catalog_no', e.target.value || null)}
              />
            </Field>
            <Field label="Purchasing system">
              <input
                className="input"
                list="pearl-systems"
                value={form.system ?? ''}
                onChange={(e) => set('system', e.target.value || null)}
                placeholder="Ariba System"
              />
              <datalist id="pearl-systems">
                {systems.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Price">
              <input
                className="input"
                type="number"
                step="0.01"
                value={form.price ?? ''}
                onChange={(e) => set('price', e.target.value ? Number(e.target.value) : null)}
              />
            </Field>
            <Field label="Currency">
              <input
                className="input"
                value={form.currency}
                onChange={(e) => set('currency', e.target.value)}
              />
            </Field>
            <Field label="Project / grant">
              <input
                className="input"
                list="pearl-projects"
                value={form.project ?? ''}
                onChange={(e) => set('project', e.target.value || null)}
              />
              <datalist id="pearl-projects">
                {projects.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Responsible person">
              <input
                className="input"
                value={form.owner ?? ''}
                onChange={(e) => set('owner', e.target.value || null)}
              />
            </Field>
            <Field label="Registered on">
              <input
                className="input"
                type="date"
                value={form.registration_date ?? ''}
                onChange={(e) => set('registration_date', e.target.value || null)}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date opened" hint="Matters for peroxide formers.">
              <input
                className="input"
                type="date"
                value={form.opened_date ?? ''}
                onChange={(e) => set('opened_date', e.target.value || null)}
              />
            </Field>
            <Field label="Expiry date" error={errors.expiry_date}>
              <input
                className="input"
                type="date"
                value={form.expiry_date ?? ''}
                onChange={(e) => set('expiry_date', e.target.value || null)}
              />
            </Field>
          </div>

          <Field label="Remarks">
            <textarea
              className="input min-h-[72px] resize-y"
              value={form.remarks ?? ''}
              onChange={(e) => set('remarks', e.target.value || null)}
              placeholder="1.0 M in toluene · nearly finished · keep under argon"
            />
          </Field>
        </section>
      </div>
    </Modal>
  )
}
