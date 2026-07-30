import { useRef, useState } from 'react'
import { ExternalLink, Paperclip, Trash2 } from 'lucide-react'
import { isStorageRef, labDocumentsAvailable, resolveDocUrl, uploadLabDocument, type LabDocumentKind } from '../lib/labDocuments'
import { useToast } from '../context/ToastContext'
import { Field, Spinner } from './ui'

/**
 * A link field (SDS / CoA / invoice) that also accepts a direct file upload
 * as an alternative to pasting an external URL — paste a manufacturer's link,
 * or attach the PDF/photo itself. Whichever was last set wins; there's only
 * ever one value here, same as before this existed.
 */
export function DocumentField({
  label,
  kind,
  value,
  onChange,
  placeholder,
}: {
  label: string
  kind: LabDocumentKind
  value: string | null
  onChange: (value: string | null) => void
  placeholder?: string
}) {
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const uploaded = isStorageRef(value)

  async function handleFile(file: File) {
    setUploading(true)
    try {
      const stored = await uploadLabDocument(file, kind)
      onChange(stored)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not attach that file.')
    } finally {
      setUploading(false)
    }
  }

  async function handleView() {
    try {
      const url = await resolveDocUrl(value)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open that file.')
    }
  }

  return (
    <Field label={label}>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = ''
        }}
      />
      {uploaded ? (
        <div className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white py-1.5 pl-3 pr-1.5 dark:border-ink-700 dark:bg-ink-950">
          <button
            type="button"
            className="flex flex-1 items-center gap-1.5 truncate text-left text-sm text-pearl-700 hover:underline dark:text-pearl-300"
            onClick={() => void handleView()}
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" /> Uploaded file
          </button>
          <button
            type="button"
            className="btn-ghost p-1.5 text-ink-400 hover:text-rose-600"
            onClick={() => onChange(null)}
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            className="input"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            placeholder={placeholder}
          />
          {labDocumentsAvailable() && (
            <button
              type="button"
              className="btn-secondary shrink-0 px-2 py-1.5"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              title="Upload a file instead of pasting a link"
            >
              {uploading ? <Spinner className="h-3.5 w-3.5" /> : <Paperclip className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      )}
    </Field>
  )
}
