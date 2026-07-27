import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../lib/api'
import type { Chemical, ChemicalInput } from '../lib/types'
import { todayISO } from '../lib/utils'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'

interface InventoryState {
  /**
   * Everything this account can see: the whole approved shelf, plus any
   * pending/rejected rows they're allowed to (their own, or all of them if
   * they're an admin). Most pages should use `approvedChemicals` instead —
   * this raw list exists for the approvals queue and "my submissions" views.
   */
  chemicals: Chemical[]
  /** The vetted, shared shelf — what every ordinary page should read from. */
  approvedChemicals: Chemical[]
  /** Awaiting admin review: all of them if admin, just this user's own otherwise. */
  pendingChemicals: Chemical[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  create: (input: ChemicalInput) => Promise<Chemical>
  update: (id: string, patch: Partial<Chemical>, note?: string) => Promise<Chemical>
  remove: (row: Chemical) => Promise<void>
  markEmpty: (row: Chemical) => Promise<void>
  restock: (row: Chemical, quantity: number) => Promise<void>
  approve: (row: Chemical) => Promise<void>
  reject: (row: Chemical, reason: string) => Promise<void>
  importRows: (rows: ChemicalInput[]) => Promise<number>
  loadStarterData: () => Promise<number>
}

const Ctx = createContext<InventoryState | null>(null)

export function InventoryProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [chemicals, setChemicals] = useState<Chemical[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setError(null)
      setChemicals(await api.listChemicals())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!profile) {
      setChemicals([])
      setLoading(false)
      return
    }
    setLoading(true)
    void reload()
    // Realtime: another bench editing the shelf shows up here without a refresh.
    return api.subscribe(() => {
      void reload()
    })
  }, [profile, reload])

  const requireProfile = useCallback(() => {
    if (!profile) throw new Error('You need to be signed in to do that.')
    return profile
  }, [profile])

  const approvedChemicals = useMemo(
    () => chemicals.filter((c) => c.review_status === 'approved'),
    [chemicals],
  )
  const pendingChemicals = useMemo(
    () => chemicals.filter((c) => c.review_status === 'pending'),
    [chemicals],
  )

  const value = useMemo<InventoryState>(
    () => ({
      chemicals,
      approvedChemicals,
      pendingChemicals,
      loading,
      error,
      reload,

      async create(input) {
        const row = await api.createChemical(input, requireProfile())
        setChemicals((prev) => [row, ...prev])
        return row
      },

      async update(id, patch, note) {
        const row = await api.updateChemical(id, patch, requireProfile(), note)
        setChemicals((prev) => prev.map((c) => (c.id === id ? row : c)))
        return row
      },

      async remove(row) {
        await api.deleteChemical(row, requireProfile())
        setChemicals((prev) => prev.filter((c) => c.id !== row.id))
      },

      async markEmpty(row) {
        const actor = requireProfile()
        const updated = await api.updateChemical(
          row.id,
          { status: 'empty', date_emptied: todayISO(), quantity: 0 },
          actor,
          `${row.name} marked empty`,
        )
        setChemicals((prev) => prev.map((c) => (c.id === row.id ? updated : c)))
        toast.info(`${row.name} marked empty.`)
      },

      async restock(row, quantity) {
        const actor = requireProfile()
        const updated = await api.updateChemical(
          row.id,
          { status: 'active', date_emptied: null, quantity },
          actor,
          `${row.name} restocked to ${quantity}`,
        )
        setChemicals((prev) => prev.map((c) => (c.id === row.id ? updated : c)))
      },

      async approve(row) {
        const updated = await api.approveChemical(row, requireProfile())
        setChemicals((prev) => prev.map((c) => (c.id === row.id ? updated : c)))
        toast.success(`${row.name} approved — it's now on the shared shelf.`)
      },

      async reject(row, reason) {
        const updated = await api.rejectChemical(row, requireProfile(), reason)
        setChemicals((prev) => prev.map((c) => (c.id === row.id ? updated : c)))
        toast.info(`${row.name} rejected.`)
      },

      async importRows(rows) {
        const n = await api.importChemicals(rows, requireProfile())
        await reload()
        return n
      },

      async loadStarterData() {
        const n = await api.loadStarterData(requireProfile())
        await reload()
        return n
      },
    }),
    [chemicals, approvedChemicals, pendingChemicals, loading, error, reload, requireProfile, toast],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useInventory(): InventoryState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useInventory must be used inside <InventoryProvider>')
  return ctx
}
