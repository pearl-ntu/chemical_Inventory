import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../context/ToastContext'
import { api } from './api'
import { LAB_LOCATIONS, LAB_SUB_LOCATIONS } from './labLocations'
import type { Chemical, LabLocation, Profile } from './types'
import { uniqueSorted } from './utils'

export function useLabLocations(chemicals: Chemical[] = []) {
  const toast = useToast()
  const [custom, setCustom] = useState<LabLocation[]>([])
  const [loading, setLoading] = useState(true)

  async function reload() {
    try {
      setCustom(await api.listLabLocations())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load custom lab locations.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const locations = useMemo(
    () =>
      uniqueSorted([
        ...LAB_LOCATIONS,
        ...custom.filter((row) => row.kind === 'location').map((row) => row.name),
        ...chemicals.map((chemical) => chemical.location),
      ]),
    [chemicals, custom],
  )

  const subLocations = useMemo(
    () =>
      uniqueSorted([
        ...LAB_SUB_LOCATIONS,
        ...custom.filter((row) => row.kind === 'sub_location').map((row) => row.name),
        ...chemicals.map((chemical) => chemical.sub_location),
      ]),
    [chemicals, custom],
  )

  async function add(name: string, kind: LabLocation['kind'], actor: Profile) {
    const row = await api.addLabLocation(name, kind, actor)
    setCustom((prev) => {
      if (prev.some((item) => item.id === row.id)) return prev
      return [...prev, row]
    })
    return row
  }

  async function remove(row: LabLocation) {
    await api.deleteLabLocation(row)
    setCustom((prev) => prev.filter((item) => item.id !== row.id))
  }

  return { custom, locations, subLocations, loading, reload, add, remove }
}
