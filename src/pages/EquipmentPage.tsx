import { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, Microscope, Plus } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { Field, LoadingScreen, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import type { Equipment, EquipmentBooking, ResearchAsset } from '../lib/types'
import { formatDate } from '../lib/utils'

function datetimeLocal(date: Date) {
  return date.toISOString().slice(0, 16)
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function EquipmentPage() {
  const { profile, canEdit } = useAuth()
  const toast = useToast()
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [bookings, setBookings] = useState<EquipmentBooking[]>([])
  const [assets, setAssets] = useState<ResearchAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [newEquipment, setNewEquipment] = useState({ name: '', location: '', notes: '' })
  const [booking, setBooking] = useState(() => {
    const start = new Date()
    start.setMinutes(0, 0, 0)
    const end = new Date(start)
    end.setHours(end.getHours() + 1)
    return { equipment_id: '', start_time: datetimeLocal(start), end_time: datetimeLocal(end), purpose: '', related_research_asset_id: '' }
  })

  function load() {
    return Promise.all([api.listEquipment(), api.listEquipmentBookings(), api.listResearchAssets()]).then(([eq, rows, ra]) => {
      setEquipment(eq)
      setBookings(rows)
      setAssets(ra)
      setBooking((prev) => ({ ...prev, equipment_id: prev.equipment_id || eq[0]?.id || '' }))
    })
  }

  useEffect(() => {
    load()
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not load equipment.'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const upcoming = useMemo(
    () => bookings.filter((row) => new Date(row.end_time) >= new Date()).slice(0, 40),
    [bookings],
  )

  const weekDays = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return Array.from({ length: 7 }, (_, day) => addDays(start, day))
  }, [])

  const bookingsByDay = useMemo(() => {
    const map = new Map<string, EquipmentBooking[]>()
    for (const row of upcoming) {
      const key = row.start_time.slice(0, 10)
      map.set(key, [...(map.get(key) ?? []), row])
    }
    return map
  }, [upcoming])

  async function addEquipment() {
    if (!newEquipment.name.trim()) return
    setBusy(true)
    try {
      const row = await api.createEquipment({
        name: newEquipment.name.trim(),
        location: newEquipment.location.trim() || null,
        notes: newEquipment.notes.trim() || null,
      })
      setEquipment((prev) => [row, ...prev])
      setBooking((prev) => ({ ...prev, equipment_id: prev.equipment_id || row.id }))
      setNewEquipment({ name: '', location: '', notes: '' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add equipment.')
    } finally {
      setBusy(false)
    }
  }

  async function addBooking() {
    if (!profile || !booking.equipment_id || !booking.purpose.trim()) return
    setBusy(true)
    try {
      const row = await api.createEquipmentBooking({
        equipment_id: booking.equipment_id,
        start_time: new Date(booking.start_time).toISOString(),
        end_time: new Date(booking.end_time).toISOString(),
        purpose: booking.purpose.trim(),
        related_research_asset_id: booking.related_research_asset_id || null,
      }, profile)
      setBookings((prev) => [...prev, row].sort((a, b) => a.start_time.localeCompare(b.start_time)))
      setBooking((prev) => ({ ...prev, purpose: '', related_research_asset_id: '' }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not book equipment.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <LoadingScreen label="Loading equipment..." />

  return (
    <>
      <PageHeader title="Equipment" description="Shared instrument booking for spectrometers, microscopes, and lab equipment." />

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          {canEdit && (
            <section className="card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-100">
                <Microscope className="h-4 w-4" /> Add equipment
              </h2>
              <div className="space-y-3">
                <Field label="Name"><input className="input" value={newEquipment.name} onChange={(e) => setNewEquipment((f) => ({ ...f, name: e.target.value }))} /></Field>
                <Field label="Location"><input className="input" value={newEquipment.location} onChange={(e) => setNewEquipment((f) => ({ ...f, location: e.target.value }))} /></Field>
                <Field label="Notes"><textarea className="input min-h-20" value={newEquipment.notes} onChange={(e) => setNewEquipment((f) => ({ ...f, notes: e.target.value }))} /></Field>
                <button className="btn-primary" disabled={busy || !newEquipment.name.trim()} onClick={() => void addEquipment()}>{busy ? <Spinner /> : <Plus className="h-4 w-4" />} Add</button>
              </div>
            </section>
          )}

          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-100">Equipment list</h2>
            <div className="space-y-2">
              {equipment.length === 0 ? <p className="text-sm text-ink-500">No equipment registered yet.</p> : equipment.map((item) => (
                <div key={item.id} className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
                  <p className="font-semibold text-ink-900 dark:text-ink-50">{item.name}</p>
                  <p className="text-xs text-ink-500">{item.location || 'No location'}{item.notes ? ` - ${item.notes}` : ''}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          {canEdit && (
            <section className="card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-100">
                <CalendarPlus className="h-4 w-4" /> Book instrument
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Equipment"><select className="input" value={booking.equipment_id} onChange={(e) => setBooking((f) => ({ ...f, equipment_id: e.target.value }))}>{equipment.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                <Field label="Purpose"><input className="input" value={booking.purpose} onChange={(e) => setBooking((f) => ({ ...f, purpose: e.target.value }))} /></Field>
                <Field label="Start"><input className="input" type="datetime-local" value={booking.start_time} onChange={(e) => setBooking((f) => ({ ...f, start_time: e.target.value }))} /></Field>
                <Field label="End"><input className="input" type="datetime-local" value={booking.end_time} onChange={(e) => setBooking((f) => ({ ...f, end_time: e.target.value }))} /></Field>
                <Field label="Related research asset"><select className="input" value={booking.related_research_asset_id} onChange={(e) => setBooking((f) => ({ ...f, related_research_asset_id: e.target.value }))}><option value="">None</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.stable_id ? `${asset.stable_id} - ` : ''}{asset.title}</option>)}</select></Field>
                <div className="flex items-end"><button className="btn-primary" disabled={busy || !booking.equipment_id || !booking.purpose.trim()} onClick={() => void addBooking()}>{busy ? <Spinner /> : <CalendarPlus className="h-4 w-4" />} Book</button></div>
              </div>
            </section>
          )}

          <section className="card overflow-hidden">
            <div className="border-b border-ink-200 bg-ink-50 px-4 py-3 dark:border-ink-800 dark:bg-ink-950">
              <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">Next 7 days</h2>
            </div>
            <div className="grid divide-y divide-ink-100 dark:divide-ink-800 lg:grid-cols-7 lg:divide-x lg:divide-y-0">
              {weekDays.map((day) => {
                const rows = bookingsByDay.get(dateKey(day)) ?? []
                return (
                  <div key={dateKey(day)} className="min-h-36 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                      {day.toLocaleDateString([], { weekday: 'short', day: 'numeric' })}
                    </p>
                    <div className="mt-3 space-y-2">
                      {rows.length === 0 ? (
                        <p className="text-xs text-ink-400">Free</p>
                      ) : rows.map((row) => (
                        <div key={row.id} className="rounded border border-pearl-200 bg-pearl-50 p-2 text-xs text-pearl-900 dark:border-pearl-500/20 dark:bg-pearl-500/10 dark:text-pearl-100">
                          <p className="font-semibold">{timeLabel(row.start_time)} - {timeLabel(row.end_time)}</p>
                          <p className="mt-1 line-clamp-2">{row.equipment_name ?? equipment.find((item) => item.id === row.equipment_id)?.name ?? 'Equipment'}</p>
                          <p className="mt-1 line-clamp-2 text-pearl-700 dark:text-pearl-300">{row.purpose}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-ink-200 bg-ink-50 px-4 py-3 dark:border-ink-800 dark:bg-ink-950">
              <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">Upcoming bookings</h2>
            </div>
            {upcoming.length === 0 ? <p className="p-4 text-sm text-ink-500">No upcoming bookings.</p> : (
              <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                {upcoming.map((row) => (
                  <li key={row.id} className="px-4 py-3">
                    <p className="font-semibold text-ink-900 dark:text-ink-50">{row.equipment_name ?? equipment.find((item) => item.id === row.equipment_id)?.name ?? 'Equipment'}</p>
                    <p className="text-sm text-ink-600 dark:text-ink-300">{row.purpose}</p>
                    <p className="mt-1 text-xs text-ink-500">{formatDate(row.start_time.slice(0, 10))} {timeLabel(row.start_time)} - {timeLabel(row.end_time)} by {row.booked_by_name ?? 'Unknown'}</p>
                    {row.related_research_asset_title && <p className="mt-1 text-xs text-pearl-700 dark:text-pearl-300">Generated: {row.related_research_asset_title}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
