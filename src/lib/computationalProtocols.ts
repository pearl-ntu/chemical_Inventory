import type { QuantumMode, QuantumSoftware, Scheduler, StateType } from './quantumGenerator'

export interface ComputationalProtocol {
  id: string
  title: string
  software: QuantumSoftware
  method: string
  basis: string
  solventModel: 'none' | 'SMD' | 'PCM' | 'IEFPCM' | 'CPCM'
  solventName: string
  mode: QuantumMode
  step: number
  multiSteps: number[]
  scheduler: Scheduler
  queue: string
  nproc: number
  memory: string
  maxcoreMb: number
  walltime: string
  project: string
  tdStates: number
  tdRoot: number
  stateType: StateType
  popFull: boolean
  dispersion: boolean
  socEnable: boolean
  notes: string
  tags: string[]
  updatedAt: string
}

export type ComputationalProtocolInput = Omit<ComputationalProtocol, 'id' | 'updatedAt'>

const BASE_KEY = 'pearl.computational.protocols'
export const ACTIVE_PROTOCOL_KEY = 'pearl.computational.active_protocol'

export const PROTOCOL_PRESETS: ComputationalProtocolInput[] = [
  {
    title: 'Gaussian TD-DFT emission workflow',
    software: 'gaussian',
    method: 'm062x',
    basis: 'def2SVP',
    solventModel: 'SMD',
    solventName: 'DMSO',
    mode: 'full',
    step: 4,
    multiSteps: [1, 2, 4, 7],
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
    notes: 'Ground-state optimization, vertical excitation, excited-state optimization, then ground energy at excited geometry.',
    tags: ['gaussian', 'tddft', 'emission'],
  },
  {
    title: 'ORCA r2SCAN-3c quick optimization',
    software: 'orca',
    method: 'r2SCAN-3c',
    basis: 'def2-mTZVPP',
    solventModel: 'none',
    solventName: '',
    mode: 'single',
    step: 1,
    multiSteps: [1],
    scheduler: 'pbs',
    queue: 'normal',
    nproc: 32,
    memory: '64GB',
    maxcoreMb: 3000,
    walltime: '12:00:00',
    project: '15002108',
    tdStates: 3,
    tdRoot: 1,
    stateType: 'singlet',
    popFull: false,
    dispersion: false,
    socEnable: false,
    notes: 'Fast geometry pre-optimization before higher-level Gaussian or ORCA TD-DFT.',
    tags: ['orca', 'preopt', 'r2scan-3c'],
  },
  {
    title: 'Gaussian SOC preparation',
    software: 'gaussian',
    method: 'cam-b3lyp',
    basis: 'def2TZVP',
    solventModel: 'SMD',
    solventName: 'DMSO',
    mode: 'multiple',
    step: 4,
    multiSteps: [2, 4, 5],
    scheduler: 'pbs',
    queue: 'normal',
    nproc: 64,
    memory: '128GB',
    maxcoreMb: 4000,
    walltime: '24:00:00',
    project: '15002108',
    tdStates: 6,
    tdRoot: 1,
    stateType: 'mixed',
    popFull: true,
    dispersion: false,
    socEnable: true,
    notes: 'Mixed singlet/triplet TD workflow with extra Gaussian output useful for downstream SOC preparation.',
    tags: ['gaussian', 'soc', 'tddft'],
  },
]

function storageKey(profileId: string | null | undefined) {
  return `${BASE_KEY}:${profileId || 'local'}`
}

function makeId() {
  return `protocol-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`
}

export function loadProtocols(profileId: string | null | undefined): ComputationalProtocol[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(profileId)) || '[]') as ComputationalProtocol[]
    if (Array.isArray(saved) && saved.length) return saved
  } catch {
    /* fall through to presets */
  }
  return PROTOCOL_PRESETS.map((preset, index) => ({
    ...preset,
    id: `preset-${index + 1}`,
    updatedAt: new Date().toISOString(),
  }))
}

export function saveProtocols(profileId: string | null | undefined, rows: ComputationalProtocol[]) {
  localStorage.setItem(storageKey(profileId), JSON.stringify(rows))
}

export function createProtocol(input: ComputationalProtocolInput): ComputationalProtocol {
  return { ...input, id: makeId(), updatedAt: new Date().toISOString() }
}

export function activateProtocol(protocol: ComputationalProtocol) {
  localStorage.setItem(ACTIVE_PROTOCOL_KEY, JSON.stringify(protocol))
}

export function consumeActiveProtocol(): ComputationalProtocol | null {
  try {
    const raw = localStorage.getItem(ACTIVE_PROTOCOL_KEY)
    if (!raw) return null
    localStorage.removeItem(ACTIVE_PROTOCOL_KEY)
    return JSON.parse(raw) as ComputationalProtocol
  } catch {
    return null
  }
}
