import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/Layout'
import { LoadingScreen } from './components/ui'
import { useAuth } from './context/AuthContext'
import { InventoryProvider } from './context/InventoryContext'
import ActivityPage from './pages/ActivityPage'
import AnalyticsPage from './pages/AnalyticsPage'
import ApprovalsPage from './pages/ApprovalsPage'
import DashboardPage from './pages/DashboardPage'
import InventoryPage from './pages/InventoryPage'
import LabelsPage from './pages/LabelsPage'
import LocationsPage from './pages/LocationsPage'
import LoginPage from './pages/LoginPage'
import MembersPage from './pages/MembersPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  const { profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingScreen label="Opening the inventory…" />
      </div>
    )
  }

  if (!profile) return <LoginPage />

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
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </InventoryProvider>
  )
}
