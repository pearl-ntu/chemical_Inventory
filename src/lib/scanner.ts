/**
 * Continuous QR decoding off a live camera feed, for walking the shelves and
 * scanning one bottle after another rather than opening a native camera app
 * per bottle. Uses the browser's native `BarcodeDetector` where available
 * (fast, no extra bundle weight — Chrome/Android today) and falls back to
 * the pure-JS `jsQR` decoder everywhere else (notably Safari/iOS).
 */
import jsQR from 'jsqr'

export interface QrScanner {
  stop: () => void
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>
}

declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike
  }
}

/**
 * Starts the rear camera and calls `onDecode` once per distinct QR payload
 * seen (repeats of the same value while it's still in frame are suppressed).
 * Call the returned `stop()` to release the camera.
 */
export async function startQrScanner(
  video: HTMLVideoElement,
  onDecode: (value: string) => void,
  onError: (message: string) => void,
): Promise<QrScanner> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  })
  video.srcObject = stream
  await video.play()

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const detector = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null

  let stopped = false
  let lastValue = ''
  let lastAt = 0
  let rafId = 0

  async function tick() {
    if (stopped) return
    rafId = requestAnimationFrame(() => void tick())
    if (video.readyState < video.HAVE_ENOUGH_DATA) return

    try {
      let value: string | null = null
      if (detector) {
        const results = await detector.detect(video)
        value = results[0]?.rawValue ?? null
      } else if (ctx) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
        value = jsQR(frame.data, frame.width, frame.height)?.data ?? null
      }

      if (value) {
        const now = Date.now()
        // Same code re-seen within 2s (still in frame) doesn't count as a new scan.
        if (value !== lastValue || now - lastAt > 2000) {
          lastValue = value
          lastAt = now
          onDecode(value)
        }
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not read the camera frame.')
    }
  }

  void tick()

  function stop() {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(rafId)
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }

  return { stop }
}

/** Pulls the `code` query param out of a scanned PEARL container deep link,
 *  or returns the raw value unchanged if it isn't one of our own QR codes —
 *  a person might scan a supplier barcode by mistake, and that's just "no match". */
export function codeFromScan(value: string): string {
  try {
    const hashIndex = value.indexOf('#')
    const query = hashIndex >= 0 ? value.slice(hashIndex + 1).split('?')[1] : new URL(value).search.slice(1)
    if (!query) return value
    const params = new URLSearchParams(query)
    return params.get('code') ?? value
  } catch {
    return value
  }
}
