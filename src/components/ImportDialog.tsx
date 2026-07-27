import { useRef, useState } from 'react'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import { parseCSV, rowsToChemicals, templateCSV, type ImportResult } from '../lib/csv'
import type { ChemicalInput } from '../lib/types'
import { download } from '../lib/utils'
import { Modal, Spinner } from './ui'

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { importRows } = useInventory()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)

  function reset() {
    setPreview(null)
    setFileName('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onFile(file: File) {
    setFileName(file.name)
    try {
      const text = await file.text()
      setPreview(rowsToChemicals(parseCSV(text)))
    } catch {
      toast.error('Could not read that file. Save it as CSV and try again.')
    }
  }

  async function confirmImport() {
    if (!preview || preview.rows.length === 0) return
    setBusy(true)
    try {
      const n = await importRows(preview.rows as ChemicalInput[])
      toast.success(`Imported ${n} container${n === 1 ? '' : 's'}.`)
      reset()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      size="lg"
      title="Import from a spreadsheet"
      description="Bring in a CSV exported from Excel. Column headings are matched automatically."
      footer={
        <>
          <button
            className="btn-secondary"
            onClick={() => download('pearl-inventory-template.csv', templateCSV(), 'text/csv;charset=utf-8')}
          >
            <Download className="h-4 w-4" /> Template
          </button>
          <div className="flex-1" />
          <button
            className="btn-secondary"
            onClick={() => {
              reset()
              onClose()
            }}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => void confirmImport()}
            disabled={busy || !preview || preview.rows.length === 0}
          >
            {busy && <Spinner />}
            Import {preview?.rows.length ?? 0} row{preview?.rows.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-300 bg-ink-50 px-6 py-10 text-center transition-colors hover:border-pearl-400 hover:bg-pearl-50/50 dark:border-ink-700 dark:bg-ink-950 dark:hover:border-pearl-500">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
            }}
          />
          <Upload className="h-7 w-7 text-ink-400" />
          <span className="text-sm font-semibold text-ink-700 dark:text-ink-200">
            {fileName || 'Choose a CSV file'}
          </span>
          <span className="max-w-sm text-xs leading-relaxed text-ink-500">
            In Excel: <strong>File → Save As → CSV UTF-8</strong>. The original lab sheet’s headings
            (Chemical Name, CAS No., Location, Size Value…) are recognised as-is.
          </span>
        </label>

        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="badge bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20">
                {preview.rows.length} ready to import
              </span>
              {preview.errors.length > 0 && (
                <span className="badge bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20">
                  {preview.errors.length} skipped
                </span>
              )}
              {preview.ignoredColumns.length > 0 && (
                <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300 dark:ring-ink-700">
                  Ignored columns: {preview.ignoredColumns.join(', ')}
                </span>
              )}
            </div>

            {preview.errors.length > 0 && (
              <ul className="max-h-24 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                {preview.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            )}

            {preview.rows.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-ink-200 dark:border-ink-700">
                <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-3 py-2 text-xs font-semibold text-ink-600 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-300">
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Preview — first 8 rows
                </div>
                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-white dark:bg-ink-900">
                      <tr className="border-b border-ink-100 dark:border-ink-800">
                        <th className="px-3 py-2 font-semibold">Name</th>
                        <th className="px-3 py-2 font-semibold">CAS</th>
                        <th className="px-3 py-2 font-semibold">Location</th>
                        <th className="px-3 py-2 font-semibold">Amount</th>
                        <th className="px-3 py-2 font-semibold">Supplier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 8).map((r, i) => (
                        <tr key={i} className="border-b border-ink-50 last:border-0 dark:border-ink-800/50">
                          <td className="px-3 py-1.5">{r.name}</td>
                          <td className="px-3 py-1.5 font-mono text-ink-500">{r.cas ?? '—'}</td>
                          <td className="px-3 py-1.5">{r.location ?? '—'}</td>
                          <td className="px-3 py-1.5">
                            {r.quantity} × {r.size_value ?? '?'} {r.size_unit}
                          </td>
                          <td className="px-3 py-1.5">{r.supplier ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
