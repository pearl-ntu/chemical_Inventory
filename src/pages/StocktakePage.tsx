import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Camera, CheckCircle2, Download, HelpCircle, RotateCcw, Square } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { EmptyState } from '../components/ui'
import { useInventory } from '../context/InventoryContext'
import { toCSV } from '../lib/csv'
import { codeFromScan, startQrScanner, type QrScanner } from '../lib/scanner'
import type { Chemical } from '../lib/types'
import { useLabLocations } from '../lib/useLabLocations'
import { download, formatSize, todayISO } from '../lib/utils'

function active(c: Chemical) {
  return c.status !== 'empty' && c.status !== 'disposed'
}

/**
 * A mobile-first "walk the shelves" mode: pick a location, scan every bottle
 * on it with the phone's own camera, and see what's missing at the end.
 * Session-only — nothing here writes to a record. If you want to act on a
 * missing bottle (mark it disposed, move it, whatever), do that from the
 * normal inventory list; this just tells you what to go look for.
 */
export default function StocktakePage() {
  const { chemicals, loading } = useInventory()
  const labLocations = useLabLocations(chemicals)
  const [params] = useSearchParams()

  const [location, setLocation] = useState<string>(() => params.get('location') ?? '')
  const [scanning, setScanning] = useState(false)
  const [found, setFound] = useState<Set<string>>(new Set())
  const [unexpected, setUnexpected] = useState<Set<string>>(new Set())
  const [lastMessage, setLastMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerRef = useRef<QrScanner | null>(null)

  const expected = useMemo(() => {
    const stocked = chemicals.filter(active)
    return location ? stocked.filter((c) => c.location === location) : stocked
  }, [chemicals, location])

  const expectedByCode = useMemo(() => new Map(expected.map((c) => [c.code, c])), [expected])
  const missing = useMemo(() => expected.filter((c) => !found.has(c.code)), [expected, found])

  async function start() {
    setError(null)
    setFound(new Set())
    setUnexpected(new Set())
    setLastMessage(null)
    if (!videoRef.current) return
    try {
      scannerRef.current = await startQrScanner(
        videoRef.current,
        (raw) => {
          const code = codeFromScan(raw)
          if (expectedByCode.has(code)) {
            setFound((prev) => (prev.has(code) ? prev : new Set(prev).add(code)))
            const chem = expectedByCode.get(code)
            setLastMessage(`Found: ${chem?.name} (${code})`)
          } else {
            setUnexpected((prev) => (prev.has(code) ? prev : new Set(prev).add(code)))
            setLastMessage(`Scanned ${code} — not on this list.`)
          }
        },
        (message) => setError(message),
      )
      setScanning(true)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not open the camera — check that this site has camera permission.',
      )
    }
  }

  function stop() {
    scannerRef.current?.stop()
    scannerRef.current = null
    setScanning(false)
  }

  function exportMissing() {
    const csv = toCSV(missing)
    const scope = location || 'all-locations'
    download(`pearl-stocktake-missing-${scope}-${todayISO()}.csv`, csv, 'text/csv;charset=utf-8')
  }

  return (
    <div>
      <PageHeader
        title="Stocktake"
        description="Scan every bottle on a shelf with your phone's camera and see what's missing when you're done."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <select
          className="input"
          value={location}
          onChange={(e) => {
            setLocation(e.target.value)
            if (scanning) stop()
            setFound(new Set())
            setUnexpected(new Set())
          }}
        >
          <option value="">All locations ({chemicals.filter(active).length} containers)</option>
          {labLocations.locations.map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </select>
        {!scanning ? (
          <button type="button" className="btn-primary" onClick={() => void start()}>
            <Camera className="h-4 w-4" /> Start scanning
          </button>
        ) : (
          <button type="button" className="btn-secondary" onClick={stop}>
            <Square className="h-4 w-4" /> Stop
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="card overflow-hidden bg-black">
            <video
              ref={videoRef}
              className="aspect-[4/3] w-full object-cover"
              muted
              playsInline
              style={{ display: scanning ? 'block' : 'none' }}
            />
            {!scanning && (
              <div className="flex aspect-[4/3] w-full items-center justify-center text-ink-400">
                <Camera className="h-8 w-8" />
              </div>
            )}
          </div>
          {lastMessage && (
            <p className="flex items-center gap-1.5 text-sm text-ink-600 dark:text-ink-300">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> {lastMessage}
            </p>
          )}
          <p className="flex items-start gap-1.5 text-xs text-ink-400">
            <HelpCircle className="h-3.5 w-3.5 shrink-0" />
            Point the camera at a bottle's QR label. Each unique code only counts once, so it's fine if it stays
            in frame a moment.
          </p>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="card p-3 text-center">
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{found.size}</p>
              <p className="text-xs text-ink-500">Found</p>
            </div>
            <div className="card p-3 text-center">
              <p className="text-2xl font-bold text-ink-800 dark:text-ink-100">{expected.length}</p>
              <p className="text-xs text-ink-500">Expected</p>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2.5 dark:border-ink-800 dark:bg-ink-950/50">
              <h2 className="text-sm font-semibold text-ink-800 dark:text-ink-100">
                Not yet scanned ({missing.length})
              </h2>
              {missing.length > 0 && found.size > 0 && (
                <button type="button" className="btn-ghost py-1 text-xs" onClick={exportMissing}>
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {loading ? (
                <p className="p-4 text-sm text-ink-400">Loading…</p>
              ) : missing.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 className="h-6 w-6" />}
                  title={expected.length === 0 ? 'Nothing expected here' : 'Everything scanned'}
                  description={
                    expected.length === 0
                      ? 'Pick a location with containers in it, or scan against the whole inventory.'
                      : 'Every expected container on this list has been scanned.'
                  }
                />
              ) : (
                <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                  {missing.map((c) => (
                    <li key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink-800 dark:text-ink-100">{c.name}</p>
                        <p className="truncate text-xs text-ink-400">
                          {c.code} · {[c.location, c.sub_location].filter(Boolean).join(' / ') || 'No location set'}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-ink-400">{formatSize(c)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {unexpected.size > 0 && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2.5 dark:border-ink-800 dark:bg-ink-950/50">
                <h2 className="text-sm font-semibold text-ink-800 dark:text-ink-100">
                  Scanned but not on this list ({unexpected.size})
                </h2>
                <button
                  type="button"
                  className="btn-ghost py-1 text-xs text-ink-400"
                  onClick={() => setUnexpected(new Set())}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Clear
                </button>
              </div>
              <p className="p-3 text-xs text-ink-500">
                Either not a PEARL QR code, disposed/empty, or filed under a different location than selected.
              </p>
              <ul className="divide-y divide-ink-100 px-4 pb-3 text-sm dark:divide-ink-800">
                {[...unexpected].map((code) => (
                  <li key={code} className="py-1.5 font-mono text-xs text-ink-500">
                    {code}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
