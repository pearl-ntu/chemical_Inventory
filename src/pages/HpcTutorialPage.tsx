import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Clipboard,
  Download,
  FileText,
  FolderOpen,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { useToast } from '../context/ToastContext'
import { download } from '../lib/utils'
import agentSource from '../../tools/pearl_hpc_agent.py?raw'

const DEFAULT_AGENT_ROOT = '/scratch/users/<ntu-or-sutd>/<account>/<project-folder>'
const AGENT_COMMAND = `PEARL_AGENT_ROOT=${DEFAULT_AGENT_ROOT} PEARL_AGENT_TOKEN=choose-a-secret python3 ~/pearl_hpc_agent.py`
const TUNNEL_COMMAND = 'ssh -L 8788:127.0.0.1:8787 <your-account>@aspire2antu.nscc.sg'
const MANIFEST_TEMPLATE = `{
  "project": "Lanthanide emitters",
  "owner": "Your Name",
  "system": "Eu complex run 04",
  "software": "Gaussian",
  "method": "TD-DFT",
  "notes": "Metadata only. Raw files stay on HPC.",
  "tags": ["hpc", "gaussian", "tddft"]
}
`

function fillAccountPath(path: string, account: string) {
  const cleanAccount = account.trim() || 'your_account'
  return path
    .replaceAll('<your-account>', cleanAccount)
    .replaceAll('your_account', cleanAccount)
    .replaceAll('<account>', cleanAccount)
}

export default function HpcTutorialPage() {
  const toast = useToast()
  const [copied, setCopied] = useState<string | null>(null)
  const [account, setAccount] = useState('your_account')
  const [agentPath, setAgentPath] = useState('/home/users/ntu/your_account/scratch/pearl_hpc_agent.py')
  const [rootPath, setRootPath] = useState('/home/users/ntu/your_account/scratch/project_folder')
  const [token, setToken] = useState('pearl-test')

  const filledRootPath = fillAccountPath(rootPath, account)
  const filledAgentPath = fillAccountPath(agentPath, account)
  const customTunnel = `ssh -L 8788:127.0.0.1:8787 ${account.trim() || 'your_account'}@aspire2antu.nscc.sg`
  const customAgent = `PEARL_AGENT_ROOT="${filledRootPath}" PEARL_AGENT_TOKEN="${token}" python3 "${filledAgentPath}"`
  const customAgentWritable = `PEARL_AGENT_ROOT="${filledRootPath}" PEARL_AGENT_TOKEN="${token}" PEARL_AGENT_ALLOW_WRITES=1 python3 "${filledAgentPath}"`
  const projectFolderShortcut = `cd "${filledRootPath}"\nPEARL_AGENT_ROOT="$PWD" PEARL_AGENT_TOKEN="${token}" python3 "${filledAgentPath}"`

  function downloadAgent() {
    download('pearl_hpc_agent.py', agentSource, 'text/x-python;charset=utf-8')
  }

  function downloadManifest() {
    download('.pearl.json', MANIFEST_TEMPLATE, 'application/json;charset=utf-8')
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value)
    setCopied(label)
    toast.success(`${label} copied.`)
  }

  return (
    <>
      <PageHeader
        title="HPC Tutorial"
        description="One-time setup for connecting your own Linux/HPC account to PEARL without uploading raw calculation files."
        actions={
          <>
            <Link className="btn-secondary" to="/computational/hpc-sync">
              <TerminalSquare className="h-4 w-4" /> Open sync
            </Link>
            <button className="btn-primary" onClick={downloadAgent}>
              <Download className="h-4 w-4" /> Download agent
            </button>
            <button className="btn-secondary" onClick={downloadManifest}>
              <Download className="h-4 w-4" /> Manifest
            </button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
        <section className="card p-5 xl:col-span-2">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">Easy mode</h2>
              <p className="mt-1 text-sm text-ink-500">Fill three values once, then copy the exact commands. Most users do not need the longer tutorial below.</p>
            </div>
            <Link className="btn-primary" to="/computational/hpc-sync">
              <TerminalSquare className="h-4 w-4" /> Open sync after this
            </Link>
          </div>

          <div className="grid gap-3 lg:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">NSCC login</span>
              <input className="input" value={account} onChange={(event) => setAccount(event.target.value)} placeholder="syedali1" />
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Project folder to scan</span>
              <input className="input font-mono text-xs" value={rootPath} onChange={(event) => setRootPath(event.target.value)} placeholder="/home/users/ntu/syedali1/scratch/Single_Arm_TICT/New_TICT_Library" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Token</span>
              <input className="input" value={token} onChange={(event) => setToken(event.target.value)} />
            </label>
            <label className="block lg:col-span-4">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Where pearl_hpc_agent.py is on NSCC</span>
              <input className="input font-mono text-xs" value={agentPath} onChange={(event) => setAgentPath(event.target.value)} placeholder="/home/users/ntu/syedali1/scratch/pearl_hpc_agent.py" />
              <span className="mt-1 block text-xs text-ink-500">Resolved: <span className="font-mono">{filledAgentPath}</span></span>
            </label>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <QuickCommand
              title="1. Laptop PowerShell"
              text="Open this tunnel from your laptop and keep that PowerShell window open."
              code={customTunnel}
              onCopy={() => void copy('Laptop tunnel command', customTunnel)}
              copied={copied === 'Laptop tunnel command'}
            />
            <QuickCommand
              title="2. NSCC terminal"
              text="Run the agent on NSCC and keep this SSH terminal open."
              code={customAgent}
              onCopy={() => void copy('NSCC agent command', customAgent)}
              copied={copied === 'NSCC agent command'}
            />
          </div>

          <div className="mt-3 rounded-lg border border-ink-200 p-3 text-sm dark:border-ink-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-ink-900 dark:text-ink-50">Even easier when you are already inside the project folder</p>
                <p className="mt-1 text-xs text-ink-500">This uses the current folder as the scan root.</p>
              </div>
              <button className="btn-secondary py-1.5 text-xs" onClick={() => void copy('Current-folder agent command', projectFolderShortcut)}>
                <Clipboard className="h-3.5 w-3.5" /> Copy
              </button>
            </div>
            <pre className="mt-2 overflow-auto rounded bg-ink-950 p-3 text-xs text-ink-50">{projectFolderShortcut}</pre>
          </div>

          <div className="mt-4 rounded-lg border border-pearl-200 bg-pearl-50 p-3 text-sm text-pearl-900 dark:border-pearl-500/25 dark:bg-pearl-500/10 dark:text-pearl-100">
            In PEARL Linux/HPC Sync use <span className="font-mono">http://127.0.0.1:8788</span>, token <span className="font-mono">{token || 'your token'}</span>, folder <span className="font-mono">.</span>, then run <span className="font-mono">pearl scan .</span>.
          </div>
        </section>

        <section className="card p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <GuideStep
              number="1"
              icon={<Download className="h-4 w-4" />}
              title="Download"
              text="Download pearl_hpc_agent.py here, then put it anywhere in your HPC account, for example your home folder."
              action={<button className="btn-primary py-1.5 text-xs" onClick={downloadAgent}><Download className="h-3.5 w-3.5" /> Agent</button>}
            />
            <GuideStep
              number="2"
              icon={<TerminalSquare className="h-4 w-4" />}
              title="Tunnel"
              text="Run this from your laptop/PowerShell. Replace <your-account> with your NSCC/HPC login."
              code={TUNNEL_COMMAND}
              action={<button className="btn-secondary py-1.5 text-xs" onClick={() => void copy('Tunnel command', TUNNEL_COMMAND)}><Clipboard className="h-3.5 w-3.5" /> Copy</button>}
              copied={copied === 'Tunnel command'}
            />
            <GuideStep
              number="3"
              icon={<FolderOpen className="h-4 w-4" />}
              title="Start"
              text="Run this after SSH login. Replace the scratch path with the exact folder PEARL may browse and scan."
              code={AGENT_COMMAND}
              action={<button className="btn-secondary py-1.5 text-xs" onClick={() => void copy('Agent command', AGENT_COMMAND)}><Clipboard className="h-3.5 w-3.5" /> Copy</button>}
              copied={copied === 'Agent command'}
            />
          </div>
        </section>

        <section className="card p-5">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">Safety model</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-500">
                The agent is read-only by default. PEARL can list folders, preview text files, scan logs, and import metadata. Deleting in PEARL only removes the inventory record.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 text-sm">
            <Safety label="NSCC files" value="Read-only mode never deletes, edits, moves, renames, or uploads files. Write mode only creates generated job files inside PEARL_AGENT_ROOT." />
            <Safety label="Generated jobs" value="Workbench can write generated .com/.inp/.sh files only if you start the agent with PEARL_AGENT_ALLOW_WRITES=1." />
            <Safety label="Imported data" value="Folder name, account label, paths, software, method, status, size, energies and warnings where detected." />
            <Safety label="Visibility" value="Computational assets are private to the user who imported or created them. Other members do not see your HPC folders." />
          </div>
        </section>

        <section className="card p-5 xl:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">Daily workflow</h2>
              <p className="mt-1 text-sm text-ink-500">After setup, most users only need the sync page and research assets browser.</p>
            </div>
            <Link className="btn-secondary" to="/research-assets">
              <FileText className="h-4 w-4" /> Research Assets
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Workflow title="Open Sync" text="Use Agent URL http://127.0.0.1:8788, enter your token, paste the folder to scan, then inspect safely." />
            <Workflow title="Scan Folder" text="Click Scan and import. PEARL creates folder-level assets, not one noisy card per file." />
            <Workflow title="Browse Assets" text="Open a folder card to see contained records and live folder contents." />
            <Workflow title="Preview Files" text="View text files in PEARL, download previews when needed, and keep raw files on HPC." />
          </div>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100">
            Example paths use placeholders. A real scratch folder usually looks like <span className="font-mono">/scratch/users/sutd/your_account/project/run_01</span> or <span className="font-mono">/scratch/users/ntu/your_account/project/run_01</span>. Use the folder you want PEARL to index.
          </div>
          <div className="mt-3 rounded-lg border border-ink-200 p-3 text-sm dark:border-ink-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-ink-900 dark:text-ink-50">Optional workbench send mode</p>
              <button className="btn-secondary py-1.5 text-xs" onClick={() => void copy('Write-mode agent command', customAgentWritable)}><Clipboard className="h-3.5 w-3.5" /> Copy</button>
            </div>
            <pre className="mt-2 overflow-auto rounded bg-ink-950 p-3 text-xs text-ink-50">{customAgentWritable}</pre>
            <p className="mt-2 text-xs text-ink-500">Use this only when you want the Quantum Input Generator to send generated job files into the selected PEARL_AGENT_ROOT folder.</p>
          </div>
          <div className="mt-3 rounded-lg border border-ink-200 p-3 text-sm dark:border-ink-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-ink-900 dark:text-ink-50">Optional .pearl.json folder manifest</p>
              <button className="btn-secondary py-1.5 text-xs" onClick={downloadManifest}><Download className="h-3.5 w-3.5" /> Download</button>
            </div>
            <pre className="mt-2 overflow-auto rounded bg-ink-950 p-3 text-xs text-ink-50">{MANIFEST_TEMPLATE}</pre>
            <p className="mt-2 text-xs text-ink-500">Put this file inside a calculation folder so the PEARL scanner imports cleaner project, owner, software, method, notes, and tags.</p>
          </div>
        </section>
      </div>
    </>
  )
}

function GuideStep({
  number,
  icon,
  title,
  text,
  code,
  action,
  copied,
}: {
  number: string
  icon: ReactNode
  title: string
  text: string
  code?: string
  action?: ReactNode
  copied?: boolean
}) {
  return (
    <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pearl-600 text-xs font-bold text-white">{number}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
            {icon} {title}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">{text}</p>
          {code && <pre className="mt-2 overflow-x-auto rounded-md bg-ink-950 p-2 font-mono text-[11px] leading-relaxed text-ink-50">{code}</pre>}
          <div className="mt-3 flex items-center justify-between gap-2">
            {action}
            {copied && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-300">Copied</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

function QuickCommand({
  title,
  text,
  code,
  onCopy,
  copied,
}: {
  title: string
  text: string
  code: string
  onCopy: () => void
  copied?: boolean
}) {
  return (
    <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">{text}</p>
        </div>
        <button className="btn-secondary shrink-0 py-1.5 text-xs" onClick={onCopy}>
          <Clipboard className="h-3.5 w-3.5" /> Copy
        </button>
      </div>
      <pre className="mt-3 overflow-auto rounded bg-ink-950 p-3 text-xs leading-relaxed text-ink-50">{code}</pre>
      {copied && <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-300">Copied</p>}
    </div>
  )
}

function Safety({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink-50 p-3 dark:bg-ink-950">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-1 leading-relaxed text-ink-700 dark:text-ink-300">{value}</p>
    </div>
  )
}

function Workflow({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
        <ArrowRight className="h-4 w-4 text-pearl-600" /> {title}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">{text}</p>
    </div>
  )
}
