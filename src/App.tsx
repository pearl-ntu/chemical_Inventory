import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/Layout'
import { LoadingScreen } from './components/ui'
import { useAuth } from './context/AuthContext'
import { InventoryProvider } from './context/InventoryContext'
import ActivityPage from './pages/ActivityPage'
import AnalyticsPage from './pages/AnalyticsPage'
import DashboardPage from './pages/DashboardPage'
import InventoryPage from './pages/InventoryPage'
import LabelsPage from './pages/LabelsPage'
import LocationsPage from './pages/LocationsPage'
import MembersPage from './pages/MembersPage'
import PendingApprovalPage from './pages/PendingApprovalPage'
import SetPasswordPage from './pages/SetPasswordPage'
import SettingsPage from './pages/SettingsPage'

// The login page pulls in `ogl` for its WebGL button shine — real weight
// that a signed-in visitor should never pay for on every load, only someone
// who's actually looking at the sign-in screen.
const LoginPage = lazy(() => import('./pages/LoginPage'))

export default function App() {
  const { profile, loading } = useAuth()

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

  // A magic-link/invite sign-in with no password set yet — one-time detour
  // before anything else, so the email link isn't the only way back in.
  if (!profile.has_password) return <SetPasswordPage />

  // Signed in, but not let in yet — don't even mount the inventory shell:
  // every query it would make is blocked by RLS anyway, so there's nothing
  // useful to show except why.
  if (!profile.approved) return <PendingApprovalPage />

  return (
    <InventoryProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="locations" element={<LocationsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="labels" element={<LabelsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </InventoryProvider>
  )
}
