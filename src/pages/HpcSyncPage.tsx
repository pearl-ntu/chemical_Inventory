import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CheckCircle2,
  Clipboard,
  Database,
  Download,
  FileText,
  Server,
  TerminalSquare,
  Upload,
} from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import type { ResearchAssetInput } from '../lib/types'
import { download, todayISO } from '../lib/utils'
import agentSource from '../../tools/pearl_hpc_agent.py?raw'

interface ManifestJob {
  title?: string
  name?: string
  project?: string
  owner?: string
  path?: string
  software?: string
  method?: string
  status?: string
  size_bytes?: number
  size_label?: string
  tags?: string[] | string
  molecule?: string
  formula?: string
  input_file?: string
  output_file?: string
  final_energy?: string | number
  warnings?: string[] | string
  notes?: string
  last_modified?: string
  account?: string
}

interface AgentRunResult {
  code: number
  stdout: string
  stderr: string
  cwd: string
}

interface TerminalLine {
  kind: 'input' | 'output' | 'error' | 'system'
  text: string
}

function statusFor(value?: string): ResearchAssetInput['status'] {
  const text = (value ?? '').toLowerCase()
  if (text.includes('fail') || text.includes('error')) return 'failed'
  if (text.includes('run') || text.includes('queue')) return 'running'
  if (text.includes('complete') || text.includes('done') || text.includes('normal')) return 'complete'
  if (text.includes('archive')) return 'archived'
  return 'active'
}

function tagsFor(value: ManifestJob['tags'], software?: string | null) {
  const base = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[;,]/)
      : []
  return [...new Set([...base.map((tag) => tag.trim()).filter(Boolean), 'hpc-sync', software?.toLowerCase()].filter(Boolean) as string[])]
}

function folderFor(path?: string | null) {
  if (!path) return null
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 1) return normalized
  return '/' + parts.slice(0, -1).join('/')
}

function projectFor(job: ManifestJob) {
  if (job.project) return job.project
  const folder = folderFor(job.path || job.output_file)
  if (!folder) return null
  const parts = folder.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? null
}

function fileName(path?: string | null) {
  if (!path) return null
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function aggregateJobsByFolder(jobs: ManifestJob[], account?: string): ManifestJob[] {
  const map = new Map<string, ManifestJob[]>()
  for (const job of jobs) {
    const path = job.path || job.output_file
    const folder = folderFor(path) || path || 'HPC calculation folder'
    map.set(folder, [...(map.get(folder) ?? []), job])
  }
  return [...map.entries()].map(([folder, rows]) => {
    const representative =
      rows.find((row) => !fileName(row.output_file || row.path)?.toLowerCase().includes('_iter')) ??
      rows[rows.length - 1]
    const statuses = rows.map((row) => statusFor(row.status))
    const status = statuses.includes('failed') ? 'failed' : statuses.includes('complete') ? 'complete' : 'running'
    const files = rows.map((row) => fileName(row.output_file || row.path)).filter(Boolean)
    const warnings = [...new Set(rows.flatMap((row) => Array.isArray(row.warnings) ? row.warnings : row.warnings ? [row.warnings] : []))]
    const energies = rows.map((row) => row.final_energy).filter((value) => value != null && value !== '')
    const sizeBytes = rows.reduce((sum, row) => sum + (Number(row.size_bytes) || 0), 0)
    return {
      ...representative,
      title: folder.split('/').filter(Boolean).pop() || representative.title || 'HPC calculation folder',
      project: folder.split('/').filter(Boolean).pop() || representative.project,
      path: folder,
      output_file: representative.output_file || representative.path,
      status,
      size_bytes: sizeBytes || representative.size_bytes,
      size_label: sizeBytes ? `${sizeBytes} bytes` : representative.size_label,
      account: representative.account || account,
      warnings,
      notes: [
        'Folder/system summary imported by PEARL.',
        account ? `Account: ${account}` : null,
        `Folder: ${folder}`,
        `Files scanned: ${rows.length}`,
        files.length ? `Files: ${files.slice(0, 40).join('; ')}` : null,
        files.length > 40 ? `Additional files omitted from note: ${files.length - 40}` : null,
        energies.length ? `Parsed energies: ${energies.slice(0, 12).join('; ')}` : null,
        warnings.length ? `Warnings: ${warnings.join('; ')}` : null,
      ].filter(Boolean).join('\n'),
    }
  })
}

function manifestRows(json: unknown, fallbackOwner: string): ResearchAssetInput[] {
  const rawJobs = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { jobs?: unknown }).jobs)
      ? (json as { jobs: unknown[] }).jobs
      : []
  const account = json && typeof json === 'object' && typeof (json as { account?: unknown }).account === 'string'
    ? (json as { account: string }).account
    : undefined
  const root = json && typeof json === 'object' && typeof (json as { root?: unknown }).root === 'string'
    ? (json as { root: string }).root
    : null
  const jobs = aggregateJobsByFolder(
    rawJobs.filter((row): row is ManifestJob => Boolean(row && typeof row === 'object')),
    account,
  )

  return jobs
    .map((job) => {
      const software = job.software || detectSoftware(job)
      const output = job.output_file || null
      const folder = job.path || folderFor(output)
      const project = projectFor(job)
      const notes = [
        job.notes,
        job.final_energy != null ? `Final energy: ${job.final_energy}` : null,
        job.warnings ? `Warnings: ${Array.isArray(job.warnings) ? job.warnings.join('; ') : job.warnings}` : null,
      ].filter(Boolean).join('\n')
      return {
        type: 'simulation',
        title: job.title || job.name || job.molecule || output || 'HPC calculation',
        description: `Imported folder summary from Linux/HPC metadata${folder ? ` in ${folder}` : ''}`,
        project,
        owner: job.owner || fallbackOwner,
        related_chemical_id: null,
        related_chemical_name: job.molecule || job.formula || null,
        source: 'hpc',
        source_external_id: folder || output,
        external_path: output,
        storage_link: folder,
        size_bytes: job.size_bytes ?? null,
        size_label: job.size_label ?? null,
        format: null,
        license: null,
        checksum: null,
        version: null,
        tags: tagsFor(job.tags, software),
        method: job.method || null,
        software: software ?? null,
        input_link: job.input_file || null,
        output_link: output,
        repo_link: null,
        environment: job.account || account || null,
        metrics: null,
        access_notes: `Raw files stay on Linux/HPC. PEARL stores metadata pointers only.${job.account || account ? ` Imported via ${job.account || account}.` : ''}${root ? ` Scan root: ${root}.` : ''}`,
        status: statusFor(job.status),
        visibility: 'private',
        notes: notes || null,
        last_verified_at: (job.last_modified || todayISO()).slice(0, 10),
      }
    })
}

function detectSoftware(job: ManifestJob) {
  const text = [job.path, job.input_file, job.output_file, job.notes].filter(Boolean).join(' ').toLowerCase()
  if (text.includes('gamess')) return 'GAMESS'
  if (text.includes('gaussian') || text.includes('.gjf') || text.includes('.com')) return 'Gaussian'
  if (text.includes('orca') || text.includes('.inp') || text.includes('.gbw')) return 'ORCA'
  if (text.includes('outcar') || text.includes('vasprun') || text.includes('incar')) return 'VASP'
  return job.software || null
}

const DEFAULT_AGENT_ROOT = '/scratch'
const AGENT_COMMAND = `PEARL_AGENT_ROOT=${DEFAULT_AGENT_ROOT} PEARL_AGENT_TOKEN=choose-a-secret python3 ~/pearl_hpc_agent.py`
const TUNNEL_COMMAND = 'ssh -L 8788:127.0.0.1:8787 abedi@aspire2a'

async function agentPost<T>(url: string, token: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${url.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'Agent request failed')
  return data as T
}

export default function HpcSyncPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [lastImport, setLastImport] = useState<number | null>(null)
  const [agentUrl, setAgentUrl] = useState(() => {
    try {
      return localStorage.getItem('pearl.hpc.agent_url') || 'http://127.0.0.1:8788'
    } catch {
      return 'http://127.0.0.1:8788'
    }
  })
  const [agentToken, setAgentToken] = useState(() => {
    try {
      return localStorage.getItem('pearl.hpc.agent_token') || 'pearl-test'
    } catch {
      return 'pearl-test'
    }
  })
  const [cwd, setCwd] = useState('.')
  const [command, setCommand] = useState('pwd')
  const [terminal, setTerminal] = useState<TerminalLine[]>([
    { kind: 'system', text: 'Start the PEARL HPC agent on Linux/HPC, then run shell commands here.' },
  ])

  useEffect(() => {
    try {
      localStorage.setItem('pearl.hpc.agent_url', agentUrl)
      localStorage.setItem('pearl.hpc.agent_token', agentToken)
    } catch {
      /* terminal still works for this page */
    }
  }, [agentUrl, agentToken])

  async function importManifest(file: File | null) {
    if (!file || !profile) return
    setBusy(true)
    try {
      const parsed = JSON.parse(await file.text())
      const rows = manifestRows(parsed, profile.full_name)
      if (rows.length === 0) throw new Error('No calculation jobs found in this manifest.')
      for (const row of rows) await api.upsertResearchAsset(row, profile)
      setLastImport(rows.length)
      toast.success(`Imported ${rows.length} Linux/HPC calculation records.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not import the manifest.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function copyCommand() {
    await navigator.clipboard.writeText(AGENT_COMMAND)
    toast.success('Agent command copied.')
  }

  async function copyTunnelCommand() {
    await navigator.clipboard.writeText(TUNNEL_COMMAND)
    toast.success('Tunnel command copied.')
  }

  function downloadAgent() {
    download('pearl_hpc_agent.py', agentSource, 'text/x-python;charset=utf-8')
  }

  async function runTerminalCommand(nextCommand = command) {
    const clean = nextCommand.trim()
    if (!clean) return
    setBusy(true)
    setTerminal((lines) => [...lines, { kind: 'input', text: `$ ${clean}` }])
    try {
      const result = await agentPost<AgentRunResult>(agentUrl, agentToken, '/run', { command: clean, cwd })
      setCwd(result.cwd || cwd)
      setTerminal((lines) => [
        ...lines,
        ...(result.stdout ? [{ kind: 'output' as const, text: result.stdout.trimEnd() }] : []),
        ...(result.stderr ? [{ kind: 'error' as const, text: result.stderr.trimEnd() }] : []),
        { kind: result.code === 0 ? 'system' : 'error', text: `exit ${result.code}` },
      ])
    } catch (err) {
      setTerminal((lines) => [...lines, { kind: 'error', text: err instanceof Error ? err.message : 'Command failed' }])
    } finally {
      setBusy(false)
    }
  }

  async function scanWithAgent() {
    if (!profile) return
    setBusy(true)
    setTerminal((lines) => [...lines, { kind: 'input', text: `$ pearl scan ${cwd}` }])
    try {
      const manifest = await agentPost<{ jobs: ManifestJob[]; count: number; root: string }>(agentUrl, agentToken, '/scan', { root: cwd })
      const rows = manifestRows(manifest, profile.full_name)
      for (const row of rows) await api.upsertResearchAsset(row, profile)
      setLastImport(rows.length)
      setTerminal((lines) => [
        ...lines,
        { kind: 'output', text: `Scanned ${manifest.root}\nFound ${manifest.count} calculation folders\nImported ${rows.length} PEARL assets` },
      ])
      toast.success(`Imported ${rows.length} records from the HPC agent.`)
    } catch (err) {
      setTerminal((lines) => [...lines, { kind: 'error', text: err instanceof Error ? err.message : 'Scan failed' }])
      toast.error(err instanceof Error ? err.message : 'Scan failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Linux/HPC Sync"
        description="Connect your HPC account through a read-only PEARL agent, browse files, and import calculation folders as research assets."
        actions={
          <>
            <button className="btn-secondary" onClick={downloadAgent}>
              <Download className="h-4 w-4" /> Agent
            </button>
            <button className="btn-secondary" onClick={() => void copyCommand()}>
              <Clipboard className="h-4 w-4" /> Start
            </button>
            <button className="btn-secondary" onClick={() => void copyTunnelCommand()}>
              <Clipboard className="h-4 w-4" /> Tunnel
            </button>
            <button className="btn-primary" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? <Spinner /> : <Upload className="h-4 w-4" />} Manifest
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => void importManifest(event.target.files?.[0] ?? null)}
            />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[0.88fr_1.12fr]">
        <section className="card p-4">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-pearl-50 p-2 text-pearl-700 dark:bg-pearl-500/10 dark:text-pearl-300">
              <Server className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">First-time setup</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">
                Download the Python agent, place it anywhere in your Linux/HPC account, then point it at the folder you want PEARL to index.
              </p>
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 2xl:grid-cols-3">
            <SetupStep
              number="1"
              title="Get agent"
              text="Download pearl_hpc_agent.py from this page and upload it wherever convenient."
              action={<button className="btn-primary py-1.5 text-xs" onClick={downloadAgent}><Download className="h-3.5 w-3.5" /> Download</button>}
            />
            <SetupStep
              number="2"
              title="Tunnel"
              text="Run from your laptop. Replace abedi@aspire2a with your HPC login."
              code={TUNNEL_COMMAND}
              action={<button className="btn-secondary py-1.5 text-xs" onClick={() => void copyTunnelCommand()}><Clipboard className="h-3.5 w-3.5" /> Copy</button>}
            />
            <SetupStep
              number="3"
              title="Start"
              text="Run on HPC. Replace /scratch with the folder you want to browse or scan."
              code={AGENT_COMMAND}
              action={<button className="btn-secondary py-1.5 text-xs" onClick={() => void copyCommand()}><Clipboard className="h-3.5 w-3.5" /> Copy</button>}
            />
          </div>

          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs leading-relaxed text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200">
            In Research Assets, users can open imported folders, preview text files, and download previews. Delete only removes the PEARL inventory record; it never deletes NSCC files.
          </div>
        </section>

        <section className="card p-4">
          <div className="mb-3 grid gap-2 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Agent URL</span>
              <input className="input" value={agentUrl} onChange={(event) => setAgentUrl(event.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Token</span>
              <input className="input" value={agentToken} onChange={(event) => setAgentToken(event.target.value)} placeholder="optional on trusted localhost" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Folder to analyze</span>
              <input className="input" value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="., CI, archive, /scratch/..." />
            </label>
          </div>

          <div className="overflow-hidden rounded-lg border border-ink-800 bg-ink-950">
            <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-ink-300">
                <TerminalSquare className="h-4 w-4" /> PEARL HPC Terminal
              </div>
              <button className="btn-secondary py-1.5 text-xs" onClick={() => void scanWithAgent()} disabled={busy}>
                <Database className="h-3.5 w-3.5" /> Scan and import
              </button>
            </div>
            <div className="h-80 overflow-y-auto whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed">
              {terminal.map((line, index) => (
                <div
                  key={index}
                  className={
                    line.kind === 'input'
                      ? 'text-pearl-200'
                      : line.kind === 'error'
                        ? 'text-rose-300'
                        : line.kind === 'system'
                          ? 'text-ink-400'
                          : 'text-ink-100'
                  }
                >
                  {line.text}
                </div>
              ))}
            </div>
            <form
              className="flex border-t border-ink-800"
              onSubmit={(event) => {
                event.preventDefault()
                void runTerminalCommand()
              }}
            >
              <span className="px-3 py-3 font-mono text-xs text-pearl-300">$</span>
              <input
                className="min-w-0 flex-1 bg-transparent px-0 py-3 font-mono text-xs text-ink-50 outline-none"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="ls -lah, find . -name '*.out', tail -100 run.out"
              />
              <button className="px-4 text-xs font-semibold text-pearl-200 disabled:text-ink-600" disabled={busy}>
                Run
              </button>
            </form>
          </div>
        </section>

        <section className="card p-4">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-pearl-50 p-2 text-pearl-700 dark:bg-pearl-500/10 dark:text-pearl-300">
              <FileText className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">What gets imported</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">
                PEARL stores folder summaries, parsed metadata, paths and ownership. Raw calculation files remain on HPC.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Step title="Folder inventory" text="One record per system/run folder, grouped by HPC account." />
            <Step title="Live browser" text="Explore folders, preview text files and copy/download previews." />
            <Step title="Read-only terminal" text="Use safe inspection commands like ls, find, grep, tail, cat, du and qstat." />
            <Step title="Private by default" text="Each user's imported folders stay private unless shared later." />
          </div>
          {lastImport != null && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200">
              <CheckCircle2 className="h-4 w-4" /> Imported {lastImport} calculation records.
            </div>
          )}
        </section>

        <section className="card p-4">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-ink-100 p-2 text-ink-700 dark:bg-ink-800 dark:text-ink-200">
              <Server className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Parser coverage</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">High-signal metadata first, raw files stay on HPC.</p>
            </div>
          </div>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <Meta label="GAMESS / Gaussian" value="Folder summaries, status, method, final energy where detectable, warnings and representative output file." />
            <Meta label="ORCA / VASP" value="Termination status, method, energy, output pointers and run-folder grouping." />
            <Meta label="Next" value="SLURM/PBS completion hook and richer parsers for spectra, geometries and tables." />
          </dl>
        </section>
      </div>
    </>
  )
}

function SetupStep({
  number,
  title,
  text,
  code,
  action,
}: {
  number: string
  title: string
  text: string
  code?: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-ink-200 p-2.5 dark:border-ink-800">
      <div className="flex items-start gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pearl-600 text-[11px] font-bold text-white">{number}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-ink-900 dark:text-ink-50">{title}</p>
            {action}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">{text}</p>
          {code && <pre className="mt-2 overflow-x-auto rounded-md bg-ink-950 p-2 font-mono text-[10px] leading-relaxed text-ink-50">{code}</pre>}
        </div>
      </div>
    </div>
  )
}

function Step({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
      <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">{text}</p>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink-50 p-3 dark:bg-ink-950">
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="mt-1 leading-relaxed text-ink-700 dark:text-ink-300">{value}</dd>
    </div>
  )
}
