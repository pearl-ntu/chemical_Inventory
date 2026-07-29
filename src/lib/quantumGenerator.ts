export type QuantumSoftware = 'gaussian' | 'orca'
export type QuantumMode = 'single' | 'multiple' | 'full'
export type Scheduler = 'pbs' | 'slurm' | 'local'
export type StateType = 'singlet' | 'triplet' | 'mixed'

export interface QuantumMolecule {
  name: string
  charge: number
  multiplicity: number
  coords: string[]
}

export interface QuantumConfig {
  software: QuantumSoftware
  mode: QuantumMode
  step: number
  multiSteps: number[]
  method: string
  basis: string
  solventModel: 'none' | 'SMD' | 'PCM' | 'IEFPCM' | 'CPCM'
  solventName: string
  nproc: number
  memory: string
  scheduler: Scheduler
  queue: string
  walltime: string
  project: string
  account: string
  tdStates: number
  tdRoot: number
  stateType: StateType
  popFull: boolean
  dispersion: boolean
  socEnable: boolean
  redundantCoords: string
  manualRoutes: Record<number, string>
  customKeywords: string
  customBlock: string
  orcaPath: string
  maxcoreMb: number
  charge: number
  multiplicity: number
}

export interface GeneratedQuantumFile {
  filename: string
  content: string
  kind: 'input' | 'script' | 'manifest' | 'soc' | 'tict'
}

export interface TictConfig {
  axis: string
  branchA: string
  branchAStep: number
  branchB: string
  branchBStep: number
  steps: number
}

export const GAUSSIAN_STEPS = [
  [1, 'Ground-state optimization'],
  [2, 'Vertical excitation'],
  [3, 'cLR vertical correction'],
  [4, 'Excited-state optimization'],
  [5, 'Excited-state density'],
  [6, 'cLR excited correction'],
  [7, 'Ground energy at excited geometry'],
] as const

export const ORCA_STEPS = [
  [1, 'Ground-state optimization'],
  [2, 'Vertical excitation'],
  [4, 'Excited-state optimization'],
  [7, 'Ground energy at excited geometry'],
  [9, 'Custom step'],
] as const

export const FUNCTIONALS = ['m062x', 'b3lyp', 'cam-b3lyp', 'wb97xd', 'pbe0', 'tpssh', 'r2scan-3c']
export const BASES = ['def2SVP', 'def2TZVP', 'def2-TZVP', '6-31G(d)', '6-311G(d,p)', 'cc-pVDZ', 'cc-pVTZ']
export const SOLVENTS = ['DMSO', 'Water', 'Acetonitrile', 'Methanol', 'Ethanol', 'Toluene', 'THF', 'DCM', 'Chloroform']

export function sanitizeName(value: string) {
  return (value || 'molecule').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'molecule'
}

function sanitizeFilename(value: string) {
  let sanitized = value || ''
  for (const char of '<>:"/\\|?*') sanitized = sanitized.split(char).join('_')
  sanitized = sanitized.trim().replace(/^[. ]+|[. ]+$/g, '')
  while (sanitized.includes('__')) sanitized = sanitized.replace(/__/g, '_')
  return sanitized || 'molecule'
}

function coordRe() {
  return /^([A-Z][a-z]?)\s+[-+]?\d+(?:\.\d+)?(?:[Ee][-+]?\d+)?(?:\s+[-+]?\d+(?:\.\d+)?(?:[Ee][-+]?\d+)?){2}\s*$/
}

function isAtomCoordLine(line: string) {
  const match = line.match(coordRe())
  return Boolean(match && ELEMENT_SYMBOLS.has(match[1]))
}

export function parseCoordinateText(text: string, fallbackName = 'molecule'): QuantumMolecule | null {
  const lines = text.split(/\r?\n/)
  const clean = lines.map((line) => line.trim()).filter(Boolean)
  if (clean.length === 0) return null

  if (/Standard orientation|Input orientation|Charge\s*=\s*-?\d+\s+Multiplicity\s*=\s*\d+/i.test(text)) {
    const orientation = parseGaussianLog(text, fallbackName)
    if (orientation) return orientation
  }

  const xyzCount = Number(clean[0])
  if (Number.isFinite(xyzCount) && xyzCount > 0) {
    const xyzCoords = clean.slice(2, 2 + xyzCount).filter(isAtomCoordLine)
    if (xyzCoords.length > 0) return { name: sanitizeName(fallbackName), charge: 0, multiplicity: 1, coords: xyzCoords }
  }

  const cmIndex = lines.findIndex((line) => /^\s*-?\d+\s+\d+\s*$/.test(line))
  if (cmIndex >= 0) {
    const [charge, multiplicity] = lines[cmIndex].trim().split(/\s+/).map(Number)
    const gaussianCoords: string[] = []
    for (const line of lines.slice(cmIndex + 1)) {
      const trimmed = line.trim()
      if (!trimmed) break
      if (isAtomCoordLine(trimmed)) gaussianCoords.push(trimmed)
    }
    if (gaussianCoords.length > 0) return { name: sanitizeName(fallbackName), charge, multiplicity, coords: gaussianCoords }
  }

  const coords = clean.filter(isAtomCoordLine)
  if (coords.length > 0) return { name: sanitizeName(fallbackName), charge: 0, multiplicity: 1, coords }

  return null
}

export function parseGaussianLog(text: string, fallbackName = 'gaussian_log'): QuantumMolecule | null {
  const lines = text.split(/\r?\n/)
  const chargeLine = lines.find((line) => /Charge\s*=\s*-?\d+\s+Multiplicity\s*=\s*\d+/i.test(line))
  const charge = Number(chargeLine?.match(/Charge\s*=\s*(-?\d+)/i)?.[1] ?? 0)
  const multiplicity = Number(chargeLine?.match(/Multiplicity\s*=\s*(\d+)/i)?.[1] ?? 1)
  const blocks: string[][] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (!/Standard orientation|Input orientation/.test(lines[i])) continue
    const coords: string[] = []
    i += 5
    for (; i < lines.length; i += 1) {
      if (/^-+/.test(lines[i].trim())) break
      const parts = lines[i].trim().split(/\s+/)
      if (parts.length >= 6) {
        const symbol = atomicSymbol(Number(parts[1]))
        if (symbol) coords.push(`${symbol} ${parts[3]} ${parts[4]} ${parts[5]}`)
      }
    }
    if (coords.length) blocks.push(coords)
  }
  const coords = blocks[blocks.length - 1]
  return coords?.length ? { name: sanitizeName(fallbackName), charge, multiplicity, coords } : null
}

export function parseSmilesLines(text: string, charge = 0, multiplicity = 1): Array<{ name: string; smiles: string; charge: number; multiplicity: number }> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line, index) => {
      const parts = line.includes(':') ? line.split(':') : line.split(/\t+/)
      if (parts.length > 1) return { name: sanitizeName(parts[0]), smiles: parts.slice(1).join(':').trim(), charge, multiplicity }
      return { name: `molecule_${index + 1}`, smiles: line, charge, multiplicity }
    })
}

export function extractNamesFromSvgText(svg: string): string[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  return Array.from(doc.querySelectorAll('text, tspan'))
    .map((node) => node.textContent?.trim() ?? '')
    .filter((text) => text.length > 0 && !/^\d+$/.test(text))
}

export function moleculeToXyz(mol: QuantumMolecule | null | undefined) {
  if (!mol) return ''
  return [`${mol.coords.length}`, mol.name, ...mol.coords].join('\n')
}

function stepList(config: QuantumConfig) {
  if (config.software === 'gaussian') {
    if (config.mode === 'full') return GAUSSIAN_STEPS.map(([step]) => step)
  } else if (config.mode === 'full') {
    return ORCA_STEPS.map(([step]) => step)
  }
  if (config.mode === 'multiple' && config.multiSteps.length) return config.multiSteps
  return [config.step]
}

function solventTag(model: string, name: string) {
  return !model || ['none', 'vac', 'vacuum'].includes(model.toLowerCase()) ? 'vac' : (name ? name.toLowerCase() : 'solv')
}

function gaussianJobName(step: number, base: string, config: QuantumConfig) {
  return [
    String(step).padStart(2, '0'),
    sanitizeFilename(base),
    '_',
    sanitizeFilename(config.method),
    '_',
    sanitizeFilename(config.basis),
    '_',
    sanitizeFilename(solventTag(config.solventModel, config.solventName)),
  ].join('')
}

function orcaJobName(step: number, base: string, config: QuantumConfig) {
  return gaussianJobName(step, base, config)
}

function buildScrf(model: string, solvent: string, tail = '') {
  if (!model || ['none', 'vac', 'vacuum'].includes(model.toLowerCase())) return ''
  return [model, solvent ? `solvent=${solvent}` : '', tail].filter(Boolean).join(', ')
}

function tdBlock(config: QuantumConfig) {
  if (config.socEnable && config.stateType === 'singlet') return `TD(50-50,nstates=${config.tdStates})`
  if (config.stateType === 'triplet') return `TD(Triplets, NStates=${config.tdStates})`
  if (config.stateType === 'mixed') return `TD(50-50, NStates=${config.tdStates})`
  return `TD(NStates=${config.tdStates}, Root=${config.tdRoot})`
}

function routeLine(config: QuantumConfig, td = '', scrf = '', extras = '') {
  const tdPart = td ? ` ${td.startsWith('TD(') ? td : `TD=(${td})`}` : ''
  const scrfPart = scrf ? ` SCRF=(${scrf})` : ''
  const soc = config.socEnable ? ' 6D 10F GFInput' : ''
  return `# ${config.method}/${config.basis}${tdPart}${scrfPart}${soc} ${extras}`.replace(/\s+/g, ' ').trim()
}

export function gaussianRoute(step: number, config: QuantumConfig) {
  const manual = config.manualRoutes[step]?.trim()
  if (manual) return manual
  const pop = config.popFull ? ' pop=(full,orbitals=2,threshorbitals=1)' : ''
  const disp = config.dispersion ? ' EmpiricalDispersion=GD3BJ' : ''
  const scrf = buildScrf(config.solventModel, config.solventName)
  const scrfClr = buildScrf(config.solventModel, config.solventName, 'CorrectedLR')
  if (step === 1) return routeLine(config, '', scrf, `Opt Freq${pop}${disp}`)
  if (step === 2) return routeLine(config, tdBlock(config), scrf, `${pop}${disp}`)
  if (step === 3) return routeLine(config, tdBlock(config), scrfClr, `${pop}${disp}`)
  if (step === 4) return routeLine(config, tdBlock(config), scrf, config.socEnable ? disp.trim() : `Opt=CalcFC Freq${disp}`)
  if (step === 5) return routeLine(config, '', scrf, `density${pop}${disp}`)
  if (step === 6) return routeLine(config, tdBlock(config), scrfClr, disp.trim())
  if (step === 7) return routeLine(config, tdBlock(config), scrf, `${pop}${disp}`)
  return routeLine(config, '', scrf)
}

export function orcaRoute(step: number, config: QuantumConfig) {
  if (step === 9) return [config.customKeywords || `! ${config.method} ${config.basis} TightSCF`, config.customBlock].filter(Boolean).join('\n')
  const solvent = config.solventModel === 'none' ? '' : ` CPCM(${config.solventName})`
  const tda = ' TDA'
  if (step === 1) return `! ${config.method} ${config.basis} Opt Freq TightSCF${solvent}`
  if (step === 2) return `! ${config.method} ${config.basis} TightSCF${solvent}\n%tddft nroots ${config.tdStates}${tda} end`
  if (step === 4) return `! ${config.method} ${config.basis} Opt TightSCF${solvent}\n%tddft nroots ${config.tdStates} iroot ${Math.max(0, config.tdRoot - 1)}${tda} end`
  if (step === 7) return `! ${config.method} ${config.basis} TightSCF${solvent}`
  return `! ${config.method} ${config.basis} TightSCF${solvent}`
}

function schedulerScript(job: string, _input: string, config: QuantumConfig) {
  const runner = config.software === 'gaussian' ? `g16 < ${job}.com > ${job}.log` : `${config.orcaPath || 'orca'} ${job}.inp > ${job}.log`
  if (config.scheduler === 'pbs') {
    const mem = config.software === 'orca'
      ? `${Math.max(1, Math.floor((config.maxcoreMb * config.nproc) / 1024))}GB`
      : config.memory
    return [
      '#!/bin/bash',
      `#PBS -q ${config.queue}`,
      `#PBS -N ${job}`,
      `#PBS -l select=1:ncpus=${config.nproc}:mpiprocs=${config.nproc}:mem=${mem}`,
      config.walltime ? `#PBS -l walltime=${config.walltime}` : '',
      config.project ? `#PBS -P ${config.project}` : '',
      `#PBS -o ${job}.o`,
      `#PBS -e ${job}.e`,
      'cd $PBS_O_WORKDIR',
      runner,
      '',
    ].filter((line) => line !== '').join('\n')
  }
  if (config.scheduler === 'slurm') {
    const mem = config.software === 'orca'
      ? `${Math.max(1, Math.floor((config.maxcoreMb * config.nproc) / 1024))}G`
      : config.memory
    return [
      '#!/bin/bash',
      `#SBATCH -J ${job}`,
      `#SBATCH -p ${config.queue}`,
      '#SBATCH -N 1',
      `#SBATCH --ntasks=${config.nproc}`,
      `#SBATCH --mem=${mem}`,
      config.walltime ? `#SBATCH -t ${config.walltime}` : '',
      config.account ? `#SBATCH -A ${config.account}` : '',
      `#SBATCH -o ${job}.out`,
      `#SBATCH -e ${job}.err`,
      runner,
      '',
    ].filter((line) => line !== '').join('\n')
  }
  return ['#!/bin/bash', `${runner} &`, ''].join('\n')
}

function addRedundant(coords: string[], redundant: string, step: number) {
  if (!redundant.trim() || step !== 4) return coords
  return [...coords, '', redundant.trim()]
}

function gaussianTitle(step: number, config: QuantumConfig) {
  const stateLabel = config.stateType === 'triplet' ? 'Triplet' : config.stateType === 'mixed' ? 'Mixed' : 'Singlet'
  const titles: Record<number, string> = {
    1: 'Step1 GS Opt',
    2: `Step2 ${stateLabel} Abs`,
    3: `Step3 ${stateLabel} Abs cLR`,
    4: `Step4 ${stateLabel} ES Opt`,
    5: 'Step5 Density',
    6: `Step6 ${stateLabel} ES cLR`,
    7: `Step7 ${stateLabel} De-excitation`,
  }
  return `${titles[step] ?? `Step${step}`} ${config.method}/${config.basis}`
}

function gaussianComInline(job: string, route: string, title: string, cm: string, coords: string[], config: QuantumConfig) {
  return [
    `%nprocshared=${config.nproc}`,
    `%mem=${config.memory}`,
    `%chk=${job}.chk`,
    ...(config.socEnable ? [`%rwf=${job}.rwf`] : []),
    route,
    '',
    title,
    '',
    cm,
    ...coords,
    '',
    '',
  ].join('\n')
}

function gaussianComLinked(job: string, oldchk: string, route: string, title: string, cm: string, config: QuantumConfig) {
  return [
    `%nprocshared=${config.nproc}`,
    `%mem=${config.memory}`,
    `%oldchk=${oldchk}`,
    `%chk=${job}.chk`,
    ...(config.socEnable ? [`%rwf=${job}.rwf`] : []),
    route,
    '',
    title,
    '',
    cm,
    '',
    '',
  ].join('\n')
}

function gaussianInput(mol: QuantumMolecule, step: number, config: QuantumConfig, linked = false) {
  const job = gaussianJobName(step, mol.name, config)
  const cm = `${mol.charge} ${mol.multiplicity}`
  const route = gaussianRoute(step, config)
  const linkedRoute = `${route} geom=check guess=read`
  const oldchkStep = step === 7 ? 6 : step < 5 ? 1 : 4
  const oldchk = `${gaussianJobName(oldchkStep, mol.name, config)}.chk`
  const content = linked
    ? gaussianComLinked(job, oldchk, linkedRoute, gaussianTitle(step, config), cm, config)
    : gaussianComInline(job, route, gaussianTitle(step, config), cm, addRedundant(mol.coords, config.redundantCoords, step), config)
  return {
    filename: `${job}.com`,
    content,
    job,
  }
}

function orcaInput(mol: QuantumMolecule, step: number, config: QuantumConfig) {
  const job = orcaJobName(step, mol.name, config)
  return {
    filename: `${job}.inp`,
    content: orcaInputContent(mol, step, config),
    job,
  }
}

function orcaInputContent(mol: QuantumMolecule, step: number, config: QuantumConfig) {
  const lines = [
    ...orcaRoute(step, config).split('\n'),
    '%pal',
    `  nprocs ${config.nproc}`,
    'end',
    `%maxcore ${config.maxcoreMb}`,
    '',
    `* xyz ${mol.charge} ${mol.multiplicity}`,
    ...mol.coords,
    '*',
    '',
  ]
  return lines.join('\n')
}

export function generateTictFiles(mol: QuantumMolecule, config: TictConfig, software: QuantumSoftware): GeneratedQuantumFile[] {
  const axis = parseIndexList(config.axis)
  const branchA = parseIndexList(config.branchA)
  const branchB = parseIndexList(config.branchB)
  if (axis.length !== 2) throw new Error('TICT axis must contain exactly two atom numbers.')
  const atoms = mol.coords.map(parseAtomCoord)
  const center = atoms[axis[0]].xyz
  const vector = sub(atoms[axis[1]].xyz, atoms[axis[0]].xyz)
  if (norm(vector) === 0) throw new Error('TICT axis atoms are at the same position.')
  const files: GeneratedQuantumFile[] = []
  for (let i = 0; i <= config.steps; i += 1) {
    const rotated = atoms.map((atom) => ({ ...atom, xyz: [...atom.xyz] as Vec3 }))
    rotateBranch(rotated, branchA, vector, center, i * config.branchAStep)
    rotateBranch(rotated, branchB, vector, center, i * config.branchBStep)
    const coords = rotated.map((atom) => `${atom.symbol} ${atom.xyz.map((v) => v.toFixed(6)).join(' ')}`)
    const base = `${sanitizeName(mol.name)}_tict_${String(i).padStart(3, '0')}`
    files.push({
      filename: software === 'orca' ? `${base}.xyz` : `${base}.com`,
      kind: 'tict',
      content: software === 'orca'
        ? [`${coords.length}`, `TICT rotation step ${i}`, ...coords, ''].join('\n')
        : [`%chk=${base}.chk`, '# generated TICT geometry', '', `${mol.name} TICT rotation step ${i}`, '', `${mol.charge} ${mol.multiplicity}`, ...coords, ''].join('\n'),
    })
  }
  return files
}

export function generatePysocFiles(config: QuantumConfig): GeneratedQuantumFile[] {
  const run = [
    '#!/bin/bash',
    'set -e',
    'for logfile in *_SOC.log; do',
    '  [ -f "$logfile" ] || continue',
    '  base="${logfile%_SOC.log}"',
    '  echo "Running PySOC for $logfile"',
    '  pysoc "$logfile" > "${base}_pysoc.out"',
    'done',
    '',
  ].join('\n')
  const combine = [
    '#!/usr/bin/env python3',
    'from pathlib import Path',
    'import csv',
    'rows = []',
    'for path in sorted(Path(".").glob("*_pysoc*.csv")):',
    '    with path.open(newline="") as handle:',
    '        for row in csv.DictReader(handle):',
    '            row["source_file"] = path.name',
    '            rows.append(row)',
    'if rows:',
    '    keys = sorted({key for row in rows for key in row})',
    '    with open("PySOC_Combined_Results.csv", "w", newline="") as handle:',
    '        writer = csv.DictWriter(handle, fieldnames=keys)',
    '        writer.writeheader()',
    '        writer.writerows(rows)',
    '',
  ].join('\n')
  return [
    { filename: 'run_pysoc.sh', kind: 'soc', content: schedulerWrapper('run_pysoc', run, config) },
    { filename: 'combine_pysoc_results.py', kind: 'soc', content: combine },
  ]
}

export function generateQuantumFiles(molecules: QuantumMolecule[], config: QuantumConfig): GeneratedQuantumFile[] {
  const files: GeneratedQuantumFile[] = []
  const steps = stepList(config)
  const jobsByStep = new Map<number, string[]>()
  const allJobs: string[] = []
  for (const mol of molecules) {
    for (const step of steps) {
      const linked = config.software === 'gaussian' && config.mode === 'full' && step !== 1
      const input = config.software === 'gaussian' ? gaussianInput(mol, step, config, linked) : orcaInput(mol, step, config)
      files.push({ filename: input.filename, content: input.content, kind: 'input' })
      files.push({ filename: `${input.job}.sh`, content: schedulerScript(input.job, input.filename, config), kind: 'script' })
      allJobs.push(input.job)
      jobsByStep.set(step, [...(jobsByStep.get(step) ?? []), input.job])
    }
  }
  files.push(...generateSubmissionHelpers(jobsByStep, allJobs, config))
  if (config.socEnable && config.software === 'gaussian') files.push(...generatePysocFiles(config))
  files.push({
    filename: 'pearl_quantum_manifest.json',
    kind: 'manifest',
    content: JSON.stringify({
      generated_at: new Date().toISOString(),
      software: config.software,
      mode: config.mode,
      steps,
      method: config.method,
      basis: config.basis,
      solvent: config.solventModel === 'none' ? 'gas phase' : `${config.solventModel} ${config.solventName}`,
      scheduler: config.scheduler,
      molecules: molecules.map((mol) => ({ name: mol.name, atoms: mol.coords.length, charge: mol.charge, multiplicity: mol.multiplicity })),
      files: files.map((file) => file.filename),
    }, null, 2),
  })
  return files
}

function submitCommand(job: string, config: QuantumConfig) {
  if (config.scheduler === 'pbs') return `qsub ${job}.sh`
  if (config.scheduler === 'slurm') return `sbatch ${job}.sh`
  return `bash ${job}.sh`
}

function shellScript(lines: string[]) {
  return ['#!/bin/bash', ...lines, ''].join('\n')
}

function generateSubmissionHelpers(jobsByStep: Map<number, string[]>, allJobs: string[], config: QuantumConfig): GeneratedQuantumFile[] {
  if (!allJobs.length) return []
  const helpers: GeneratedQuantumFile[] = [
    {
      filename: 'submit_all.sh',
      kind: 'script',
      content: shellScript(allJobs.map((job) => submitCommand(job, config))),
    },
  ]
  for (const step of Array.from(jobsByStep.keys()).sort((a, b) => a - b)) {
    const jobs = jobsByStep.get(step) ?? []
    if (!jobs.length) continue
    const prefix = String(step).padStart(2, '0')
    helpers.push({
      filename: `${prefix}sub.sh`,
      kind: 'script',
      content: shellScript(jobs.map((job) => submitCommand(job, config))),
    })
    helpers.push({
      filename: `${prefix}.sh`,
      kind: 'script',
      content: shellScript(jobs.map((job) => submitCommand(job, config))),
    })
    if (config.software === 'gaussian') {
      helpers.push({
        filename: `${prefix}formchk.sh`,
        kind: 'script',
        content: shellScript(jobs.map((job) => `formchk ${job}.chk`)),
      })
    }
  }
  return helpers
}

function schedulerWrapper(job: string, body: string, config: QuantumConfig) {
  if (config.scheduler === 'pbs') return ['#!/bin/bash', `#PBS -q ${config.queue}`, `#PBS -N ${job}`, `#PBS -l walltime=${config.walltime}`, 'cd "$PBS_O_WORKDIR"', body].join('\n')
  if (config.scheduler === 'slurm') return ['#!/bin/bash', `#SBATCH -J ${job}`, `#SBATCH -p ${config.queue}`, `#SBATCH -t ${config.walltime}`, body].join('\n')
  return body
}

type Vec3 = [number, number, number]

function parseIndexList(value: string) {
  return value.split(/[,\s]+/).map((part) => Number(part.trim()) - 1).filter((n) => Number.isInteger(n) && n >= 0)
}

function parseAtomCoord(line: string) {
  const [symbol, x, y, z] = line.trim().split(/\s+/)
  return { symbol, xyz: [Number(x), Number(y), Number(z)] as Vec3 }
}

function rotateBranch(atoms: Array<{ symbol: string; xyz: Vec3 }>, indices: number[], axis: Vec3, center: Vec3, degrees: number) {
  if (!degrees) return
  const theta = degrees * Math.PI / 180
  const u = normalize(axis)
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  for (const index of indices) {
    if (!atoms[index]) continue
    const p = sub(atoms[index].xyz, center)
    const rotated = add(add(scale(p, cos), scale(cross(u, p), sin)), scale(u, dot(u, p) * (1 - cos)))
    atoms[index].xyz = add(rotated, center)
  }
}

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function scale(a: Vec3, s: number): Vec3 { return [a[0] * s, a[1] * s, a[2] * s] }
function dot(a: Vec3, b: Vec3) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function norm(a: Vec3) { return Math.sqrt(dot(a, a)) }
function normalize(a: Vec3): Vec3 {
  const n = norm(a)
  return n === 0 ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n]
}

function atomicSymbol(n: number) {
  return ELEMENT_SYMBOL_LIST[n] ?? null
}

const ELEMENT_SYMBOL_LIST = ['', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr']
const ELEMENT_SYMBOLS = new Set(ELEMENT_SYMBOL_LIST.filter(Boolean))
