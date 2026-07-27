import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { supabase } from './lib/supabase'
import './index.css'

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
