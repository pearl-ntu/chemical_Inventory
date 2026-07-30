import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  Camera,
  CameraOff,
  CheckCircle2,
  Download,
  HelpCircle,
  Keyboard,
  Loader2,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Square,
  SwitchCamera,
} from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { EmptyState } from '../components/ui'
import { useInventory } from '../context/InventoryContext'
import { toCSV } from '../lib/csv'
import {
  CameraError,
  cameraErrorFrom,
  codeFromScan,
  listVideoInputs,
  startQrScanner,
  type CameraDevice,
  type QrScanner,
} from '../lib/scanner'
import type { Chemical } from '../lib/types'
import { useLabLocations } from '../lib/useLabLocations'
import { download, formatSize, todayISO } from '../lib/utils'

function active(c: Chemical) {
  return c.status !== 'empty' && c.status !== 'disposed'
}

type ScannerState = 'idle' | 'starting' | 'scanning' | 'error'
type ScanFeedback = { kind: 'found' | 'unexpected' | 'duplicate'; message: string }

const CAMERA_ERROR_TITLES: Record<CameraError['code'], string> = {
  'insecure-context': 'A secure connection is required',
  unsupported: 'Camera scanning is unavailable',
  'permission-denied': 'Camera permission is blocked',
  'not-found': 'No camera found',
  'in-use': 'Camera is busy',
  constraints: 'That camera is unavailable',
  playback: 'Camera preview did not start',
  unknown: 'Camera could not start',
}

/**
 * A mobile-first "walk the shelves" mode. The session is deliberately local:
 * scanning never edits inventory records.
 */
export default function StocktakePage() {
  const { chemicals, loading } = useInventory()
  const labLocations = useLabLocations(chemicals)
  const [params] = useSearchParams()

  const [location, setLocation] = useState<string>(() => params.get('location') ?? '')
  const [scannerState, setScannerState] = useState<ScannerState>('idle')
  const [found, setFound] = useState<Set<string>>(new Set())
  const [unexpected, setUnexpected] = useState<Set<string>>(new Set())
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const [cameraError, setCameraError] = useState<CameraError | null>(null)
  const [cameras, setCameras] = useState<CameraDevice[]>([])
  const [activeCameraId, setActiveCameraId] = useState<string | undefined>()
  const [manualCode, setManualCode] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerRef = useRef<QrScanner | null>(null)
  const startAttemptRef = useRef(0)
  const seenCodesRef = useRef<Set<string>>(new Set())

  const expected = useMemo(() => {
    const stocked = chemicals.filter(active)
    return location ? stocked.filter((c) => c.location === location) : stocked
  }, [chemicals, location])

  const expectedByCode = useMemo(() => new Map(expected.map((c) => [c.code, c])), [expected])
  const expectedByCodeRef = useRef(expectedByCode)
  expectedByCodeRef.current = expectedByCode
  const missing = useMemo(() => expected.filter((c) => !found.has(c.code)), [expected, found])
  const progress = expected.length === 0 ? 0 : Math.round((found.size / expected.length) * 100)

  function releaseScanner(nextState: ScannerState = 'idle') {
    startAttemptRef.current += 1
    scannerRef.current?.stop()
    scannerRef.current = null
    setScannerState(nextState)
  }

  useEffect(() => {
    const releaseOnPageHide = () => {
      startAttemptRef.current += 1
      scannerRef.current?.stop()
      scannerRef.current = null
    }
    window.addEventListener('pagehide', releaseOnPageHide)
    return () => {
      window.removeEventListener('pagehide', releaseOnPageHide)
      releaseOnPageHide()
    }
  }, [])

  function vibrate(pattern: number | number[]) {
    try {
      navigator.vibrate?.(pattern)
    } catch {
      // Vibration is optional and commonly disabled on iOS.
    }
  }

  function registerScan(raw: string) {
    const code = codeFromScan(raw)
    if (!code) return

    if (seenCodesRef.current.has(code)) {
      setFeedback({ kind: 'duplicate', message: `Already scanned: ${code}` })
      vibrate(20)
      return
    }
    seenCodesRef.current.add(code)

    const chemical = expectedByCodeRef.current.get(code)
    if (chemical) {
      setFound((previous) => new Set(previous).add(code))
      setFeedback({ kind: 'found', message: `${chemical.name} · ${code}` })
      vibrate(80)
    } else {
      setUnexpected((previous) => new Set(previous).add(code))
      setFeedback({ kind: 'unexpected', message: `${code} is not on this list` })
      vibrate([40, 50, 40])
    }
  }

  async function start(deviceId?: string) {
    const video = videoRef.current
    if (!video) return

    const attempt = startAttemptRef.current + 1
    startAttemptRef.current = attempt
    scannerRef.current?.stop()
    scannerRef.current = null
    setCameraError(null)
    setFeedback(null)
    setScannerState('starting')

    try {
      const scanner = await startQrScanner(
        video,
        registerScan,
        (message) => {
          if (startAttemptRef.current !== attempt) return
          scannerRef.current?.stop()
          scannerRef.current = null
          setCameraError(new CameraError('unknown', message))
          setScannerState('error')
        },
        deviceId,
      )
      if (startAttemptRef.current !== attempt) {
        scanner.stop()
        return
      }

      scannerRef.current = scanner
      setActiveCameraId(scanner.deviceId)
      setScannerState('scanning')

      try {
        const available = await listVideoInputs()
        if (startAttemptRef.current === attempt) setCameras(available)
      } catch {
        // Camera labels/switching are an enhancement; scanning can continue.
      }
    } catch (error) {
      if (startAttemptRef.current !== attempt) return
      setCameraError(cameraErrorFrom(error))
      setScannerState('error')
    }
  }

  function switchCamera() {
    if (cameras.length < 2) return
    const currentIndex = cameras.findIndex((camera) => camera.deviceId === activeCameraId)
    const nextCamera = cameras[(currentIndex + 1 + cameras.length) % cameras.length]
    void start(nextCamera.deviceId)
  }

  function resetSession() {
    setFound(new Set())
    setUnexpected(new Set())
    seenCodesRef.current = new Set()
    scannerRef.current?.reset()
    setFeedback(null)
  }

  function submitManualCode(event: FormEvent) {
    event.preventDefault()
    if (!manualCode.trim()) return
    registerScan(manualCode)
    setManualCode('')
  }

  function exportMissing() {
    const csv = toCSV(missing)
    const scope = location || 'all-locations'
    download(`pearl-stocktake-missing-${scope}-${todayISO()}.csv`, csv, 'text/csv;charset=utf-8')
  }

  const isStarting = scannerState === 'starting'
  const isScanning = scannerState === 'scanning'
  const hasSessionResults = found.size > 0 || unexpected.size > 0

  return (
    <div>
      <PageHeader
        title="Stocktake"
        description="Scan every bottle on a shelf with your phone's camera and see what's missing when you're done."
      />

      <div className="mb-4">
        <label className="label" htmlFor="stocktake-location">
          Shelf or location
        </label>
        <select
          id="stocktake-location"
          className="input min-h-11"
          value={location}
          disabled={isStarting}
          onChange={(event) => {
            releaseScanner()
            setLocation(event.target.value)
            resetSession()
            setCameraError(null)
          }}
        >
          <option value="">All locations ({chemicals.filter(active).length} containers)</option>
          {labLocations.locations.map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="card relative overflow-hidden border-0 bg-black">
            <video
              ref={videoRef}
              className={`aspect-[3/4] max-h-[68dvh] w-full object-cover transition-opacity sm:aspect-[4/3] ${
                isScanning ? 'opacity-100' : 'opacity-0'
              }`}
              muted
              autoPlay
              playsInline
              aria-label="Live camera preview"
            />

            {isScanning && (
              <>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
                  <div className="relative aspect-square w-[68%] max-w-72 rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.18)]">
                    <ScanLine className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-white/80" />
                  </div>
                </div>
                <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/65 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  Camera ready
                </div>
              </>
            )}

            {!isScanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-7 text-center text-white">
                {isStarting ? (
                  <>
                    <Loader2 className="h-9 w-9 animate-spin" />
                    <div>
                      <p className="font-semibold">Opening camera…</p>
                      <p className="mt-1 text-xs text-white/70">Allow access if your browser asks.</p>
                    </div>
                  </>
                ) : cameraError ? (
                  <>
                    <CameraOff className="h-9 w-9 text-rose-300" />
                    <div>
                      <p className="font-semibold">{CAMERA_ERROR_TITLES[cameraError.code]}</p>
                      <p className="mt-1 max-w-sm text-sm text-white/70">{cameraError.message}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <Camera className="h-9 w-9 text-white/80" />
                    <div>
                      <p className="font-semibold">Ready to scan</p>
                      <p className="mt-1 max-w-xs text-sm text-white/65">
                        Your browser will ask for camera permission the first time.
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {feedback && isScanning && (
              <div
                className={`absolute inset-x-3 bottom-3 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg backdrop-blur ${
                  feedback.kind === 'found'
                    ? 'bg-emerald-600/90'
                    : feedback.kind === 'duplicate'
                      ? 'bg-ink-700/90'
                      : 'bg-amber-600/90'
                }`}
                role="status"
                aria-live="polite"
              >
                <span className="flex items-center gap-2">
                  {feedback.kind === 'found' ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                  ) : (
                    <AlertCircle className="h-5 w-5 shrink-0" />
                  )}
                  {feedback.message}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {isScanning ? (
              <>
                <button type="button" className="btn-secondary min-h-12" onClick={() => releaseScanner()}>
                  <Square className="h-4 w-4" /> Stop
                </button>
                <button
                  type="button"
                  className="btn-secondary min-h-12"
                  onClick={switchCamera}
                  disabled={cameras.length < 2}
                  title={cameras.length < 2 ? 'No second camera is available' : 'Use the next camera'}
                >
                  <SwitchCamera className="h-4 w-4" /> Switch camera
                </button>
              </>
            ) : isStarting ? (
              <button
                type="button"
                className="btn-secondary col-span-2 min-h-12"
                onClick={() => releaseScanner()}
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary col-span-2 min-h-12 text-base"
                onClick={() =>
                  void start(
                    cameraError?.code === 'constraints' || cameraError?.code === 'not-found'
                      ? undefined
                      : activeCameraId,
                  )
                }
                disabled={loading}
              >
                {cameraError ? <RefreshCw className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
                {cameraError ? 'Try camera again' : 'Start scanning'}
              </button>
            )}
          </div>

          {cameraError?.code === 'permission-denied' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="font-semibold">To restore camera access</p>
              <p className="mt-1">
                Open this site&apos;s settings from the address bar, set Camera to Allow, then tap Try camera
                again. On iPhone/iPad, use Safari&apos;s Page menu → Website Settings.
              </p>
            </div>
          )}

          {cameraError && cameraError.code !== 'permission-denied' && (
            <div
              className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
              role="alert"
            >
              <p className="font-semibold">{CAMERA_ERROR_TITLES[cameraError.code]}</p>
              <p className="mt-1">{cameraError.message}</p>
            </div>
          )}

          <p className="flex items-start gap-1.5 text-xs text-ink-500 dark:text-ink-400">
            <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Hold a QR label inside the square until the phone vibrates. Each label counts once. Camera access
            works only on HTTPS (or localhost), not an app opened directly from a downloaded file.
          </p>

          <details className="card group overflow-hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-ink-700 dark:text-ink-200">
              <Keyboard className="h-4 w-4" />
              Enter a label code instead
            </summary>
            <form className="flex gap-2 border-t border-ink-100 p-3 dark:border-ink-800" onSubmit={submitManualCode}>
              <input
                className="input min-h-11"
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                placeholder="Container code or QR link"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <button type="submit" className="btn-secondary min-h-11 shrink-0" disabled={!manualCode.trim()}>
                Add
              </button>
            </form>
          </details>
        </div>

        <div className="space-y-4">
          <div className="card p-3">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{found.size}</p>
                <p className="text-xs text-ink-500">Found</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-ink-800 dark:text-ink-100">{expected.length}</p>
                <p className="text-xs text-ink-500">Expected</p>
              </div>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800"
              role="progressbar"
              aria-label="Stocktake progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs text-ink-500">{progress}% complete</p>
              {hasSessionResults && (
                <button type="button" className="btn-ghost -mr-2 py-1 text-xs" onClick={resetSession}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reset session
                </button>
              )}
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
                  {missing.map((chemical) => (
                    <li key={chemical.id} className="flex items-center justify-between px-4 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink-800 dark:text-ink-100">{chemical.name}</p>
                        <p className="truncate text-xs text-ink-400">
                          {chemical.code} ·{' '}
                          {[chemical.location, chemical.sub_location].filter(Boolean).join(' / ') ||
                            'No location set'}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-ink-400">{formatSize(chemical)}</span>
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
                  onClick={() => {
                    setUnexpected(new Set())
                    seenCodesRef.current = new Set(found)
                  }}
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
