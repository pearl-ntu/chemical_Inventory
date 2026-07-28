import { Suspense, useEffect, useMemo, useState } from 'react'
import { Beaker, CheckCircle2, ExternalLink, PenTool, Search, Sparkles, TriangleAlert, X } from 'lucide-react'
import { DeliveryPhotoPanel } from './DeliveryPhotoPanel'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import { hazardHint } from '../lib/hazardHints'
import * as pubchem from '../lib/pubchem'
import { HAZARDS, SIZE_UNITS, STATUSES, STATUS_LABEL, type Chemical, type ChemicalInput } from '../lib/types'
import { cx, todayISO, uniqueSorted, validateCAS } from '../lib/utils'
import { Field, Modal, Spinner } from './ui'
import {
  LazyMolfileSvgRenderer,
  LazyReactionEditorDialog,
  LazyReactionViewer,
  LazyStructureEditorDialog,
} from './LazyStructure'
import { useAuth } from '../context/AuthContext'

/**
 * Two structures are "the same compound" if OpenChemLib's canonical idcode
 * matches — catches a real duplicate that the text-based CAS/name check
 * below would miss (different supplier listing, a salt vs. free base typed
 * differently, a typo in the name). Loaded on demand, same as the editor
 * itself, and only when there's actually a structure to compare.
 */
async function findStructuralDuplicate(
  molfile: string,
  candidates: Chemical[],
): Promise<Chemical | null> {
  if (candidates.length === 0) return null
  const mod = await import('openchemlib')
  // Interop shim: bundlers disagree on whether this ships as a default
  // export or named exports, so accept either rather than guessing once.
  const shimmed = mod as unknown as {
    Molecule?: typeof mod.Molecule
    default?: { Molecule: typeof mod.Molecule }
  }
  const Molecule = shimmed.Molecule ?? shimmed.default?.Molecule
  if (!Molecule) return null

  let targetIdcode: string
  try {
    targetIdcode = Molecule.fromMolfile(molfile).getIDCode()
  } catch {
    return null
  }
  for (const c of candidates) {
    if (!c.structure_molfile) continue
    try {
      if (Molecule.fromMolfile(c.structure_molfile).getIDCode() === targetIdcode) return c
    } catch {
      // A malformed stored molfile shouldn't block registering a new one.
    }
  }
  return null
}

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
    structure_molfile: null,
    reaction_rxnfile: null,
    delivery_photo_path: null,
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
  const { chemicals, create, update } = useInventory()
  const { profile } = useAuth()
  const toast = useToast()

  const [form, setForm] = useState<ChemicalInput>(() => blank({}, profile?.full_name ?? ''))
  const [busy, setBusy] = useState(false)
  const [looking, setLooking] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [drawOpen, setDrawOpen] = useState(false)
  const [reactionOpen, setReactionOpen] = useState(false)
  const [structuralDuplicate, setStructuralDuplicate] = useState<Chemical | null>(null)
  const [enrichedInfo, setEnrichedInfo] = useState<pubchem.PubChemInfo | null>(null)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setEnrichedInfo(null)
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

  useEffect(() => {
    let cancelled = false
    if (!form.structure_molfile) {
      setStructuralDuplicate(null)
      return
    }
    const candidates = chemicals.filter((c) => c.id !== editing?.id && c.status !== 'empty')
    void findStructuralDuplicate(form.structure_molfile, candidates).then((match) => {
      if (!cancelled) setStructuralDuplicate(match)
    })
    return () => {
      cancelled = true
    }
  }, [form.structure_molfile, chemicals, editing])

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
      const molfile =
        info.smiles && !form.structure_molfile ? await pubchem.molfileFromSmiles(info.smiles) : null
      setForm((f) => ({
        ...f,
        name: f.name.trim() || info.name || info.iupacName || f.name,
        formula: info.formula ?? f.formula,
        mol_weight: info.molecularWeight ?? f.mol_weight,
        structure_molfile: f.structure_molfile ?? molfile,
      }))
      setEnrichedInfo(info)
      toast.success(
        `Filled name, formula, molar mass${molfile ? ', and structure' : ''} from PubChem (CID ${info.cid}).`,
      )
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
        await update(editing.id, payload)
        toast.success(`${payload.name} updated.`)
      } else {
        const row = await create(payload)
        toast.success(`${row.name} registered as ${row.code}.`)
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
          ? 'Changes are logged with your name and the time.'
          : 'One row per physical bottle. A PEARL code and QR label are generated for you.'
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

          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
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
                title="Look the compound up on PubChem and fill in name, formula, molar mass, and structure"
              >
                {looking ? <Spinner /> : <Sparkles className="h-4 w-4" />}
                Auto-fill
              </button>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                className="btn-secondary w-full sm:w-auto"
                onClick={() => setDrawOpen(true)}
                title="Draw the 2D structure by hand"
              >
                <PenTool className="h-4 w-4" />
                {form.structure_molfile ? 'Edit structure' : 'Draw structure'}
              </button>
            </div>
          </div>

          {enrichedInfo && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-emerald-900 dark:text-emerald-100">
                    Verified PubChem match: {enrichedInfo.name ?? enrichedInfo.iupacName ?? `CID ${enrichedInfo.cid}`}
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-200/75">
                    CID {enrichedInfo.cid}
                    {enrichedInfo.formula && ` · ${enrichedInfo.formula}`}
                    {enrichedInfo.molecularWeight != null &&
                      ` · ${enrichedInfo.molecularWeight.toFixed(2)} g/mol`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={enrichedInfo.pageUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="btn-secondary py-1.5 text-xs"
                  >
                    PubChem <ExternalLink className="h-3 w-3" />
                  </a>
                  <a
                    href={pubchem.sdsSearchUrl(
                      enrichedInfo.name ?? form.name,
                      form.cas,
                      form.supplier,
                    )}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="btn-secondary py-1.5 text-xs"
                  >
                    SDS <ExternalLink className="h-3 w-3" />
                  </a>
                  {form.structure_molfile && (
                    <button
                      type="button"
                      className="btn-secondary py-1.5 text-xs"
                      onClick={() => setDrawOpen(true)}
                    >
                      <PenTool className="h-3 w-3" /> Review structure
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-emerald-200/70 pt-3 dark:border-emerald-400/20">
                <span className="mr-1 flex items-center gap-1 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                  <Search className="h-3.5 w-3.5" /> Supplier check
                </span>
                {pubchem.SUPPLIER_SEARCHES.map((supplier) => (
                  <a
                    key={supplier.label}
                    href={pubchem.supplierSearchUrl(
                      supplier.terms,
                      enrichedInfo.name ?? form.name,
                      form.cas,
                    )}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="rounded-full border border-emerald-300 bg-white/70 px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-white dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-100"
                  >
                    {supplier.label}
                  </a>
                ))}
              </div>
            </div>
          )}

          {form.structure_molfile && (
            <div className="flex items-center gap-3 rounded-lg border border-ink-200 bg-white p-2 dark:border-ink-700 dark:bg-ink-950">
              <div className="viz-root flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded bg-white">
                <Suspense fallback={<Spinner className="h-4 w-4 text-ink-300" />}>
                  <LazyMolfileSvgRenderer molfile={form.structure_molfile} width={110} height={75} />
                </Suspense>
              </div>
              <p className="flex-1 text-xs text-ink-500">
                Structure attached. It can come from PubChem auto-fill or your own drawing; open
                the editor if you need to adjust atoms, charges, or stereochemistry.
              </p>
              <button
                type="button"
                className="btn-ghost p-1.5 text-ink-400 hover:text-rose-600"
                onClick={() => set('structure_molfile', null)}
                title="Remove the drawn structure"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

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

          {structuralDuplicate && structuralDuplicate.id !== duplicate?.id && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="leading-snug text-amber-900 dark:text-amber-200">
                This is the same molecule (by structure) as{' '}
                <strong>{structuralDuplicate.name}</strong> ({structuralDuplicate.code}) in{' '}
                {structuralDuplicate.location ?? 'an unrecorded location'} — different name or CAS
                entry, but the drawn structure matches exactly. Worth checking it's not the same
                bottle recorded twice under two names.
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

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-ink-500">
              If this was made in-house, attach the synthesis scheme that produced it.
            </p>
            <div className="flex flex-wrap gap-2">
              {form.name.trim() && (
                <>
                  <a
                    href={pubchem.synthesisSearchUrl(form.name, form.cas)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="btn-secondary shrink-0"
                  >
                    <Search className="h-4 w-4" /> Route search
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </a>
                  <a
                    href={pubchem.scholarSynthesisSearchUrl(form.name, form.cas)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="btn-secondary shrink-0"
                  >
                    Literature
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </a>
                </>
              )}
              <button
                type="button"
                className="btn-secondary shrink-0"
                onClick={() => setReactionOpen(true)}
                title="Draw the reaction that produced this compound"
              >
                <Beaker className="h-4 w-4" />
                {form.reaction_rxnfile
                  ? 'Edit synthesis scheme'
                  : form.structure_molfile
                    ? 'Start scheme from product'
                    : 'Draw synthesis scheme'}
              </button>
            </div>
          </div>

          {form.reaction_rxnfile && (
            <div className="flex items-center gap-3 rounded-lg border border-ink-200 bg-white p-2 dark:border-ink-700 dark:bg-ink-950">
              <div className="viz-root flex h-20 w-40 shrink-0 items-center justify-center overflow-hidden rounded bg-white">
                <Suspense fallback={<Spinner className="h-4 w-4 text-ink-300" />}>
                  <LazyReactionViewer rxnfile={form.reaction_rxnfile} />
                </Suspense>
              </div>
              <p className="flex-1 text-xs text-ink-500">Synthesis scheme attached.</p>
              <button
                type="button"
                className="btn-ghost p-1.5 text-ink-400 hover:text-rose-600"
                onClick={() => set('reaction_rxnfile', null)}
                title="Remove the attached scheme"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="border-t border-ink-100 pt-4 dark:border-ink-800">
            <DeliveryPhotoPanel
              photoPath={form.delivery_photo_path}
              onPhotoChange={(path) => set('delivery_photo_path', path)}
              onApplyFields={(fields) => {
                setForm((f) => ({
                  ...f,
                  ...(fields.cas != null ? { cas: fields.cas } : {}),
                  ...(fields.quantity != null ? { quantity: fields.quantity } : {}),
                  ...(fields.size_value != null ? { size_value: fields.size_value } : {}),
                  ...(fields.size_unit != null ? { size_unit: fields.size_unit } : {}),
                  ...(fields.price != null ? { price: fields.price } : {}),
                  ...(fields.currency != null ? { currency: fields.currency } : {}),
                }))
              }}
            />
          </div>
        </section>
      </div>

      {drawOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 backdrop-blur-sm">
              <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 shadow-pop dark:bg-ink-900">
                <Spinner className="h-5 w-5 text-pearl-600" />
                <span className="text-sm text-ink-600 dark:text-ink-300">Loading the structure editor…</span>
              </div>
            </div>
          }
        >
          <LazyStructureEditorDialog
            open={drawOpen}
            onClose={() => setDrawOpen(false)}
            initialMolfile={form.structure_molfile}
            onConfirm={(structure) => {
              setForm((f) => ({
                ...f,
                structure_molfile: structure.molfile,
                formula: structure.formula,
                mol_weight: structure.molWeight,
              }))
              setDrawOpen(false)
              toast.success('Structure attached — formula and molar mass filled in from it.')
            }}
          />
        </Suspense>
      )}

      {reactionOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 backdrop-blur-sm">
              <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 shadow-pop dark:bg-ink-900">
                <Spinner className="h-5 w-5 text-pearl-600" />
                <span className="text-sm text-ink-600 dark:text-ink-300">Loading the reaction editor…</span>
              </div>
            </div>
          }
        >
          <LazyReactionEditorDialog
            open={reactionOpen}
            onClose={() => setReactionOpen(false)}
            initialRxnfile={form.reaction_rxnfile}
            initialProductMolfile={form.structure_molfile}
            onConfirm={(rxnfile) => {
              setForm((f) => ({ ...f, reaction_rxnfile: rxnfile }))
              setReactionOpen(false)
              toast.success('Synthesis scheme attached.')
            }}
          />
        </Suspense>
      )}
    </Modal>
  )
}
