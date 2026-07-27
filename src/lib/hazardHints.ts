/**
 * Curated hazard *suggestions* for chemicals that turn up in nearly every
 * synthetic lab. These are prompts for the person filling in the form — the app
 * never applies them silently, and the UI states plainly that the SDS is the
 * authority. Small and hand-checked on purpose: a long, half-verified list
 * would be worse than none.
 */
import type { Hazard } from './types'

interface Hint {
  hazards: Hazard[]
  storageClass: string
  note?: string
}

const BY_CAS: Record<string, Hint> = {
  '75-05-8': { hazards: ['Flammable', 'Irritant', 'Acute toxic'], storageClass: 'Flammable solvent' }, // Acetonitrile
  '67-56-1': { hazards: ['Flammable', 'Acute toxic', 'Health hazard'], storageClass: 'Flammable solvent' }, // Methanol
  '64-17-5': { hazards: ['Flammable', 'Irritant'], storageClass: 'Flammable solvent' }, // Ethanol
  '67-64-1': { hazards: ['Flammable', 'Irritant'], storageClass: 'Flammable solvent' }, // Acetone
  '109-99-9': {
    hazards: ['Flammable', 'Irritant', 'Health hazard'],
    storageClass: 'Flammable solvent',
    note: 'Peroxide former — check date opened before distilling.',
  }, // THF
  '60-29-7': {
    hazards: ['Flammable', 'Irritant'],
    storageClass: 'Flammable solvent',
    note: 'Peroxide former — do not evaporate to dryness.',
  }, // Diethyl ether
  '75-09-2': { hazards: ['Health hazard', 'Irritant'], storageClass: 'Halogenated solvent' }, // DCM
  '67-66-3': { hazards: ['Health hazard', 'Acute toxic', 'Irritant'], storageClass: 'Halogenated solvent' }, // Chloroform
  '110-54-3': { hazards: ['Flammable', 'Health hazard', 'Environmental'], storageClass: 'Flammable solvent' }, // Hexane
  '108-88-3': { hazards: ['Flammable', 'Health hazard', 'Irritant'], storageClass: 'Flammable solvent' }, // Toluene
  '110-83-8': { hazards: ['Flammable', 'Irritant', 'Environmental'], storageClass: 'Flammable solvent' }, // Cyclohexane
  '141-78-6': { hazards: ['Flammable', 'Irritant'], storageClass: 'Flammable solvent' }, // Ethyl acetate
  '68-12-2': { hazards: ['Flammable', 'Health hazard', 'Irritant'], storageClass: 'Flammable solvent' }, // DMF
  '67-68-5': { hazards: ['Irritant'], storageClass: 'Solvent' }, // DMSO
  '7647-01-0': { hazards: ['Corrosive', 'Irritant'], storageClass: 'Acid cabinet' }, // HCl
  '7664-93-9': { hazards: ['Corrosive'], storageClass: 'Acid cabinet' }, // Sulfuric acid
  '7697-37-2': { hazards: ['Corrosive', 'Oxidising'], storageClass: 'Acid cabinet — segregate from organics' }, // Nitric acid
  '1310-73-2': { hazards: ['Corrosive'], storageClass: 'Base cabinet' }, // NaOH
  '1310-58-3': { hazards: ['Corrosive'], storageClass: 'Base cabinet' }, // KOH
  '81-86-7': {
    hazards: ['Explosive', 'Acute toxic', 'Health hazard'],
    storageClass: 'Explosive — keep wetted',
    note: 'Must be kept wetted (>30% water). Never let it dry out.',
  }, // Picric acid
  '7778-53-2': { hazards: ['Corrosive', 'Irritant'], storageClass: 'Base cabinet' }, // K3PO4
  '57-11-4': { hazards: ['Irritant'], storageClass: 'General solid' }, // Stearic acid
  '7440-44-0': { hazards: [], storageClass: 'General solid' },
  '1333-74-0': { hazards: ['Flammable', 'Compressed gas'], storageClass: 'Gas cylinder' }, // Hydrogen
  '16940-66-2': {
    hazards: ['Flammable', 'Corrosive', 'Acute toxic'],
    storageClass: 'Water-reactive — dry store',
    note: 'Water-reactive: evolves hydrogen. Keep away from moisture.',
  }, // NaBH4
  '16853-85-3': {
    hazards: ['Flammable', 'Corrosive'],
    storageClass: 'Water-reactive — dry store',
    note: 'Violently water-reactive. Quench with care.',
  }, // LiAlH4
  '108-95-2': { hazards: ['Corrosive', 'Acute toxic', 'Health hazard'], storageClass: 'Toxic cabinet' }, // Phenol
  '7722-84-1': { hazards: ['Oxidising', 'Corrosive'], storageClass: 'Oxidiser — segregate' }, // H2O2
  '7681-52-9': { hazards: ['Oxidising', 'Corrosive', 'Environmental'], storageClass: 'Oxidiser — segregate' },
  '110-86-1': { hazards: ['Flammable', 'Irritant'], storageClass: 'Flammable solvent' }, // Pyridine
  '75-15-0': { hazards: ['Flammable', 'Health hazard', 'Irritant'], storageClass: 'Flammable solvent' }, // CS2
}

/** Name fragments, used only when the CAS number is missing or unknown. */
const BY_NAME: Array<[RegExp, Hint]> = [
  [/\bazide\b/i, { hazards: ['Explosive', 'Acute toxic'], storageClass: 'Explosive — segregate from acids' }],
  [/\bperchlorat/i, { hazards: ['Oxidising', 'Explosive'], storageClass: 'Oxidiser — segregate' }],
  [/\bperoxide\b/i, { hazards: ['Oxidising', 'Corrosive'], storageClass: 'Oxidiser — segregate' }],
  [/\bcyanide\b/i, { hazards: ['Acute toxic', 'Environmental'], storageClass: 'Toxic cabinet — locked' }],
  [/\bbutyllithium|\bn-buli\b/i, { hazards: ['Flammable', 'Corrosive'], storageClass: 'Pyrophoric — under inert gas' }],
  [/\bacid chloride|\bchloroformate\b/i, { hazards: ['Corrosive', 'Acute toxic'], storageClass: 'Moisture-sensitive' }],
  [/\banhydride\b/i, { hazards: ['Corrosive', 'Irritant'], storageClass: 'Moisture-sensitive' }],
  [/\bbromo|\biodo/i, { hazards: ['Irritant'], storageClass: 'General organic' }],
  [/-D\b|-d6\b|deuterat/i, { hazards: [], storageClass: 'NMR solvent — fridge' }],
]

export function hazardHint(cas: string | null, name: string | null): Hint | null {
  if (cas) {
    const hit = BY_CAS[cas.trim()]
    if (hit) return hit
  }
  if (name) {
    for (const [re, hint] of BY_NAME) {
      if (re.test(name)) return hint
    }
  }
  return null
}

/** Storage groups that should never share a shelf. Powers the segregation check. */
export const INCOMPATIBLE_PAIRS: Array<[string, string, string]> = [
  ['Flammable', 'Oxidising', 'Flammables stored with oxidisers is a fire risk.'],
  ['Acute toxic', 'Flammable', 'Keep acutely toxic material out of the flammables store.'],
  ['Corrosive', 'Flammable', 'Acids/bases can breach flammable containers.'],
  ['Explosive', 'Flammable', 'Explosives must be segregated from all fuel sources.'],
  ['Explosive', 'Oxidising', 'Explosives must be segregated from oxidisers.'],
]
