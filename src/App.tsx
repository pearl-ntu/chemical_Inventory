import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/Layout'
import { PiConsoleLayout } from './components/PiConsoleLayout'
import { SiteCredit } from './components/SiteCredit'
import { LoadingScreen } from './components/ui'
import { useAuth } from './context/AuthContext'
import { InventoryProvider } from './context/InventoryContext'
import DashboardPage from './pages/DashboardPage'
import PendingApprovalPage from './pages/PendingApprovalPage'

// Every route below except the dashboard (the universal landing page) is
// lazy — nobody pays for the PI console, the computational workspace, or
// the structure/CSV-heavy pages until they actually navigate there.
const ActivityPage = lazy(() => import('./pages/ActivityPage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))
const ComputationalActivityPage = lazy(() => import('./pages/ComputationalActivityPage'))
const ComputationalAnalyticsPage = lazy(() => import('./pages/ComputationalAnalyticsPage'))
const ComputationalDashboardPage = lazy(() => import('./pages/ComputationalDashboardPage'))
const ComputationalWorkbenchPage = lazy(() => import('./pages/ComputationalWorkbenchPage'))
const ComputationalJobsPage = lazy(() => import('./pages/ComputationalJobsPage'))
const ComputationalProtocolsPage = lazy(() => import('./pages/ComputationalProtocolsPage'))
const ContactDeveloperPage = lazy(() => import('./pages/ContactDeveloperPage'))
const EquipmentPage = lazy(() => import('./pages/EquipmentPage'))
const FeedPage = lazy(() => import('./pages/FeedPage'))
const IncidentsPage = lazy(() => import('./pages/IncidentsPage'))
const SopsPage = lazy(() => import('./pages/SopsPage'))
const HpcSyncPage = lazy(() => import('./pages/HpcSyncPage'))
const HpcTutorialPage = lazy(() => import('./pages/HpcTutorialPage'))
const InventoryPage = lazy(() => import('./pages/InventoryPage'))
const LabelsPage = lazy(() => import('./pages/LabelsPage'))
const LocationsPage = lazy(() => import('./pages/LocationsPage'))
const MembersPage = lazy(() => import('./pages/MembersPage'))
const OperationsPage = lazy(() => import('./pages/OperationsPage'))
const PiDashboardPage = lazy(() => import('./pages/PiDashboardPage'))
const PiAnalyticsPage = lazy(() => import('./pages/PiAnalyticsPage'))
const PiReportPage = lazy(() => import('./pages/PiReportPage'))
const PiMemberProfilePage = lazy(() => import('./pages/PiMemberProfilePage'))
const PiMembersPage = lazy(() => import('./pages/PiMembersPage'))
const PiProjectDetailPage = lazy(() => import('./pages/PiProjectDetailPage'))
const PiProjectsPage = lazy(() => import('./pages/PiProjectsPage'))
const ProjectMapPage = lazy(() => import('./pages/ProjectMapPage'))
const ResearchAssetsPage = lazy(() => import('./pages/ResearchAssetsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const StocktakePage = lazy(() => import('./pages/StocktakePage'))

// The login page pulls in `ogl` for its WebGL button shine — real weight
// that a signed-in visitor should never pay for on every load, only someone
// who's actually looking at the sign-in screen.
const LoginPage = lazy(() => import('./pages/LoginPage'))

export default function App() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <AppContent />
      </div>
      <SiteCredit />
    </div>
  )
}

function AppContent() {
  const { profile, loading, isPi } = useAuth()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingScreen label="Opening the inventory…" />
      </div>
    )
  }

  if (!profile) {
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <LoadingScreen label="Opening the inventory…" />
          </div>
        }
      >
        <LoginPage />
      </Suspense>
    )
  }

  // Signed in, but not let in yet — don't even mount the inventory shell:
  // every query it would make is blocked by RLS anyway, so there's nothing
  // useful to show except why.
  if (!profile.approved) return <PendingApprovalPage />

  return (
    <InventoryProvider>
      <Suspense fallback={<div className="flex h-full items-center justify-center"><LoadingScreen label="Loading…" /></div>}>
      <Routes>
        {isPi && (
          <Route path="pi-dashboard" element={<PiConsoleLayout />}>
            <Route index element={<PiDashboardPage />} />
            <Route path="projects" element={<PiProjectsPage />} />
            <Route path="projects/:id" element={<PiProjectDetailPage />} />
            <Route path="members" element={<PiMembersPage />} />
            <Route path="members/:id" element={<PiMemberProfilePage />} />
            <Route path="analytics" element={<PiAnalyticsPage />} />
            <Route path="report" element={<PiReportPage />} />
          </Route>
        )}
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="stocktake" element={<StocktakePage />} />
          <Route path="locations" element={<LocationsPage />} />
          <Route path="project-map" element={<ProjectMapPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="computational" element={<ComputationalDashboardPage />} />
          <Route path="computational/workbench" element={<ComputationalWorkbenchPage />} />
          <Route path="computational/protocols" element={<ComputationalProtocolsPage />} />
          <Route path="computational/project-map" element={<ProjectMapPage workspace="computational" />} />
          <Route path="computational/jobs" element={<ComputationalJobsPage />} />
          <Route path="computational/analytics" element={<ComputationalAnalyticsPage />} />
          <Route path="computational/activity" element={<ComputationalActivityPage />} />
          <Route path="computational/hpc-sync" element={<HpcSyncPage />} />
          <Route path="computational/hpc-tutorial" element={<HpcTutorialPage />} />
          <Route path="computational/storage" element={<Navigate to="/computational/hpc-sync" replace />} />
          <Route path="operations" element={<OperationsPage />} />
          <Route path="equipment" element={<EquipmentPage />} />
          <Route path="sops" element={<SopsPage />} />
          <Route path="incidents" element={<IncidentsPage />} />
          <Route path="research-assets" element={<ResearchAssetsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="labels" element={<LabelsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="contact-developer" element={<ContactDeveloperPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="feed" element={<FeedPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </Suspense>
    </InventoryProvider>
  )
}
