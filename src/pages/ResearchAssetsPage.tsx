import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Database,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Tags,
  Trash2,
  Upload,
} from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { ConfirmDialog, Drawer, Field, LoadingScreen, Modal, SearchInput, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import {
  parseCSV,
  researchAssetTemplateCSV,
  researchAssetsToCSV,
  rowsToResearchAssets,
} from '../lib/csv'
import {
  ASSET_STATUSES,
  ASSET_TYPES,
  ASSET_VISIBILITIES,
  type ResearchAsset,
  type ResearchAssetChemicalLink,
  type ResearchAssetInput,
  type ResearchAssetType,
} from '../lib/types'
import { cx, download, formatDate, todayISO } from '../lib/utils'

const SOURCES = ['manual', 'hpc', 'github', 'zenodo', 'local-drive', 'other'] as const

interface HpcEntry {
  name: string
  path: string
  type: 'dir' | 'file'
  size_bytes: number
  modified: string
}

interface HpcFilePreview {
  name: string
  path: string
  size_bytes: number
  modified: string
  truncated: boolean
  content: string
}

function blank(owner: string): ResearchAssetInput {
  return {
    type: 'dataset',
    title: '',
    description: null,
    project: null,
    owner,
    related_chemical_id: null,
    related_chemical_name: null,
    source: 'manual',
    source_external_id: null,
    external_path: null,
    storage_link: null,
    size_bytes: null,
    size_label: null,
    format: null,
    license: null,
    checksum: null,
    version: null,
    tags: [],
    method: null,
    software: null,
    input_link: null,
    output_link: null,
    repo_link: null,
    environment: null,
    metrics: null,
    access_notes: null,
    status: 'active',
    visibility: 'lab',
    notes: null,
    last_verified_at: todayISO(),
  }
}

function parseTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function formatBytes(bytes: number | null) {
  if (bytes == null || Number.isNaN(bytes)) return null
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let unit = 0
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024
    unit += 1
  }
  return `${n >= 10 || unit === 0 ? n.toFixed(0) : n.toFixed(1)} ${units[unit]}`
}

function isWebUrl(value: string | null | undefined) {
  return Boolean(value && /^https?:\/\//i.test(value))
}

function folderPath(asset: ResearchAsset) {
  const path = asset.storage_link || asset.source_external_id || asset.external_path || asset.output_link || ''
  if (!path) return ''
  const normalized = path.replace(/\\/g, '/')
  if (!/\.[a-z0-9]{2,6}$/i.test(normalized)) return normalized
  const parts = normalized.split('/').filter(Boolean)
  return '/' + parts.slice(0, -1).join('/')
}

function accountFor(asset: ResearchAsset) {
  return asset.environment || asset.access_notes?.match(/Imported via ([^.]+)/)?.[1] || 'HPC account not recorded'
}

async function copyText(value: string, toast: ReturnType<typeof useToast>) {
  await navigator.clipboard.writeText(value)
  toast.success('Path copied.')
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 180) || 'hpc-file.txt'
}

function parentPath(path: string, floor: string) {
  const clean = path.replace(/\/+$/, '')
  const base = floor.replace(/\/+$/, '')
  if (!clean || clean === base) return base
  const parts = clean.split('/').filter(Boolean)
  if (parts.length <= 1) return base || clean
  const parent = '/' + parts.slice(0, -1).join('/')
  return parent.startsWith(base) ? parent : base
}

function assetTypeForFile(fileName: string): ResearchAssetInput['type'] {
  const ext = fileName.toLowerCase().split('.').pop()
  if (ext === 'ipynb') return 'notebook'
  if (['py', 'm', 'r', 'jl', 'sh', 'pbs', 'slurm', 'sbatch'].includes(ext ?? '')) return 'code'
  if (['csv', 'tsv', 'xlsx', 'xls', 'json', 'h5', 'hdf5'].includes(ext ?? '')) return 'dataset'
  return 'other'
}

function storedAgent() {
  try {
    return {
      url: localStorage.getItem('pearl.hpc.agent_url') || 'http://127.0.0.1:8788',
      token: localStorage.getItem('pearl.hpc.agent_token') || '',
    }
  } catch {
    return { url: 'http://127.0.0.1:8788', token: '' }
  }
}

async function hpcPost<T>(path: string, body: unknown): Promise<T> {
  const { url, token } = storedAgent()
  const res = await fetch(`${url.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'HPC agent request failed')
  return data as T
}

export default function ResearchAssetsPage() {
  const { profile, canEdit } = useAuth()
  const { chemicals } = useInventory()
  const toast = useToast()
  const codeInputRef = useRef<HTMLInputElement>(null)
  const [assets, setAssets] = useState<ResearchAsset[]>([])
  const [links, setLinks] = useState<ResearchAssetChemicalLink[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [type, setType] = useState<ResearchAssetType | 'all'>('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ResearchAsset | null>(null)
  const [detail, setDetail] = useState<ResearchAsset | null>(null)
  const [folderDetail, setFolderDetail] = useState<{
    account: string
    path: string
    folderName: string
    rows: ResearchAsset[]
    size: number
    status: ResearchAsset['status']
  } | null>(null)
  const [browserPath, setBrowserPath] = useState('')
  const [browserEntries, setBrowserEntries] = useState<HpcEntry[]>([])
  const [browserLoading, setBrowserLoading] = useState(false)
  const [browserError, setBrowserError] = useState<string | null>(null)
  const [browserRefresh, setBrowserRefresh] = useState(0)
  const [filePreview, setFilePreview] = useState<HpcFilePreview | null>(null)
  const [form, setForm] = useState<ResearchAssetInput>(() => blank(profile?.full_name ?? ''))
  const [selectedChemicalIds, setSelectedChemicalIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<ResearchAsset | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [assetRows, linkRows] = await Promise.all([
        api.listResearchAssets(),
        api.listResearchAssetChemicalLinks(),
      ])
      setAssets(assetRows)
      setLinks(linkRows)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load research assets.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!folderDetail) return
    setBrowserPath(folderDetail.path)
    setFilePreview(null)
  }, [folderDetail])

  useEffect(() => {
    if (!folderDetail || !browserPath) return
    setBrowserLoading(true)
    setBrowserError(null)
    hpcPost<{ entries: HpcEntry[] }>('/list', { path: browserPath })
      .then((data) => setBrowserEntries(data.entries ?? []))
      .catch((err) => {
        setBrowserEntries([])
        setBrowserError(err instanceof Error ? err.message : 'Could not list folder.')
      })
      .finally(() => setBrowserLoading(false))
  }, [browserPath, browserRefresh, folderDetail])

  const linkedNames = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const link of links) {
      const name =
        link.chemical_name ?? chemicals.find((chemical) => chemical.id === link.chemical_id)?.name
      if (!name) continue
      map.set(link.research_asset_id, [...(map.get(link.research_asset_id) ?? []), name])
    }
    for (const asset of assets) {
      if (asset.related_chemical_name) {
        map.set(asset.id, [...(map.get(asset.id) ?? []), asset.related_chemical_name])
      }
    }
    return map
  }, [assets, chemicals, links])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return assets.filter((asset) => {
      if (type !== 'all' && asset.type !== type) return false
      if (!needle) return true
      return [
        asset.title,
        asset.description,
        asset.project,
        asset.owner,
        asset.type,
        asset.source,
        asset.method,
        asset.software,
        asset.format,
        asset.visibility,
        asset.notes,
        ...(asset.tags ?? []),
        ...(linkedNames.get(asset.id) ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [assets, linkedNames, q, type])

  const hpcGroups = useMemo(() => {
    const groups = new Map<string, ResearchAsset[]>()
    for (const asset of shown.filter((row) => row.source === 'hpc')) {
      const key = `${accountFor(asset)}||${folderPath(asset) || asset.id}`
      groups.set(key, [...(groups.get(key) ?? []), asset])
    }
    return [...groups.entries()].map(([key, rows]) => {
      const [account, path] = key.split('||')
      const folderName = path.split('/').filter(Boolean).pop() || rows[0]?.title || 'HPC folder'
      const size = rows.reduce((sum, row) => sum + (row.size_bytes ?? 0), 0)
      const status = rows.some((row) => row.status === 'failed')
        ? 'failed'
        : rows.some((row) => row.status === 'running')
          ? 'running'
          : rows.some((row) => row.status === 'complete')
            ? 'complete'
            : rows[0]?.status ?? 'active'
      return { key, account, path, folderName, rows, size, status }
    }).sort((a, b) => a.path.localeCompare(b.path))
  }, [shown])

  const nonHpcShown = useMemo(() => shown.filter((row) => row.source !== 'hpc'), [shown])

  function startAdd() {
    setEditing(null)
    setForm(blank(profile?.full_name ?? ''))
    setSelectedChemicalIds([])
    setOpen(true)
  }

  function startEdit(asset: ResearchAsset) {
    setEditing(asset)
    const { id: _id, created_at: _ca, updated_at: _ua, created_by: _cb, created_by_name: _cn, ...input } = asset
    input.description = input.description ?? null
    input.size_bytes = input.size_bytes ?? null
    input.tags = input.tags ?? []
    setForm(input)
    setSelectedChemicalIds([
      ...new Set([
        ...(asset.related_chemical_id ? [asset.related_chemical_id] : []),
        ...links.filter((link) => link.research_asset_id === asset.id).map((link) => link.chemical_id),
      ]),
    ])
    setOpen(true)
  }

  async function save() {
    if (!profile) return
    if (!form.title.trim()) return toast.error('Give the asset a title.')
    setBusy(true)
    try {
      const firstChemical = chemicals.find((chemical) => chemical.id === selectedChemicalIds[0])
      const payload: ResearchAssetInput = {
        ...form,
        title: form.title.trim(),
        description: form.description?.trim() || null,
        related_chemical_id: firstChemical?.id ?? null,
        related_chemical_name: firstChemical?.name ?? null,
        tags: form.tags ?? [],
      }
      const row = editing
        ? await api.updateResearchAsset(editing.id, payload, profile)
        : await api.createResearchAsset(payload, profile)
      await api.setResearchAssetChemicals(row.id, selectedChemicalIds)
      await load()
      setOpen(false)
      toast.success(editing ? 'Research asset updated.' : 'Research asset added.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save research asset.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: ResearchAsset) {
    if (!profile) return
    setBusy(true)
    try {
      await api.deleteResearchAsset(row, profile)
      setAssets((prev) => prev.filter((asset) => asset.id !== row.id))
      setLinks((prev) => prev.filter((link) => link.research_asset_id !== row.id))
      setConfirmDelete(null)
      toast.success('Research asset deleted.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete research asset.')
    } finally {
      setBusy(false)
    }
  }

  function toggleChemical(id: string) {
    setSelectedChemicalIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    )
  }

  async function importCSV(file: File | null) {
    if (!file || !profile) return
    try {
      const parsed = rowsToResearchAssets(parseCSV(await file.text()), profile.full_name)
      if (parsed.rows.length === 0) {
        toast.error(parsed.errors[0]?.message ?? 'No rows found.')
        return
      }
      setBusy(true)
      for (const row of parsed.rows) await api.createResearchAsset(row, profile)
      await load()
      toast.success(`Imported ${parsed.rows.length} research assets.`)
      if (parsed.errors.length) toast.info(`${parsed.errors.length} rows were skipped.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not import research assets.')
    } finally {
      setBusy(false)
    }
  }

  async function importCodeFiles(files: FileList | null) {
    if (!files || !profile) return
    const selected = Array.from(files)
    if (selected.length === 0) return
    setBusy(true)
    try {
      for (const file of selected) {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
        const isTextish = /\.(py|m|r|jl|sh|txt|md|json|yaml|yml|inp|com|gjf|pbs|slurm|sbatch)$/i.test(file.name)
        const content = isTextish && file.size <= 200_000 ? await file.text() : ''
        const notes = [
          'Uploaded from local computer as a PEARL code/data asset.',
          `Original filename: ${file.name}`,
          content ? `\n--- file preview ---\n${content.slice(0, 80_000)}` : 'File content not stored because it is large or binary-like.',
        ].join('\n')
        await api.createResearchAsset({
          ...blank(profile.full_name),
          type: assetTypeForFile(file.name),
          title: file.name,
          description: 'Local file uploaded/indexed for computational research.',
          source: 'local-drive',
          size_bytes: file.size,
          size_label: formatBytes(file.size),
          format: ext || null,
          tags: ['uploaded-file', ext].filter(Boolean),
          status: 'active',
          visibility: 'private',
          notes,
          last_verified_at: todayISO(),
        }, profile)
      }
      await load()
      toast.success(`Added ${selected.length} code/data asset${selected.length === 1 ? '' : 's'}.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add uploaded files.')
    } finally {
      setBusy(false)
      if (codeInputRef.current) codeInputRef.current.value = ''
    }
  }

  if (loading) return <LoadingScreen label="Loading research assets..." />

  return (
    <>
      <PageHeader
        title="Research Assets"
        description="Datasets, models, simulations, code, notebooks, compute resources, and the chemicals they connect to."
        actions={
          <>
            <button
              className="btn-secondary px-2.5 py-2"
              title="Export visible research assets as CSV"
              onClick={() => download(`pearl-research-assets-${todayISO()}.csv`, researchAssetsToCSV(assets), 'text/csv;charset=utf-8')}
            >
              <Download className="h-4 w-4" /> <span className="hidden sm:inline">Export</span>
            </button>
            <button
              className="btn-secondary px-2.5 py-2"
              title="Download CSV template"
              onClick={() => download('pearl-research-assets-template.csv', researchAssetTemplateCSV(), 'text/csv;charset=utf-8')}
            >
              <FileDown className="h-4 w-4" /> <span className="hidden sm:inline">Template</span>
            </button>
            {canEdit && (
              <>
                <label className="btn-secondary cursor-pointer px-2.5 py-2" title="Import research asset metadata from CSV">
                  <Upload className="h-4 w-4" /> <span className="hidden sm:inline">CSV</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      void importCSV(e.target.files?.[0] ?? null)
                      e.currentTarget.value = ''
                    }}
                  />
                </label>
                <label className="btn-secondary cursor-pointer px-2.5 py-2" title="Add Python, MATLAB, notebook, script or data file as a PEARL asset">
                  <FileText className="h-4 w-4" /> <span className="hidden sm:inline">Code/file</span>
                  <input
                    ref={codeInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => void importCodeFiles(e.target.files)}
                  />
                </label>
                <button className="btn-primary px-2.5 py-2" onClick={startAdd} title="Add research asset manually">
                  <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Add</span>
                </button>
              </>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <SearchInput value={q} onChange={setQ} placeholder="Search assets, projects, software, tags, chemicals..." />
        <div className="flex items-center gap-2 overflow-x-auto">
          <Filter className="hidden h-4 w-4 text-ink-400 sm:block" />
          {(['all', ...ASSET_TYPES] as Array<typeof type>).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              className={cx(
                'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                type === value
                  ? 'bg-pearl-600 text-white'
                  : 'bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300',
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-5">
        {ASSET_TYPES.slice(0, 5).map((assetType) => (
          <button
            key={assetType}
            type="button"
            onClick={() => setType(assetType)}
            className="card px-4 py-3 text-left transition-colors hover:border-pearl-300 hover:bg-pearl-50/50 dark:hover:border-pearl-700 dark:hover:bg-pearl-500/5"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{assetType}</p>
            <p className="mt-1 text-2xl font-bold text-ink-900 dark:text-ink-50">
              {assets.filter((asset) => asset.type === assetType).length}
            </p>
          </button>
        ))}
      </div>

      <div className="grid gap-3">
        {shown.length === 0 ? (
          <div className="card p-10 text-center">
            <Database className="mx-auto h-8 w-8 text-ink-300" />
            <p className="mt-3 text-sm text-ink-500">No research assets match this view.</p>
          </div>
        ) : (
          <>
            {hpcGroups.map((group) => (
              <article
                key={group.key}
                className="card cursor-pointer p-4 transition-colors hover:border-pearl-300 hover:bg-pearl-50/40 dark:hover:border-pearl-700 dark:hover:bg-pearl-500/5"
                onClick={() => setFolderDetail(group)}
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge bg-pearl-50 text-pearl-700 ring-pearl-600/20 dark:bg-pearl-500/10 dark:text-pearl-300">
                        <Folder className="h-3 w-3" /> HPC folder
                      </span>
                      <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">
                        {group.status}
                      </span>
                      <span className="badge bg-amber-50 text-amber-700 ring-ink-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                        Private to me
                      </span>
                    </div>
                    <h2 className="mt-2 text-base font-semibold text-ink-900 dark:text-ink-50">{group.folderName}</h2>
                    <p className="mt-1 text-sm text-ink-500">{group.account}</p>
                    <p className="mt-2 break-all font-mono text-xs text-ink-500">{group.path}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {[...new Set(group.rows.map((row) => row.software).filter(Boolean))].map((software) => (
                        <span key={software} className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">{software}</span>
                      ))}
                      <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">
                        {group.rows.length} record{group.rows.length === 1 ? '' : 's'}
                      </span>
                      {group.size > 0 && (
                        <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">
                          {formatBytes(group.size)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.path && <PointerButton label="Folder" value={group.path} toast={toast} />}
                    <button
                      className="btn-primary py-1.5 text-xs"
                      onClick={(event) => {
                        event.stopPropagation()
                        setFolderDetail(group)
                      }}
                    >
                      <FolderOpen className="h-3.5 w-3.5" /> Explore
                    </button>
                  </div>
                </div>
              </article>
            ))}

            {nonHpcShown.map((asset) => {
            const names = [...new Set(linkedNames.get(asset.id) ?? [])]
            return (
              <article
                key={asset.id}
                className="card cursor-pointer p-4 transition-colors hover:border-pearl-300 hover:bg-pearl-50/40 dark:hover:border-pearl-700 dark:hover:bg-pearl-500/5"
                onClick={() => setDetail(asset)}
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge bg-pearl-50 text-pearl-700 ring-pearl-600/20 dark:bg-pearl-500/10 dark:text-pearl-300">
                        {asset.type}
                      </span>
                      <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">
                        {asset.status}
                      </span>
                      {asset.source && (
                        <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">
                          {asset.source}
                        </span>
                      )}
                      <span className={cx(
                        'badge ring-ink-500/20',
                        asset.visibility === 'private'
                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
                          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200',
                      )}>
                        {asset.visibility === 'private' ? 'Private to me' : 'Lab shared'}
                      </span>
                    </div>
                    <h2 className="mt-2 text-base font-semibold text-ink-900 dark:text-ink-50">{asset.title}</h2>
                    <p className="mt-1 text-sm text-ink-500">
                      {[asset.project, asset.owner, asset.software, asset.method].filter(Boolean).join(' - ') ||
                        'No project metadata yet'}
                    </p>
                    {asset.description && (
                      <p className="mt-2 max-w-4xl text-sm text-ink-700 dark:text-ink-300">{asset.description}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {asset.storage_link && <PointerButton label="Storage" value={asset.storage_link} toast={toast} />}
                    {asset.repo_link && (
                      <a href={asset.repo_link} target="_blank" rel="noreferrer noopener" className="btn-secondary py-1.5 text-xs">
                        Repo <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {asset.output_link && <PointerButton label="Output" value={asset.output_link} toast={toast} />}
                    {canEdit && (
                      <>
                        <button className="btn-secondary py-1.5 text-xs" onClick={(e) => { e.stopPropagation(); startEdit(asset) }}>
                          Edit
                        </button>
                        <button className="btn-ghost py-1.5 text-xs text-rose-600" onClick={(e) => { e.stopPropagation(); setConfirmDelete(asset) }}>
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  {(asset.size_label || formatBytes(asset.size_bytes)) && (
                    <span>{asset.size_label ?? formatBytes(asset.size_bytes)}</span>
                  )}
                  {asset.format && <span>{asset.format}</span>}
                  {asset.version && <span>v{asset.version}</span>}
                  {asset.last_verified_at && <span>verified {formatDate(asset.last_verified_at)}</span>}
                </div>

                {(asset.tags?.length > 0 || names.length > 0) && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {names.map((name) => (
                      <span key={name} className="badge bg-pearl-50 text-pearl-700 ring-pearl-600/20 dark:bg-pearl-500/10 dark:text-pearl-300">
                        <Link2 className="h-3 w-3" /> {name}
                      </span>
                    ))}
                    {asset.tags?.map((tag) => (
                      <span key={tag} className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">
                        <Tags className="h-3 w-3" /> {tag}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            )
          })}
          </>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit research asset' : 'Add research asset'}
        size="lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={() => void save()} disabled={busy}>
              {busy && <Spinner />} Save asset
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Type">
              <select className="input" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ResearchAssetInput['type'] }))}>
                {ASSET_TYPES.map((assetType) => <option key={assetType} value={assetType}>{assetType}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="input" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ResearchAssetInput['status'] }))}>
                {ASSET_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </Field>
            <Field label="Source">
              <select className="input" value={form.source ?? 'manual'} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}>
                {SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
            </Field>
            <Field label="Last verified">
              <input className="input" type="date" value={form.last_verified_at ?? ''} onChange={(e) => setForm((f) => ({ ...f, last_verified_at: e.target.value || null }))} />
            </Field>
          </div>

          <Field label="Visibility">
            <select className="input" value={form.visibility ?? 'lab'} onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value as ResearchAssetInput['visibility'] }))}>
              {ASSET_VISIBILITIES.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {visibility === 'private' ? 'Private to me' : 'Lab shared'}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Title" required>
            <input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label="Description">
            <textarea className="input min-h-[80px]" value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value || null }))} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Project"><input className="input" value={form.project ?? ''} onChange={(e) => setForm((f) => ({ ...f, project: e.target.value || null }))} /></Field>
            <Field label="Owner"><input className="input" value={form.owner ?? ''} onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value || null }))} /></Field>
            <Field label="Tags" hint="Comma-separated">
              <input className="input" value={(form.tags ?? []).join(', ')} onChange={(e) => setForm((f) => ({ ...f, tags: parseTags(e.target.value) }))} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Method"><input className="input" value={form.method ?? ''} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value || null }))} placeholder="DFT, MD, ML..." /></Field>
            <Field label="Software"><input className="input" value={form.software ?? ''} onChange={(e) => setForm((f) => ({ ...f, software: e.target.value || null }))} placeholder="ORCA, VASP, Python..." /></Field>
            <Field label="Format"><input className="input" value={form.format ?? ''} onChange={(e) => setForm((f) => ({ ...f, format: e.target.value || null }))} placeholder="csv, h5, chk..." /></Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Size label"><input className="input" value={form.size_label ?? ''} onChange={(e) => setForm((f) => ({ ...f, size_label: e.target.value || null }))} placeholder="2.4 GB" /></Field>
            <Field label="Size bytes"><input className="input" type="number" min="0" value={form.size_bytes ?? ''} onChange={(e) => setForm((f) => ({ ...f, size_bytes: e.target.value ? Number(e.target.value) : null }))} /></Field>
            <Field label="Version / checksum"><input className="input" value={form.version ?? ''} onChange={(e) => setForm((f) => ({ ...f, version: e.target.value || null }))} /></Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Storage link"><input className="input" value={form.storage_link ?? ''} onChange={(e) => setForm((f) => ({ ...f, storage_link: e.target.value || null }))} /></Field>
            <Field label="Repo link"><input className="input" value={form.repo_link ?? ''} onChange={(e) => setForm((f) => ({ ...f, repo_link: e.target.value || null }))} /></Field>
            <Field label="Output link"><input className="input" value={form.output_link ?? ''} onChange={(e) => setForm((f) => ({ ...f, output_link: e.target.value || null }))} /></Field>
          </div>

          <Field label="Related chemicals">
            <div className="max-h-44 overflow-auto rounded-lg border border-ink-200 p-2 dark:border-ink-700">
              {chemicals.length === 0 ? (
                <p className="p-2 text-xs text-ink-400">No chemicals loaded yet.</p>
              ) : (
                chemicals.slice(0, 250).map((chemical) => (
                  <label key={chemical.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-ink-50 dark:hover:bg-ink-800">
                    <input
                      type="checkbox"
                      checked={selectedChemicalIds.includes(chemical.id)}
                      onChange={() => toggleChemical(chemical.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{chemical.name}</span>
                    {chemical.cas && <span className="shrink-0 font-mono text-xs text-ink-400">{chemical.cas}</span>}
                  </label>
                ))
              )}
            </div>
          </Field>

          <Field label="Notes"><textarea className="input min-h-[80px]" value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))} /></Field>
        </div>
      </Modal>

      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.title ?? 'Research asset'}
        footer={
          detail && canEdit ? (
            <>
              <button
                className="btn-secondary"
                onClick={() => {
                  startEdit(detail)
                  setDetail(null)
                }}
              >
                Edit
              </button>
              <button
                className="btn-ghost ml-auto text-rose-600"
                onClick={() => {
                  setConfirmDelete(detail)
                  setDetail(null)
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </>
          ) : null
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="badge bg-pearl-50 text-pearl-700 ring-pearl-600/20 dark:bg-pearl-500/10 dark:text-pearl-300">{detail.type}</span>
              <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">{detail.status}</span>
              {detail.source && <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">{detail.source}</span>}
              <span className={cx(
                'badge ring-ink-500/20',
                detail.visibility === 'private'
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200',
              )}>
                {detail.visibility === 'private' ? 'Private to me' : 'Lab shared'}
              </span>
            </div>

            <section className="card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">Summary</h3>
              <p className="mt-2 text-sm text-ink-700 dark:text-ink-300">{detail.description || detail.notes || 'No description yet.'}</p>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <Meta label="Project" value={detail.project} />
                <Meta label="Owner" value={detail.owner} />
                <Meta label="Software" value={detail.software} />
                <Meta label="Method" value={detail.method} />
                <Meta label="Format" value={detail.format} />
                <Meta label="Size" value={detail.size_label ?? formatBytes(detail.size_bytes)} />
                <Meta label="NSCC path" value={detail.external_path} />
                <Meta label="Version" value={detail.version} />
                <Meta label="Last verified" value={detail.last_verified_at ? formatDate(detail.last_verified_at) : null} />
              </dl>
            </section>

            {(linkedNames.get(detail.id)?.length ?? 0) > 0 && (
              <section className="card p-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Linked chemicals</h3>
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set(linkedNames.get(detail.id) ?? [])].map((name) => (
                    <span key={name} className="badge bg-pearl-50 text-pearl-700 ring-pearl-600/20 dark:bg-pearl-500/10 dark:text-pearl-300">
                      <Link2 className="h-3 w-3" /> {name}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {detail.tags?.length > 0 && (
              <section className="card p-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Tags</h3>
                <div className="flex flex-wrap gap-1.5">
                  {detail.tags.map((tag) => (
                    <span key={tag} className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">
                      <Tags className="h-3 w-3" /> {tag}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section className="card p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">External pointers</h3>
              <div className="flex flex-wrap gap-2">
                {([
                  ['Storage', detail.storage_link],
                  ['Repo', detail.repo_link],
                  ['Input', detail.input_link],
                  ['Output', detail.output_link],
                ] as Array<[string, string | null]>).map(([label, href]) => href ? <PointerButton key={label} label={label} value={href} toast={toast} /> : null)}
                {!detail.storage_link && !detail.repo_link && !detail.input_link && !detail.output_link && (
                  <p className="text-sm text-ink-500">No external links recorded.</p>
                )}
              </div>
            </section>
          </div>
        )}
      </Drawer>

      <Drawer
        open={Boolean(folderDetail)}
        onClose={() => setFolderDetail(null)}
        title={folderDetail?.folderName ?? 'HPC folder'}
        footer={
          folderDetail ? (
            <>
              <button className="btn-secondary" onClick={() => void copyText(folderDetail.path, toast)}>
                Copy folder path
              </button>
              {folderDetail.rows[0] && (
                <button
                  className="btn-primary ml-auto"
                  onClick={() => {
                    setDetail(folderDetail.rows[0])
                    setFolderDetail(null)
                  }}
                >
                  Open asset record
                </button>
              )}
            </>
          ) : null
        }
      >
        {folderDetail && (
          <div className="space-y-4">
            <section className="card p-4">
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-pearl-50 p-2 text-pearl-700 dark:bg-pearl-500/10 dark:text-pearl-300">
                  <FolderOpen className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{folderDetail.folderName}</h3>
                  <p className="mt-1 text-xs text-ink-500">{folderDetail.account}</p>
                  <p className="mt-2 break-all font-mono text-xs text-ink-500">{folderDetail.path}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">{folderDetail.status}</span>
                    {folderDetail.size > 0 && <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">{formatBytes(folderDetail.size)}</span>}
                    <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">{folderDetail.rows.length} record{folderDetail.rows.length === 1 ? '' : 's'}</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">Live NSCC browser</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-secondary py-1.5 text-xs"
                    onClick={() => {
                      setBrowserPath(parentPath(browserPath, folderDetail.path))
                      setFilePreview(null)
                    }}
                    disabled={browserPath.replace(/\/+$/, '') === folderDetail.path.replace(/\/+$/, '')}
                    title="Go up one folder"
                  >
                    <ArrowUp className="h-3.5 w-3.5" /> Up
                  </button>
                  <button className="btn-secondary py-1.5 text-xs" onClick={() => { setBrowserPath(folderDetail.path); setFilePreview(null) }} title="Return to scanned folder root">
                    <Folder className="h-3.5 w-3.5" /> Root
                  </button>
                  <button className="btn-secondary py-1.5 text-xs" onClick={() => setBrowserRefresh((value) => value + 1)} title="Refresh folder">
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                  </button>
                  <button className="btn-secondary py-1.5 text-xs" onClick={() => void copyText(browserPath, toast)}>
                    Copy path
                  </button>
                </div>
              </div>
              <p className="mb-3 break-all font-mono text-xs text-ink-500">{browserPath}</p>
              {browserError && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                  {browserError}
                </div>
              )}
              {browserLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-ink-500"><Spinner /> Loading folder...</div>
              ) : (
                <div className="max-h-80 overflow-auto rounded-lg border border-ink-200 dark:border-ink-800">
                  {browserEntries.length === 0 ? (
                    <p className="p-3 text-sm text-ink-500">No files loaded from the agent.</p>
                  ) : (
                    browserEntries.map((entry) => (
                      <button
                        key={entry.path}
                        type="button"
                        className="flex w-full items-center gap-3 border-b border-ink-100 px-3 py-2 text-left last:border-b-0 hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-800/50"
                        onClick={async () => {
                          if (entry.type === 'dir') {
                            setBrowserPath(entry.path)
                            setFilePreview(null)
                            return
                          }
                          try {
                            const data = await hpcPost<HpcFilePreview>('/file', { path: entry.path })
                            setFilePreview(data)
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : 'Could not open file.')
                          }
                        }}
                      >
                        {entry.type === 'dir' ? <Folder className="h-4 w-4 shrink-0 text-pearl-600" /> : <FileText className="h-4 w-4 shrink-0 text-ink-400" />}
                        <span className="min-w-0 flex-1 truncate text-sm text-ink-800 dark:text-ink-100">{entry.name}</span>
                        <span className="shrink-0 text-xs text-ink-400">{entry.type === 'file' ? formatBytes(entry.size_bytes) : 'folder'}</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {filePreview && (
                <div className="mt-4 overflow-hidden rounded-lg border border-ink-200 dark:border-ink-800">
                  <div className="flex items-center justify-between gap-2 border-b border-ink-200 bg-ink-50 px-3 py-2 dark:border-ink-800 dark:bg-ink-950">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">{filePreview.name}</p>
                      <p className="truncate font-mono text-xs text-ink-500">{filePreview.path}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button className="btn-secondary py-1.5 text-xs" onClick={() => void copyText(filePreview.path, toast)}>
                        Copy path
                      </button>
                      <button className="btn-secondary py-1.5 text-xs" onClick={() => void copyText(filePreview.content, toast)}>
                        Copy text
                      </button>
                      <button
                        className="btn-secondary py-1.5 text-xs"
                        onClick={() => download(safeFileName(filePreview.name), filePreview.content, 'text/plain;charset=utf-8')}
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </button>
                    </div>
                  </div>
                  {filePreview.truncated && (
                    <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                      Large file preview: showing the tail of the file.
                    </p>
                  )}
                  <pre className="max-h-96 overflow-auto bg-ink-950 p-3 text-xs leading-relaxed text-ink-50">
                    {filePreview.content}
                  </pre>
                </div>
              )}

              <div className="mt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Imported summaries</h3>
                <div className="space-y-2">
                  {folderDetail.rows.map((row) => (
                    <div
                      key={row.id}
                      className="rounded-lg border border-ink-200 p-3 dark:border-ink-800"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => {
                            setDetail(row)
                            setFolderDetail(null)
                          }}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-ink-900 dark:text-ink-50">{row.title}</span>
                            {row.software && <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">{row.software}</span>}
                            <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">{row.status}</span>
                          </div>
                          {row.output_link && <p className="mt-2 break-all font-mono text-xs text-ink-500">{row.output_link}</p>}
                        </button>
                        {canEdit && (
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn-secondary py-1.5 text-xs"
                              title="Edit or relabel this PEARL record. NSCC files are not touched."
                              onClick={() => {
                                startEdit(row)
                                setFolderDetail(null)
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" /> Move/edit
                            </button>
                            <button
                              type="button"
                              className="btn-ghost py-1.5 text-xs text-rose-600"
                              title="Delete PEARL metadata only. NSCC files are not touched."
                              onClick={() => {
                                setConfirmDelete(row)
                                setFolderDetail(null)
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete record
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete PEARL record?"
        destructive
        confirmLabel="Delete record"
        busy={busy}
        message={<p>{confirmDelete?.title} will be removed from PEARL only. NSCC/HPC files and folders are not deleted or changed.</p>}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
      />
    </>
  )
}

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="mt-0.5 break-words text-ink-800 dark:text-ink-100">{value || '-'}</dd>
    </div>
  )
}

function PointerButton({
  label,
  value,
  toast,
}: {
  label: string
  value: string
  toast: ReturnType<typeof useToast>
}) {
  if (isWebUrl(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer noopener" className="btn-secondary py-1.5 text-xs">
        {label} <ExternalLink className="h-3 w-3" />
      </a>
    )
  }
  return (
    <button
      type="button"
      className="btn-secondary max-w-[18rem] py-1.5 text-xs"
      title={value}
      onClick={(event) => {
        event.stopPropagation()
        void copyText(value, toast)
      }}
    >
      {label} path
    </button>
  )
}
