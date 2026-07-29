export type AppearanceTheme = 'pearl' | 'emerald' | 'violet' | 'ruby'

export const APPEARANCE_THEME_KEY = 'pearl.appearance_theme'

export const APPEARANCE_THEMES: Array<{
  id: AppearanceTheme
  name: string
  description: string
  swatches: string[]
}> = [
  {
    id: 'pearl',
    name: 'PEARL blue',
    description: 'Clean lab default with the current PEARL identity.',
    swatches: ['#eef4ff', '#3b73f0', '#182f68'],
  },
  {
    id: 'emerald',
    name: 'Emerald lab',
    description: 'Fresh green accents for a calm instrument-room feel.',
    swatches: ['#ecfdf5', '#10b981', '#064e3b'],
  },
  {
    id: 'violet',
    name: 'Violet dusk',
    description: 'Soft purple-blue accents for computational work.',
    swatches: ['#f5f3ff', '#7c3aed', '#312e81'],
  },
  {
    id: 'ruby',
    name: 'Ruby safety',
    description: 'Warmer red accents for safety-heavy workflows.',
    swatches: ['#fff1f2', '#e11d48', '#881337'],
  },
]

export function getStoredAppearanceTheme(): AppearanceTheme {
  try {
    const value = localStorage.getItem(APPEARANCE_THEME_KEY)
    return APPEARANCE_THEMES.some((theme) => theme.id === value)
      ? (value as AppearanceTheme)
      : 'pearl'
  } catch {
    return 'pearl'
  }
}

export function applyAppearanceTheme(theme: AppearanceTheme) {
  document.documentElement.dataset.theme = theme
}

export function saveAppearanceTheme(theme: AppearanceTheme) {
  try {
    localStorage.setItem(APPEARANCE_THEME_KEY, theme)
  } catch {
    /* visual change still applies for this session */
  }
  applyAppearanceTheme(theme)
}
