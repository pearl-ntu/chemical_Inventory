import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { applyAppearanceTheme, getStoredAppearanceTheme } from './lib/appearance'
import { supabase } from './lib/supabase'
import './index.css'

/**
 * A dead link — expired, or (very commonly with a university/corporate email
 * gateway) already used up by a security scanner that pre-fetches links
 * before a human ever clicks them — comes back as `#error=access_denied&
 * error_code=otp_expired&...` instead of a real token. Pulled out here and
 * stashed for LoginPage to show, then stripped from the hash before
 * HashRouter can misread it as a route (same reasoning as the token-race
 * comment below).
 */
function captureAuthErrorFromUrl() {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash.includes('error=')) return
  const params = new URLSearchParams(hash)
  const code = params.get('error_code')
  const message =
    code === 'otp_expired'
      ? 'That link no longer works — it may have already been used (some email security gateways open links automatically to scan them) or it expired. Request a new one.'
      : (params.get('error_description')?.replace(/\+/g, ' ') ?? 'That sign-in link no longer works. Request a new one.')
  sessionStorage.setItem('pearl.auth_error', message)
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
}

/**
 * A magic-link or invite email lands back here with the session tokens in
 * the URL hash (`#access_token=...&type=magiclink`). HashRouter reads that
 * same `location.hash` to pick its route, synchronously, on first render —
 * racing Supabase's own token detection, which is async. If the router wins,
 * it treats the token string as an unmatched route and redirects away before
 * Supabase ever reads it, so the link looks like it did nothing. Awaiting
 * `getSession()` blocks on Supabase's internal URL handling (which also
 * strips the tokens from the URL once consumed), so HashRouter never mounts
 * until the hash is clean.
 */
async function bootstrap() {
  captureAuthErrorFromUrl()
  applyAppearanceTheme(getStoredAppearanceTheme())
  if (supabase) await supabase.auth.getSession()

  // HashRouter, not BrowserRouter: GitHub Pages serves static files only, so a
  // deep link like /inventory would 404 on refresh. Hash routes always resolve.
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <HashRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </HashRouter>
    </React.StrictMode>,
  )
}

void bootstrap()
