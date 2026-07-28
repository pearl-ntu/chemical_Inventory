import { useEffect, useRef, useState } from 'react'

/**
 * A sign-in/invite email resent too soon in a row is exactly what makes a
 * receiving mail server start throttling it — a burst reads as spammy even
 * when it's the same one address each time. 60s keeps sends spaced out
 * without making someone wait through a genuinely lost email.
 */
export const RESEND_COOLDOWN_MS = 60_000

/**
 * Tracks a per-key cooldown (e.g. one per invite row, or a single fixed key
 * for a lone send button) and re-renders once a second so a countdown can
 * be shown, without every caller re-implementing its own ticking interval.
 */
export function useCooldown() {
  const [until, setUntil] = useState<Record<string, number>>({})
  const [, forceTick] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    intervalRef.current = setInterval(() => forceTick((t) => t + 1), 1000)
    return () => clearInterval(intervalRef.current)
  }, [])

  function start(key: string, ms: number = RESEND_COOLDOWN_MS) {
    setUntil((prev) => ({ ...prev, [key]: Date.now() + ms }))
  }

  function secondsLeft(key: string): number {
    const at = until[key]
    if (!at) return 0
    return Math.max(0, Math.ceil((at - Date.now()) / 1000))
  }

  return { start, secondsLeft }
}
