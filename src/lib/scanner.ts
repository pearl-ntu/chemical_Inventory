/**
 * Continuous QR decoding from a live camera feed. Native BarcodeDetector is
 * preferred where it is reliable; jsQR is the cross-browser fallback used by
 * Safari/iOS and older Android browsers.
 */
import jsQR from 'jsqr'

export interface QrScanner {
  stop: () => void
  reset: () => void
  deviceId?: string
}

export interface CameraDevice {
  deviceId: string
  label: string
}

export type CameraErrorCode =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'not-found'
  | 'in-use'
  | 'constraints'
  | 'playback'
  | 'unknown'

export class CameraError extends Error {
  constructor(
    public readonly code: CameraErrorCode,
    message: string,
    public readonly originalError?: unknown,
  ) {
    super(message)
    this.name = 'CameraError'
  }
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>
}

declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike
  }
}

function normaliseCameraError(error: unknown): CameraError {
  if (error instanceof CameraError) return error

  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new CameraError(
      'permission-denied',
      'Camera access was blocked. Allow camera access for this site in your browser settings, then try again.',
      error,
    )
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new CameraError('not-found', 'No camera was found on this device.', error)
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return new CameraError(
      'in-use',
      'The camera could not start. Close other apps or browser tabs using it, then try again.',
      error,
    )
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return new CameraError(
      'constraints',
      'The selected camera is no longer available. Try another camera.',
      error,
    )
  }

  return new CameraError(
    'unknown',
    error instanceof Error ? error.message : 'The camera could not be opened.',
    error,
  )
}

export function cameraErrorFrom(error: unknown): CameraError {
  return normaliseCameraError(error)
}

export async function listVideoInputs(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  let unnamed = 0
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device) => {
      unnamed += 1
      return {
        deviceId: device.deviceId,
        label: device.label || `Camera ${unnamed}`,
      }
    })
}

/**
 * Starts a camera and calls `onDecode` once for each unique QR payload in this
 * scanner session. The caller must call stop() when leaving the page.
 */
export async function startQrScanner(
  video: HTMLVideoElement,
  onDecode: (value: string) => void,
  onError: (message: string) => void,
  deviceId?: string,
): Promise<QrScanner> {
  if (!window.isSecureContext) {
    throw new CameraError(
      'insecure-context',
      'Camera access requires HTTPS. Open the deployed HTTPS site (or localhost) and try again.',
    )
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      'unsupported',
      'This browser cannot provide camera access. Try the latest Safari or Chrome.',
    )
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
      audio: false,
    })
  } catch (error) {
    throw normaliseCameraError(error)
  }

  // These properties are also present in JSX, but setting them before play()
  // keeps iOS Safari in inline/muted mode even during its first media task.
  video.muted = true
  video.autoplay = true
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.srcObject = stream

  try {
    await video.play()
  } catch (error) {
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
    throw new CameraError(
      'playback',
      'The camera opened but the preview could not start. Tap Try again, or reload this page.',
      error,
    )
  }

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  let detector: BarcodeDetectorLike | null = null
  if (window.BarcodeDetector) {
    try {
      detector = new window.BarcodeDetector({ formats: ['qr_code'] })
    } catch {
      // Some browsers expose BarcodeDetector without supporting QR codes.
      detector = null
    }
  }

  let stopped = false
  let timerId = 0
  let reportedFrameError = false
  const decodedValues = new Set<string>()

  const schedule = (delay = 100) => {
    if (!stopped) timerId = window.setTimeout(() => void tick(), delay)
  }

  async function decodeWithJsQr(): Promise<string | null> {
    if (!ctx || !video.videoWidth || !video.videoHeight) return null

    // Full phone-camera frames can exceed 12 MP. Downsampling is materially
    // faster, cooler, and still leaves ample QR detail for shelf labels.
    const scale = Math.min(1, 1280 / video.videoWidth)
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return jsQR(frame.data, frame.width, frame.height)?.data ?? null
  }

  async function tick() {
    if (stopped) return
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      schedule()
      return
    }

    try {
      let value: string | null = null
      if (detector) {
        try {
          const results = await detector.detect(video)
          value = results[0]?.rawValue ?? null
        } catch {
          // Fall back permanently if this browser's native implementation
          // rejects video elements or QR decoding at runtime.
          detector = null
          value = await decodeWithJsQr()
        }
      } else {
        value = await decodeWithJsQr()
      }

      if (value && !decodedValues.has(value)) {
        decodedValues.add(value)
        onDecode(value)
      }
      schedule()
    } catch (error) {
      if (!reportedFrameError) {
        reportedFrameError = true
        onError(error instanceof Error ? error.message : 'Could not read the camera frame.')
      }
      schedule(250)
    }
  }

  const videoTrack = stream.getVideoTracks()[0]
  videoTrack?.addEventListener('ended', () => {
    if (!stopped) onError('The camera stopped. Tap Try again to restart it.')
  })
  schedule(0)

  function stop() {
    if (stopped) return
    stopped = true
    window.clearTimeout(timerId)
    for (const track of stream.getTracks()) track.stop()
    video.pause()
    video.srcObject = null
  }

  function reset() {
    decodedValues.clear()
  }

  return { stop, reset, deviceId: videoTrack?.getSettings().deviceId }
}

/**
 * Pull the `code` query parameter from a PEARL deep link. Supplier barcodes
 * and other raw values pass through unchanged so the UI can flag them.
 */
export function codeFromScan(value: string): string {
  const trimmed = value.trim()
  try {
    const hashIndex = trimmed.indexOf('#')
    const query =
      hashIndex >= 0 ? trimmed.slice(hashIndex + 1).split('?')[1] : new URL(trimmed).search.slice(1)
    if (!query) return trimmed
    const params = new URLSearchParams(query)
    return params.get('code')?.trim() || trimmed
  } catch {
    return trimmed
  }
}
