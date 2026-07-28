import { useEffect, useRef, useState } from 'react'
import { Camera, Check, ScanText, Trash2, X } from 'lucide-react'
import {
  extractInvoiceFields,
  resolveDeliveryPhotoUrl,
  uploadDeliveryPhoto,
  type ExtractedFields,
} from '../lib/deliveryPhoto'
import { useToast } from '../context/ToastContext'
import { Spinner } from './ui'

const FIELD_LABELS: Record<keyof ExtractedFields, string> = {
  cas: 'CAS number',
  quantity: 'Containers',
  size_value: 'Pack size',
  size_unit: 'Size unit',
  price: 'Price',
  currency: 'Currency',
}

/**
 * Attach a photo of the delivery order/invoice to a registration, and
 * optionally have it read for candidate field values — always shown as a
 * checklist the person confirms before anything is applied. Nothing here
 * writes to the form on its own.
 */
export function DeliveryPhotoPanel({
  photoPath,
  onPhotoChange,
  onApplyFields,
}: {
  photoPath: string | null
  onPhotoChange: (path: string | null) => void
  onApplyFields: (fields: Partial<ExtractedFields>) => void
}) {
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [pendingFields, setPendingFields] = useState<ExtractedFields | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const lastFileRef = useRef<File | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!photoPath) {
      setPreviewUrl(null)
      return
    }
    void resolveDeliveryPhotoUrl(photoPath)
      .then((url) => !cancelled && setPreviewUrl(url))
      .catch(() => !cancelled && setPreviewUrl(null))
    return () => {
      cancelled = true
    }
  }, [photoPath])

  async function handleFile(file: File) {
    lastFileRef.current = file
    setUploading(true)
    try {
      const path = await uploadDeliveryPhoto(file)
      onPhotoChange(path)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not attach that photo.')
    } finally {
      setUploading(false)
    }
  }

  async function handleExtract() {
    const file = lastFileRef.current
    if (!file) {
      toast.error('Re-attach the photo first — extraction needs the original image for this session.')
      return
    }
    setExtracting(true)
    try {
      const fields = await extractInvoiceFields(file)
      const present = Object.entries(fields).filter(([, v]) => v != null && v !== '')
      if (present.length === 0) {
        toast.error('Could not make out any details on that photo — try a clearer, flatter shot.')
        return
      }
      setPendingFields(fields)
      setChecked(new Set(present.map(([k]) => k)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read that photo.')
    } finally {
      setExtracting(false)
    }
  }

  function applyChecked() {
    if (!pendingFields) return
    const toApply: Partial<ExtractedFields> = {}
    for (const key of Object.keys(pendingFields) as Array<keyof ExtractedFields>) {
      if (checked.has(key)) (toApply as Record<string, unknown>)[key] = pendingFields[key]
    }
    onApplyFields(toApply)
    toast.success(`Filled in ${checked.size} field${checked.size === 1 ? '' : 's'} from the photo.`)
    setPendingFields(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Delivery photo
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Optional — a photo of the delivery order or invoice, for reference. Reading it for a
            CAS number, price or pack size runs on-device, free.
          </p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = ''
        }}
      />

      {!photoPath ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? <Spinner /> : <Camera className="h-4 w-4" />}
          {uploading ? 'Uploading…' : 'Attach delivery photo'}
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-ink-200 bg-white p-2 dark:border-ink-700 dark:bg-ink-950">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-ink-50 dark:bg-ink-900">
            {previewUrl ? (
              <img src={previewUrl} alt="Delivery order" className="h-full w-full object-cover" />
            ) : (
              <Spinner className="h-4 w-4 text-ink-300" />
            )}
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary py-1.5 text-xs"
              disabled={extracting}
              onClick={() => void handleExtract()}
              title="Reads on-device for a CAS number, price and pack size on this photo — always shown for you to confirm first. Free-text details like the name still need typing in by hand."
            >
              {extracting ? <Spinner /> : <ScanText className="h-3.5 w-3.5" />}
              {extracting ? 'Reading…' : 'Extract details from photo'}
            </button>
            <button
              type="button"
              className="btn-ghost p-1.5 text-ink-400 hover:text-rose-600"
              onClick={() => {
                onPhotoChange(null)
                lastFileRef.current = null
                setPendingFields(null)
              }}
              title="Remove the attached photo"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {pendingFields && (
        <div className="rounded-lg border border-pearl-200 bg-pearl-50/60 p-3 dark:border-pearl-500/30 dark:bg-pearl-500/5">
          <p className="mb-2 text-xs font-medium text-pearl-900 dark:text-pearl-100">
            Here's what the photo seems to show — nothing is filled in until you apply it.
          </p>
          <ul className="space-y-1.5">
            {(Object.keys(pendingFields) as Array<keyof ExtractedFields>)
              .filter((k) => pendingFields[k] != null && pendingFields[k] !== '')
              .map((key) => (
                <li key={key}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-white/60 dark:hover:bg-ink-900/40">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-ink-300 text-pearl-600 focus:ring-pearl-500"
                      checked={checked.has(key)}
                      onChange={(e) =>
                        setChecked((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(key)
                          else next.delete(key)
                          return next
                        })
                      }
                    />
                    <span className="w-32 shrink-0 text-xs text-ink-500">{FIELD_LABELS[key]}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800 dark:text-ink-100">
                      {String(pendingFields[key])}
                    </span>
                  </label>
                </li>
              ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn-primary py-1.5 text-xs"
              disabled={checked.size === 0}
              onClick={applyChecked}
            >
              <Check className="h-3.5 w-3.5" /> Apply {checked.size || ''} selected
            </button>
            <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setPendingFields(null)}>
              <X className="h-3.5 w-3.5" /> Discard
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
