import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  FlaskConical,
  Orbit,
  Play,
  Rotate3D,
  Server,
  Settings,
  Sparkles,
  Upload,
} from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { Molecule3DViewer } from '../components/Molecule3DViewer'
import { Spinner, Field } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { consumeActiveProtocol } from '../lib/computationalProtocols'
import {
  BASES,
  FUNCTIONALS,
  GAUSSIAN_STEPS,
  ORCA_STEPS,
  SOLVENTS,
  extractNamesFromSvgText,
  generateQuantumFiles,
  generateTictFiles,
  gaussianRoute,
  moleculeToXyz,
  orcaRoute,
  parseCoordinateText,
  parseSmilesLines,
  type GeneratedQuantumFile,
  type QuantumConfig,
  type QuantumMode,
  type QuantumMolecule,
  type QuantumSoftware,
  type Scheduler,
  type StateType,
} from '../lib/quantumGenerator'
import { cx, download, downloadBlob } from '../lib/utils'
import { createZipBlob } from '../lib/zip'

type WorkbenchTab = 'input' | 'routes' | 'advanced' | 'tict'

export default function ComputationalWorkbenchPage() {
  const toast = useToast()
  const resultsRef = useRef<HTMLElement>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [render3d, setRender3d] = useState(false)
  const [tab, setTab] = useState<WorkbenchTab>('input')
  const [software, setSoftware] = useState<QuantumSoftware>('gaussian')
  const [mode, setMode] = useState<QuantumMode>('single')
  const [step, setStep] = useState(4)
  const [multiSteps, setMultiSteps] = useState<number[]>([1, 2, 4])
  const [method, setMethod] = useState('m062x')
  const [basis, setBasis] = useState('def2SVP')
  const [solventModel, setSolventModel] = useState<QuantumConfig['solventModel']>('SMD')
  const [solventName, setSolventName] = useState('DMSO')
  const [nproc, setNproc] = useState(64)
  const [memory, setMemory] = useState('128GB')
  const [maxcoreMb, setMaxcoreMb] = useState(4000)
  const [scheduler, setScheduler] = useState<Scheduler>('pbs')
  const [queue, setQueue] = useState('normal')
  const [walltime, setWalltime] = useState('24:00:00')
  const [project, setProject] = useState('15002108')
  const [account, setAccount] = useState('')
  const [tdStates, setTdStates] = useState(3)
  const [tdRoot, setTdRoot] = useState(1)
  const [stateType, setStateType] = useState<StateType>('singlet')
  const [popFull, setPopFull] = useState(false)
  const [dispersion, setDispersion] = useState(false)
  const [socEnable, setSocEnable] = useState(false)
  const [charge, setCharge] = useState(0)
  const [multiplicity, setMultiplicity] = useState(1)
  const [name, setName] = useState('ethanol')
  const [coordsText, setCoordsText] = useState('9\nethanol\nC -0.9254 0.0742 0.0328\nC 0.5123 -0.4192 -0.0743\nO 1.3778 0.4494 0.6044\nH -1.0225 1.0735 -0.4429\nH -1.6044 -0.6361 -0.4516\nH -1.2237 0.1472 1.0831\nH 0.8052 -0.5055 -1.1280\nH 0.5818 -1.4235 0.3908\nH 1.2847 1.3020 0.1671')
  const [smilesText, setSmilesText] = useState('ethanol:CCO')
  const [removePrefix, setRemovePrefix] = useState('')
  const [removeSuffix, setRemoveSuffix] = useState('')
  const [manualRoutes, setManualRoutes] = useState<Record<number, string>>({})
  const [customKeywords, setCustomKeywords] = useState('! m06-2x def2-TZVP TightSCF')
  const [customBlock, setCustomBlock] = useState('')
  const [redundantCoords, setRedundantCoords] = useState('')
  const [orcaPath, setOrcaPath] = useState('orca')
  const [tictAxis, setTictAxis] = useState('1,2')
  const [tictBranchA, setTictBranchA] = useState('3,4,5')
  const [tictBranchB, setTictBranchB] = useState('')
  const [tictStepA, setTictStepA] = useState(10)
  const [tictStepB, setTictStepB] = useState(0)
  const [tictSteps, setTictSteps] = useState(18)
  const [molecules, setMolecules] = useState<QuantumMolecule[]>([])
  const [files, setFiles] = useState<GeneratedQuantumFile[]>([])
  const [activeFile, setActiveFile] = useState(0)
  const [activeMol, setActiveMol] = useState(0)
  const [viewerMolIndexes, setViewerMolIndexes] = useState<number[]>([])
  const [hpcBusy, setHpcBusy] = useState(false)
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
  const [hpcTarget, setHpcTarget] = useState('pearl-generated')

  useEffect(() => {
    const protocol = consumeActiveProtocol()
    if (!protocol) return
    setSoftware(protocol.software)
    setMethod(protocol.method)
    setBasis(protocol.basis)
    setSolventModel(protocol.solventModel)
    setSolventName(protocol.solventName)
    setMode(protocol.mode)
    setStep(protocol.step)
    setMultiSteps(protocol.multiSteps)
    setScheduler(protocol.scheduler)
    setQueue(protocol.queue)
    setNproc(protocol.nproc)
    setMemory(protocol.memory)
    setMaxcoreMb(protocol.maxcoreMb)
    setWalltime(protocol.walltime)
    setProject(protocol.project)
    setTdStates(protocol.tdStates)
    setTdRoot(protocol.tdRoot)
    setStateType(protocol.stateType)
    setPopFull(protocol.popFull)
    setDispersion(protocol.dispersion)
    setSocEnable(protocol.socEnable)
    setFiles([])
    setTab('input')
    toast.success(`Loaded protocol: ${protocol.title}`)
  }, [toast])

  const steps = software === 'gaussian' ? GAUSSIAN_STEPS : ORCA_STEPS
  const config = useMemo<QuantumConfig>(() => ({
    software,
    mode,
    step,
    multiSteps,
    method,
    basis,
    solventModel,
    solventName,
    nproc,
    memory,
    scheduler,
    queue,
    walltime,
    project,
    account,
    tdStates,
    tdRoot,
    stateType,
    popFull,
    dispersion,
    socEnable,
    redundantCoords,
    manualRoutes,
    customKeywords,
    customBlock,
    orcaPath,
    maxcoreMb,
    charge,
    multiplicity,
  }), [account, basis, charge, customBlock, customKeywords, dispersion, manualRoutes, maxcoreMb, memory, method, mode, multiSteps, multiplicity, nproc, orcaPath, popFull, project, queue, redundantCoords, scheduler, socEnable, software, solventModel, solventName, stateType, step, tdRoot, tdStates, walltime])

  const selected = files[activeFile] ?? files[0] ?? null
  const molecule = molecules[activeMol] ?? molecules[0] ?? null
  const routePreview = steps.map(([value, label]) => ({
    value,
    label,
    route: software === 'gaussian' ? gaussianRoute(value, config) : orcaRoute(value, config),
  }))

  function chooseSoftware(next: QuantumSoftware) {
    setSoftware(next)
    setFiles([])
    setActiveFile(0)
    if (next === 'orca') {
      setMethod('m06-2x')
      setBasis('def2-TZVP')
      setSolventModel('none')
      setStep(4)
      setMultiSteps([1, 2, 4])
    } else {
      setMethod('m062x')
      setBasis('def2SVP')
      setSolventModel('SMD')
      setStep(4)
      setMultiSteps([1, 2, 4])
    }
  }

  function cleanLoadedMolecule(mol: QuantumMolecule) {
    return { ...mol, name: cleanNameValue(mol.name, removePrefix, removeSuffix) }
  }

  function resetViewerSelection(rows: QuantumMolecule[]) {
    setViewerMolIndexes(rows.length ? [0] : [])
  }

  function moleculeFromText(showToast = true) {
    const parsed = parseCoordinateText(coordsText, name)
    if (!parsed) {
      if (showToast) toast.error('Could not parse coordinates. Paste XYZ, Gaussian .com, ORCA .inp, or Gaussian .log text.')
      return null
    }
    const mol = cleanLoadedMolecule({ ...parsed, name, charge, multiplicity })
    setMolecules([mol])
    setActiveMol(0)
    resetViewerSelection([mol])
    setFiles([])
    if (showToast) toast.success(`Loaded ${mol.name} with ${mol.coords.length} atoms.`)
    return mol
  }

  function addFromText() {
    moleculeFromText(true)
  }

  async function addFiles(list: FileList | null) {
    if (!list) return
    const rows: QuantumMolecule[] = []
    for (const file of Array.from(list)) {
      const parsed = parseCoordinateText(await file.text(), file.name)
      if (parsed) rows.push(cleanLoadedMolecule({ ...parsed, charge: parsed.charge ?? charge, multiplicity: parsed.multiplicity ?? multiplicity }))
    }
    setMolecules(rows)
    setActiveMol(0)
    resetViewerSelection(rows)
    setFiles([])
    if (rows.length) toast.success(`Loaded ${rows.length} molecule${rows.length === 1 ? '' : 's'}.`)
    else toast.error('No readable coordinates found in those files.')
  }

  function applyNameCleanup() {
    if (!molecules.length) return toast.info('Load molecules first, then clean their names.')
    const cleaned = molecules.map(cleanLoadedMolecule)
    setMolecules(cleaned)
    setActiveMol((index) => Math.min(index, cleaned.length - 1))
    resetViewerSelection(cleaned)
    setFiles([])
    toast.success('Cleaned loaded molecule names.')
  }

  async function loadSvgNames(list: FileList | null) {
    const file = list?.[0]
    if (!file) return
    const names = extractNamesFromSvgText(await file.text())
    if (!names.length) return toast.error('No names found in that SVG.')
    const parsed = parseSmilesLines(smilesText, charge, multiplicity)
    setSmilesText(parsed.map((row, index) => `${names[index] ?? row.name}:${row.smiles}`).join('\n'))
    toast.success(`Matched ${Math.min(names.length, parsed.length)} SVG names to SMILES lines.`)
  }

  function loadSmilesList() {
    const parsed = parseSmilesLines(smilesText, charge, multiplicity)
    if (!parsed.length) return toast.error('Paste one SMILES per line first.')
    toast.info('SMILES names loaded. Browser-only 3D coordinate generation still needs a chemistry backend; paste/export XYZ coordinates for final input generation.')
    setName(parsed[0].name)
  }

  function toggleStep(value: number) {
    setMultiSteps((prev) => prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value].sort((a, b) => a - b))
  }

  function preview() {
    if (isGenerating) return
    const source = molecules.length > 0
      ? molecules.map(cleanLoadedMolecule)
      : [moleculeFromText(false)].filter((mol): mol is QuantumMolecule => Boolean(mol))
    if (source.length === 0) return toast.error('Could not parse the molecule text. Paste XYZ, Gaussian .com, ORCA .inp, or Gaussian .log text.')
    setIsGenerating(true)
    setRender3d(false)
    window.setTimeout(() => {
      try {
        const generated = generateQuantumFiles(source, config)
        setMolecules(source)
        setActiveMol((index) => Math.min(index, source.length - 1))
        resetViewerSelection(source)
        setFiles(generated)
        setActiveFile(0)
        toast.success(`Generated ${generated.length} preview files.`)
        window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not generate files.')
      } finally {
        setIsGenerating(false)
      }
    }, 0)
  }

  function previewTict() {
    if (!molecule) return toast.info('Load a molecule first.')
    try {
      const generated = generateTictFiles(molecule, { axis: tictAxis, branchA: tictBranchA, branchAStep: tictStepA, branchB: tictBranchB, branchBStep: tictStepB, steps: tictSteps }, software)
      setFiles(generated)
      setActiveFile(0)
      toast.success(`Generated ${generated.length} TICT geometry files.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not generate TICT files.')
    }
  }

  function toggleViewerMolecule(index: number) {
    setRender3d(false)
    setViewerMolIndexes((prev) => {
      if (prev.includes(index)) return prev.filter((item) => item !== index)
      if (prev.length >= 4) {
        toast.info('PEARL renders up to 4 molecules at once. Clear one first.')
        return prev
      }
      return [...prev, index].sort((a, b) => a - b)
    })
  }

  function renderSelectedMolecules() {
    if (!molecules.length) return toast.info('Load molecules first.')
    if (!viewerMolIndexes.length) return toast.info('Select at least one molecule to render.')
    setRender3d(true)
  }

  function downloadSelected() {
    if (selected) download(selected.filename, selected.content)
  }

  function downloadBundle() {
    if (files.length === 0) return toast.info('Generate a preview first.')
    const bundle = files.map((file) => [`===== ${file.filename} =====`, file.content, ''].join('\n')).join('\n')
    download(`${software}_pearl_generated_files.txt`, bundle)
  }

  function downloadZipBundle() {
    if (files.length === 0) return toast.info('Generate a preview first.')
    const blob = createZipBlob(files.map((file) => ({ filename: file.filename, content: file.content })))
    downloadBlob(`${software}_pearl_generated_files.zip`, blob)
  }

  async function sendToHpc() {
    if (files.length === 0) return toast.info('Generate files first.')
    if (!hpcTarget.trim()) return toast.info('Choose a target folder inside PEARL_AGENT_ROOT.')
    setHpcBusy(true)
    try {
      localStorage.setItem('pearl.hpc.agent_url', agentUrl)
      localStorage.setItem('pearl.hpc.agent_token', agentToken)
      const res = await fetch(`${agentUrl.replace(/\/$/, '')}/write-bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(agentToken ? { Authorization: `Bearer ${agentToken}` } : {}),
        },
        body: JSON.stringify({
          target: hpcTarget.trim(),
          overwrite: true,
          files: files.map((file) => ({ filename: file.filename, content: file.content })),
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Could not send files to HPC.')
      toast.success(`Sent ${data.count ?? files.length} files to ${data.target || hpcTarget}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send files to HPC.')
    } finally {
      setHpcBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Quantum Input Generator"
        description="Integrated PEARL workbench for Gaussian and ORCA inputs, routes, scripts, TICT geometries, SOC preparation, and molecular previews."
        actions={
          <>
            <button className="btn-secondary" onClick={downloadSelected} disabled={!selected}>
              <Download className="h-4 w-4" /> File
            </button>
            <button className="btn-secondary" onClick={preview} disabled={isGenerating}>
              {isGenerating ? <Spinner className="h-4 w-4" /> : <Play className="h-4 w-4" />} {isGenerating ? 'Generating' : 'Generate'}
            </button>
            <button className="btn-secondary" onClick={downloadBundle} disabled={files.length === 0}>
              <Download className="h-4 w-4" /> Text
            </button>
            <button className="btn-primary" onClick={downloadZipBundle} disabled={files.length === 0}>
              <Download className="h-4 w-4" /> ZIP
            </button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="card p-4">
            <div className="mb-3 flex items-center gap-2">
              <Settings className="h-4 w-4 text-pearl-600" />
              <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">Calculation core</h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['gaussian', 'orca'] as QuantumSoftware[]).map((value) => (
                <button key={value} className={software === value ? 'btn-primary' : 'btn-secondary'} onClick={() => chooseSoftware(value)}>
                  {value === 'gaussian' ? 'Gaussian' : 'ORCA'}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={software === 'gaussian' ? 'Functional' : 'Method'}>
                <input className="input" list="quantum-functionals" value={method} onChange={(event) => setMethod(event.target.value)} />
              </Field>
              <Field label="Basis">
                <input className="input" list="quantum-bases" value={basis} onChange={(event) => setBasis(event.target.value)} />
              </Field>
              <Field label="Mode">
                <select className="input" value={mode} onChange={(event) => setMode(event.target.value as QuantumMode)}>
                  <option value="single">Single</option>
                  <option value="multiple">Multiple</option>
                  <option value="full">Full workflow</option>
                </select>
              </Field>
              <Field label="Step">
                <select className="input" value={step} disabled={mode !== 'single'} onChange={(event) => setStep(Number(event.target.value))}>
                  {steps.map(([value, label]) => <option key={value} value={value}>{value}: {label}</option>)}
                </select>
              </Field>
            </div>
            {mode === 'multiple' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {steps.map(([value]) => (
                  <button key={value} className={multiSteps.includes(value) ? 'btn-primary py-1 text-xs' : 'btn-secondary py-1 text-xs'} onClick={() => toggleStep(value)}>
                    Step {value}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="card p-4">
            <h2 className="mb-3 text-sm font-bold text-ink-900 dark:text-ink-50">HPC resources</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Scheduler">
                <select className="input" value={scheduler} onChange={(event) => setScheduler(event.target.value as Scheduler)}>
                  <option value="pbs">PBS</option>
                  <option value="slurm">SLURM</option>
                  <option value="local">Local</option>
                </select>
              </Field>
              <Field label="Queue">
                <input className="input" value={queue} onChange={(event) => setQueue(event.target.value)} />
              </Field>
              <Field label="CPUs">
                <input className="input" type="number" min={1} value={nproc} onChange={(event) => setNproc(Number(event.target.value))} />
              </Field>
              <Field label={software === 'orca' ? 'MaxCore MB' : 'Memory'}>
                {software === 'orca'
                  ? <input className="input" type="number" min={500} value={maxcoreMb} onChange={(event) => setMaxcoreMb(Number(event.target.value))} />
                  : <input className="input" value={memory} onChange={(event) => setMemory(event.target.value)} />}
              </Field>
              <Field label="Walltime">
                <input className="input" value={walltime} onChange={(event) => setWalltime(event.target.value)} />
              </Field>
              <Field label="Project">
                <input className="input" value={project} onChange={(event) => setProject(event.target.value)} />
              </Field>
            </div>
          </section>
        </aside>

        <main className="space-y-4">
          <section className="card overflow-hidden">
            <div className="flex flex-wrap border-b border-ink-200 p-2 dark:border-ink-800">
              {(['input', 'routes', 'advanced', 'tict'] as WorkbenchTab[]).map((value) => (
                <button key={value} className={tab === value ? 'btn-primary m-1 py-1.5 text-xs capitalize' : 'btn-secondary m-1 py-1.5 text-xs capitalize'} onClick={() => setTab(value)}>
                  {value}
                </button>
              ))}
            </div>

            {tab === 'input' && (
              <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">Molecule input</h2>
                      <p className="text-xs text-ink-500">Paste XYZ, Gaussian .com, ORCA .inp, or Gaussian .log text.</p>
                    </div>
                    <label className="btn-secondary cursor-pointer">
                      <Upload className="h-4 w-4" /> Upload files
                      <input type="file" multiple accept=".xyz,.com,.gjf,.inp,.log,.out" className="hidden" onChange={(event) => void addFiles(event.target.files)} />
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Molecule name">
                      <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
                    </Field>
                    <Field label="Charge">
                      <input className="input" type="number" value={charge} onChange={(event) => setCharge(Number(event.target.value))} />
                    </Field>
                    <Field label="Multiplicity">
                      <input className="input" type="number" min={1} value={multiplicity} onChange={(event) => setMultiplicity(Number(event.target.value))} />
                    </Field>
                  </div>
                  <textarea className="input mt-3 min-h-[260px] font-mono text-xs" value={coordsText} onChange={(event) => setCoordsText(event.target.value)} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn-secondary" onClick={addFromText}>
                      <FlaskConical className="h-4 w-4" /> Load molecule
                    </button>
                    <button className="btn-primary" onClick={preview} disabled={isGenerating}>
                      {isGenerating ? <Spinner className="h-4 w-4" /> : <Play className="h-4 w-4" />} {isGenerating ? 'Generating' : 'Generate'}
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-ink-500">SMILES helper</h3>
                    <textarea className="input mt-2 min-h-[110px] font-mono text-xs" value={smilesText} onChange={(event) => setSmilesText(event.target.value)} />
                    <div className="mt-2 flex gap-2">
                      <button className="btn-secondary py-1 text-xs" onClick={loadSmilesList}>Read names</button>
                      <label className="btn-secondary cursor-pointer py-1 text-xs">
                        SVG names
                        <input type="file" accept=".svg" className="hidden" onChange={(event) => void loadSvgNames(event.target.files)} />
                      </label>
                    </div>
                  </div>
                  <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-ink-500">Filename cleanup</h3>
                    <p className="mt-1 text-xs text-ink-500">Cut old method, basis, solvent, or numbering from uploaded log names before PEARL generates new files.</p>
                    <div className="mt-3 grid gap-2">
                      <Field label="Remove prefix">
                        <input className="input font-mono text-xs" value={removePrefix} onChange={(event) => setRemovePrefix(event.target.value)} placeholder="04_" />
                      </Field>
                      <Field label="Remove suffix">
                        <input className="input font-mono text-xs" value={removeSuffix} onChange={(event) => setRemoveSuffix(event.target.value)} placeholder="_m062x_def2SVP_dmso" />
                      </Field>
                    </div>
                    <button type="button" className="btn-secondary mt-3 w-full justify-center py-1.5 text-xs" onClick={applyNameCleanup}>
                      Clean loaded names
                    </button>
                  </div>
                  <MoleculeList molecules={molecules} active={activeMol} onSelect={setActiveMol} />
                </div>
              </div>
            )}

            {tab === 'routes' && (
              <div className="grid gap-4 p-4 lg:grid-cols-2">
                <div className="space-y-3">
                  {routePreview.map((row) => (
                    <div key={row.value} className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
                      <p className="text-xs font-bold text-ink-500">Step {row.value}: {row.label}</p>
                      <pre className="mt-2 whitespace-pre-wrap rounded bg-ink-950 p-3 text-xs text-ink-50">{row.route}</pre>
                    </div>
                  ))}
                </div>
                <div className="space-y-3">
                  <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">Manual Gaussian routes</h2>
                  {GAUSSIAN_STEPS.map(([value, label]) => (
                    <Field key={value} label={`Step ${value}: ${label}`}>
                      <input className="input font-mono text-xs" value={manualRoutes[value] ?? ''} onChange={(event) => setManualRoutes((prev) => ({ ...prev, [value]: event.target.value }))} placeholder="Leave blank to auto-build" disabled={software !== 'gaussian'} />
                    </Field>
                  ))}
                </div>
              </div>
            )}

            {tab === 'advanced' && (
              <div className="grid gap-4 p-4 lg:grid-cols-2">
                <section className="space-y-3">
                  <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">TD-DFT and solvent</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="State type">
                      <select className="input" value={stateType} onChange={(event) => setStateType(event.target.value as StateType)}>
                        <option value="singlet">Singlet</option>
                        <option value="triplet">Triplet</option>
                        <option value="mixed">Mixed 50-50</option>
                      </select>
                    </Field>
                    <Field label="TD states">
                      <input className="input" type="number" min={1} value={tdStates} onChange={(event) => setTdStates(Number(event.target.value))} />
                    </Field>
                    <Field label="TD root">
                      <input className="input" type="number" min={1} value={tdRoot} onChange={(event) => setTdRoot(Number(event.target.value))} />
                    </Field>
                    <Field label="Solvent model">
                      <select className="input" value={solventModel} onChange={(event) => setSolventModel(event.target.value as QuantumConfig['solventModel'])}>
                        <option value="none">Gas phase</option>
                        <option value="SMD">SMD</option>
                        <option value="PCM">PCM</option>
                        <option value="IEFPCM">IEFPCM</option>
                        <option value="CPCM">CPCM</option>
                      </select>
                    </Field>
                    <Field label="Solvent">
                      <input className="input" list="quantum-solvents" value={solventName} onChange={(event) => setSolventName(event.target.value)} disabled={solventModel === 'none'} />
                    </Field>
                    <Field label="SLURM account">
                      <input className="input" value={account} onChange={(event) => setAccount(event.target.value)} />
                    </Field>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Toggle label="Pop full" checked={popFull} onChange={setPopFull} />
                    <Toggle label="GD3BJ" checked={dispersion} onChange={setDispersion} />
                    <Toggle label="PySOC prep" checked={socEnable} onChange={(value) => { setSocEnable(value); if (value) setStateType('mixed') }} />
                  </div>
                </section>
                <section className="space-y-3">
                  <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">Special blocks</h2>
                  <Field label="Gaussian redundant coordinates, added to step 4">
                    <textarea className="input min-h-[90px] font-mono text-xs" value={redundantCoords} onChange={(event) => setRedundantCoords(event.target.value)} placeholder="B 1 2 F" />
                  </Field>
                  <Field label="ORCA executable path">
                    <input className="input" value={orcaPath} onChange={(event) => setOrcaPath(event.target.value)} />
                  </Field>
                  <Field label="ORCA custom keywords, step 9">
                    <textarea className="input min-h-[70px] font-mono text-xs" value={customKeywords} onChange={(event) => setCustomKeywords(event.target.value)} />
                  </Field>
                  <Field label="ORCA custom block, step 9">
                    <textarea className="input min-h-[90px] font-mono text-xs" value={customBlock} onChange={(event) => setCustomBlock(event.target.value)} />
                  </Field>
                </section>
              </div>
            )}

            {tab === 'tict' && (
              <div className="grid gap-4 p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                <section className="space-y-3">
                  <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">TICT rotation</h2>
                  <Field label="Rotation axis atoms">
                    <input className="input" value={tictAxis} onChange={(event) => setTictAxis(event.target.value)} />
                  </Field>
                  <Field label="Branch A atoms">
                    <input className="input" value={tictBranchA} onChange={(event) => setTictBranchA(event.target.value)} />
                  </Field>
                  <Field label="Branch B atoms">
                    <input className="input" value={tictBranchB} onChange={(event) => setTictBranchB(event.target.value)} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="A deg/step">
                      <input className="input" type="number" value={tictStepA} onChange={(event) => setTictStepA(Number(event.target.value))} />
                    </Field>
                    <Field label="B deg/step">
                      <input className="input" type="number" value={tictStepB} onChange={(event) => setTictStepB(Number(event.target.value))} />
                    </Field>
                    <Field label="Steps">
                      <input className="input" type="number" min={1} value={tictSteps} onChange={(event) => setTictSteps(Number(event.target.value))} />
                    </Field>
                  </div>
                  <button className="btn-primary" onClick={previewTict} disabled={!molecule}>
                    <Rotate3D className="h-4 w-4" /> Generate TICT files
                  </button>
                </section>
                <div className="rounded-lg border border-ink-200 p-4 text-sm text-ink-600 dark:border-ink-800 dark:text-ink-300">
                  <p>TICT uses 1-based atom indices, matching the original tool. It rotates selected branches around the two-axis atoms and produces Gaussian .com or ORCA .xyz geometry series.</p>
                  <p className="mt-3">Nothing is sent to HPC and nothing is written to NSCC until you download files and submit them yourself.</p>
                </div>
              </div>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <StatusTile label="Molecules" value={molecules.length} good={molecules.length > 0} />
            <StatusTile label="Software" value={software.toUpperCase()} good />
            <StatusTile label="Generated files" value={files.length} good={files.length > 0} />
          </section>

          <section ref={resultsRef} className="card scroll-mt-24 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 p-4 dark:border-ink-800">
              <div>
                <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">Generated text and 3D molecular view</h2>
                <p className="text-xs text-ink-500">Select a generated file on the left; the molecule preview stays on the right.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {files.length > 0 ? (
                  <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Ready</p>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300"><AlertCircle className="h-4 w-4" /> No preview yet</p>
                )}
                <button className="btn-secondary py-1.5 text-xs" onClick={downloadSelected} disabled={!selected}>
                  <Download className="h-3.5 w-3.5" /> File
                </button>
                <button className="btn-primary py-1.5 text-xs" onClick={downloadZipBundle} disabled={files.length === 0}>
                  <Download className="h-3.5 w-3.5" /> ZIP
                </button>
              </div>
            </div>
            {files.length === 0 ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-center text-sm text-ink-400">
                <Sparkles className="h-8 w-8" />
                <p>Paste or upload a molecule, then click Generate. PEARL will parse it automatically.</p>
              </div>
            ) : (
              <>
              <div className="border-b border-ink-200 p-4 dark:border-ink-800">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_160px]">
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="Agent URL">
                      <input className="input" value={agentUrl} onChange={(event) => setAgentUrl(event.target.value)} />
                    </Field>
                    <Field label="Token">
                      <input className="input" value={agentToken} onChange={(event) => setAgentToken(event.target.value)} placeholder="optional on trusted localhost" />
                    </Field>
                    <Field label="HPC target folder">
                      <input className="input" value={hpcTarget} onChange={(event) => setHpcTarget(event.target.value)} placeholder="jobs/FLIMBD_1" />
                    </Field>
                  </div>
                  <button className="btn-secondary h-10 self-end justify-center" onClick={sendToHpc} disabled={hpcBusy || files.length === 0}>
                    {hpcBusy ? <Spinner className="h-4 w-4" /> : <Server className="h-4 w-4" />} Send to HPC
                  </button>
                </div>
                <p className="mt-2 text-xs text-ink-500">Requires the updated PEARL HPC agent running with write mode. Files are written only inside PEARL_AGENT_ROOT.</p>
              </div>
              <div className="grid min-h-[540px] xl:grid-cols-[240px_minmax(0,1fr)_400px]">
                <div className="border-b border-ink-200 p-3 dark:border-ink-800 xl:border-b-0 xl:border-r">
                  <div className="space-y-2">
                    {files.map((file, index) => (
                      <button key={`${file.filename}-${index}`} className={cx(activeFile === index ? 'btn-primary' : 'btn-secondary', 'w-full justify-start py-1.5 text-xs')} onClick={() => setActiveFile(index)}>
                        <FileText className="h-3.5 w-3.5" /> {file.filename}
                      </button>
                    ))}
                  </div>
                </div>
                <pre className="max-h-[680px] overflow-auto bg-ink-950 p-4 text-xs leading-relaxed text-ink-50">
                  {selected?.content ?? ''}
                </pre>
                <div className="border-t border-ink-200 p-4 dark:border-ink-800 xl:border-l xl:border-t-0">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">Molecule viewer</h3>
                      <p className="text-xs text-ink-500">{viewerMolIndexes.length ? `${viewerMolIndexes.length} selected for 3D` : 'Pick molecules to render'}</p>
                    </div>
                    <Orbit className="h-5 w-5 text-pearl-600" />
                  </div>
                  <div className="mb-3 space-y-2">
                    {molecules.length ? (
                      molecules.map((mol, index) => (
                        <label key={`${mol.name}-${index}`} className={cx('flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs', viewerMolIndexes.includes(index) ? 'border-pearl-500 bg-pearl-50 text-pearl-800 dark:border-pearl-400 dark:bg-pearl-950/40 dark:text-pearl-100' : 'border-ink-200 text-ink-600 dark:border-ink-800 dark:text-ink-300')}>
                          <input type="checkbox" checked={viewerMolIndexes.includes(index)} onChange={() => toggleViewerMolecule(index)} />
                          <span>
                            <span className="block font-semibold">{mol.name}</span>
                            <span className="text-ink-500">{mol.coords.length} atoms - charge {mol.charge} - multiplicity {mol.multiplicity}</span>
                          </span>
                        </label>
                      ))
                    ) : (
                      <p className="rounded-lg border border-dashed border-ink-300 p-3 text-xs text-ink-400 dark:border-ink-700">No molecules loaded yet.</p>
                    )}
                  </div>
                  {render3d ? (
                    <div className={cx('grid gap-3', viewerMolIndexes.length > 1 && 'sm:grid-cols-2')}>
                      {viewerMolIndexes.map((index) => {
                        const mol = molecules[index]
                        if (!mol) return null
                        return (
                          <div key={`${mol.name}-${index}`} className="rounded-lg border border-ink-200 p-2 dark:border-ink-800">
                            <div className="mb-2 min-h-[36px]">
                              <p className="truncate text-xs font-semibold text-ink-900 dark:text-ink-50" title={mol.name}>{mol.name}</p>
                              <p className="text-[11px] text-ink-500">{mol.coords.length} atoms</p>
                            </div>
                            <Molecule3DViewer
                              sdf={null}
                              data={moleculeToXyz(mol)}
                              format="xyz"
                              heightClassName={viewerMolIndexes.length === 1 ? 'h-[420px]' : 'h-[220px]'}
                              emptyMessage="No coordinates loaded."
                            />
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="flex h-[360px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ink-300 p-4 text-center text-sm text-ink-400 dark:border-ink-700">
                      <Orbit className="h-7 w-7" />
                      <p>Select up to 4 molecules above, then render only those windows.</p>
                      <button type="button" className="btn-secondary" onClick={renderSelectedMolecules} disabled={!molecules.length || !viewerMolIndexes.length}>
                        <Rotate3D className="h-4 w-4" /> Render selected
                      </button>
                    </div>
                  )}
                </div>
              </div>
              </>
            )}
          </section>
        </main>
      </div>

      <datalist id="quantum-functionals">{FUNCTIONALS.map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="quantum-bases">{BASES.map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="quantum-solvents">{SOLVENTS.map((value) => <option key={value} value={value} />)}</datalist>
    </>
  )
}

function MoleculeList({ molecules, active, onSelect }: { molecules: QuantumMolecule[]; active: number; onSelect: (index: number) => void }) {
  if (!molecules.length) {
    return <div className="rounded-lg border border-dashed border-ink-300 p-4 text-sm text-ink-400 dark:border-ink-700">No molecules loaded yet.</div>
  }
  return (
    <div className="space-y-2">
      {molecules.map((mol, index) => (
        <button key={`${mol.name}-${index}`} className={cx(active === index ? 'btn-primary' : 'btn-secondary', 'w-full justify-start py-1.5 text-xs')} onClick={() => onSelect(index)}>
          {mol.name} - {mol.coords.length} atoms
        </button>
      ))}
    </div>
  )
}

function cleanNameValue(value: string, removePrefix: string, removeSuffix: string) {
  const fallback = value.replace(/\.[^.]+$/, '') || 'molecule'
  let next = fallback
  const prefix = removePrefix.trim()
  const suffix = removeSuffix.trim()
  if (prefix && next.toLowerCase().startsWith(prefix.toLowerCase())) next = next.slice(prefix.length)
  if (suffix) {
    const lower = next.toLowerCase()
    const lowerSuffix = suffix.toLowerCase()
    const candidates = [lowerSuffix, `_${lowerSuffix}`, `-${lowerSuffix}`]
    const atEnd = candidates.find((candidate) => lower.endsWith(candidate))
    if (atEnd) {
      next = next.slice(0, -atEnd.length)
    } else {
      const middle = lower.indexOf(lowerSuffix)
      if (middle >= 0) {
        const start = middle > 0 && ['_', '-', '.'].includes(next[middle - 1]) ? middle - 1 : middle
        const afterSuffix = middle + suffix.length
        const end = afterSuffix < next.length && ['_', '-', '.'].includes(next[afterSuffix]) ? afterSuffix + 1 : afterSuffix
        next = next.slice(0, start) + next.slice(end)
      }
    }
  }
  next = next.replace(/^[\s._-]+|[\s._-]+$/g, '')
  return next || fallback
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-800">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

function StatusTile({ label, value, good = false }: { label: string; value: string | number; good?: boolean }) {
  return (
    <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className={cx('mt-1 text-lg font-bold', good ? 'text-emerald-700 dark:text-emerald-300' : 'text-ink-900 dark:text-ink-50')}>{value}</p>
    </div>
  )
}
