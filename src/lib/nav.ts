import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookMarked,
  BookOpen,
  Bot,
  Camera,
  ClipboardList,
  Database,
  ListChecks,
  GitBranch,
  FlaskConical,
  LayoutDashboard,
  MapPin,
  QrCode,
  Server,
  Microscope,
} from 'lucide-react'

/** The two side-nav lists, kept in one place so anything that needs "every
 *  page in the app" (the sidebar, the command palette) reads the same list
 *  rather than maintaining a second copy that drifts. */
export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inventory', label: 'Inventory', icon: FlaskConical, end: false },
  { to: '/stocktake', label: 'Stocktake', icon: Camera, end: false },
  { to: '/locations', label: 'Locations', icon: MapPin, end: false },
  { to: '/project-map', label: 'Project Map', icon: GitBranch, end: false },
  { to: '/operations', label: 'Operations', icon: ClipboardList, end: false },
  { to: '/equipment', label: 'Equipment', icon: Microscope, end: false },
  { to: '/sops', label: 'SOPs', icon: BookOpen, end: false },
  { to: '/incidents', label: 'Incidents', icon: AlertTriangle, end: false },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, end: false },
  { to: '/activity', label: 'Activity', icon: Activity, end: false },
  { to: '/labels', label: 'QR labels', icon: QrCode, end: false },
]

export const COMPUTATIONAL_NAV = [
  { to: '/computational', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/computational/workbench', label: 'Workbench', icon: Bot, end: false },
  { to: '/computational/protocols', label: 'Method Library', icon: BookMarked, end: false },
  { to: '/research-assets', label: 'Research Assets', icon: Database, end: false },
  { to: '/computational/project-map', label: 'Project Map', icon: GitBranch, end: false },
  { to: '/computational/jobs', label: 'Job Monitor', icon: ListChecks, end: false },
  { to: '/computational/hpc-sync', label: 'Linux/HPC Sync', icon: Server, end: false },
  { to: '/computational/hpc-tutorial', label: 'HPC Tutorial', icon: BookOpen, end: false },
  { to: '/computational/analytics', label: 'Analytics', icon: BarChart3, end: false },
  { to: '/computational/activity', label: 'Activity', icon: Activity, end: false },
]
