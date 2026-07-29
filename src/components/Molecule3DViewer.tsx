import { useEffect, useRef, useState } from 'react'
import { Spinner } from './ui'

declare global {
  interface Window {
    $3Dmol?: {
      createViewer: (el: HTMLElement, options?: Record<string, unknown>) => {
        clear: () => void
        addModel: (data: string, format: string) => unknown
        setStyle: (sel: Record<string, unknown>, style: Record<string, unknown>) => void
        setBackgroundColor: (color: string | number) => void
        resize: () => void
        zoomTo: () => void
        render: () => void
      }
    }
  }
}

type StyleMode = 'stick' | 'sphere' | 'line'

let loader: Promise<void> | null = null

function load3Dmol() {
  if (window.$3Dmol) return Promise.resolve()
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://3dmol.org/build/3Dmol-min.js'
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Could not load 3Dmol.js'))
      document.head.appendChild(script)
    })
  }
  return loader
}

export function Molecule3DViewer({ sdf }: { sdf: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<StyleMode>('stick')
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(() => Boolean(window.$3Dmol))

  useEffect(() => {
    let live = true
    setError(null)
    if (!sdf || !ref.current) return
    load3Dmol()
      .then(() => {
        if (!live || !ref.current || !window.$3Dmol) return
        ref.current.innerHTML = ''
        setReady(true)
        const viewer = window.$3Dmol.createViewer(ref.current, { backgroundColor: 'white' })
        viewer.clear()
        viewer.addModel(sdf, 'sdf')
        viewer.setBackgroundColor('white')
        viewer.setStyle({}, style === 'stick' ? { stick: {} } : style === 'sphere' ? { sphere: { scale: 0.3 }, stick: { radius: 0.08 } } : { line: {} })
        viewer.resize()
        viewer.zoomTo()
        viewer.render()
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Could not render 3D structure'))
    return () => {
      live = false
    }
  }, [sdf, style])

  if (!sdf) {
    return <p className="px-3 text-center text-xs text-ink-400">No PubChem 3D coordinates available for this compound.</p>
  }

  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div className="flex justify-end gap-1">
        {(['stick', 'sphere', 'line'] as StyleMode[]).map((mode) => (
          <button key={mode} type="button" className={style === mode ? 'btn-primary py-1 text-xs' : 'btn-secondary py-1 text-xs'} onClick={() => setStyle(mode)}>
            {mode}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        className="relative h-[220px] w-full overflow-hidden rounded bg-white [&_canvas]:!h-full [&_canvas]:!max-h-full [&_canvas]:!max-w-full [&_canvas]:!w-full"
      />
      {error && <p className="text-xs text-rose-500">{error}</p>}
      {!ready && !error && <div className="flex justify-center"><Spinner className="h-4 w-4 text-ink-300" /></div>}
    </div>
  )
}
