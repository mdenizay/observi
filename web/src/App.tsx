import { Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AppShell } from '@/components/app-shell'
import { ErrorBoundary } from '@/components/error-boundary'
import { FullPageSpinner, RequireAuth, RequireSuperadmin } from '@/components/guards'
import { useTheme } from '@/hooks/use-theme'
import { setUnauthorizedHandler } from '@/lib/api'
import { lazyWithReload } from '@/lib/lazy'
import { LoginPage } from '@/pages/login'
import { NotFoundPage } from '@/pages/not-found'

// Route-level code splitting keeps login light.
const DashboardPage = lazyWithReload(() => import('@/pages/dashboard').then((m) => ({ default: m.DashboardPage })))
const MonitorFormPage = lazyWithReload(() => import('@/pages/monitor-form').then((m) => ({ default: m.MonitorFormPage })))
const NotificationsPage = lazyWithReload(() => import('@/pages/notifications').then((m) => ({ default: m.NotificationsPage })))
const SettingsPage = lazyWithReload(() => import('@/pages/settings').then((m) => ({ default: m.SettingsPage })))
const GroupsPage = lazyWithReload(() => import('@/pages/groups').then((m) => ({ default: m.GroupsPage })))
const UsersPage = lazyWithReload(() => import('@/pages/users').then((m) => ({ default: m.UsersPage })))

/** Sends the user to /login on any 401 (except on /login). */
function UnauthorizedBridge() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const path = location.pathname
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (path === '/login') return
      qc.setQueryData(['me'], null)
      navigate('/login', { replace: true, state: { from: path } })
    })
    return () => setUnauthorizedHandler(null)
  }, [navigate, path, qc])
  return null
}

export function App() {
  const { theme } = useTheme()
  const location = useLocation()
  return (
    <>
      <UnauthorizedBridge />
      <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/dashboard/:id" element={<DashboardPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route element={<RequireSuperadmin />}>
              <Route path="/monitors/new" element={<MonitorFormPage key="new" />} />
              <Route path="/monitors/:id/edit" element={<MonitorFormPage key="edit" />} />
              <Route path="/groups" element={<GroupsPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
      </Suspense>
      </ErrorBoundary>
      <Toaster theme={theme} position="top-right" richColors closeButton />
    </>
  )
}
