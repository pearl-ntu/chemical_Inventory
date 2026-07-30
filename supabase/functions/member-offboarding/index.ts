import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

type ResourceType = 'chemical' | 'research_asset'

interface TransferInput {
  resource_type: ResourceType
  resource_id: string
  to_member_id: string
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  try {
    return JSON.stringify(err)
  } catch {
    return fallback
  }
}

function userIdFromJwt(jwt: string): string | null {
  try {
    const payload = jwt.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const jsonText = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
    const claims = JSON.parse(jsonText)
    return typeof claims.sub === 'string' ? claims.sub : null
  } catch {
    return null
  }
}

function secretKey(): string | null {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (keys) {
    try {
      const parsed = JSON.parse(keys)
      if (typeof parsed === 'string') return parsed
      if (Array.isArray(parsed)) return parsed.find((value) => typeof value === 'string') ?? null
      if (parsed && typeof parsed === 'object') {
        return (Object.values(parsed).find((value) => typeof value === 'string') as string | undefined) ?? null
      }
    } catch {
      return keys
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
}

function itemForChemical(row: Record<string, unknown>) {
  return {
    resource_type: 'chemical',
    resource_id: row.id,
    title: row.name,
    subtitle: row.code,
    project: row.project,
    location: [row.location, row.sub_location].filter(Boolean).join(' / ') || null,
    status: row.status,
    stable_id: null,
    owner: row.owner,
    created_by: row.created_by,
    size_label: [row.quantity ? `${row.quantity}x` : null, row.size_value ? `${row.size_value} ${row.size_unit}` : null]
      .filter(Boolean)
      .join(' ') || null,
    storage_link: null,
  }
}

function itemForAsset(row: Record<string, unknown>) {
  return {
    resource_type: 'research_asset',
    resource_id: row.id,
    title: row.title,
    subtitle: [row.stable_id, row.type, row.software].filter(Boolean).join(' - ') || null,
    project: row.project,
    location: row.external_path,
    status: row.status,
    stable_id: row.stable_id,
    owner: row.owner,
    created_by: row.created_by,
    size_label: row.size_label ?? (typeof row.size_bytes === 'number' ? `${row.size_bytes} bytes` : null),
    storage_link: row.storage_link ?? row.output_link ?? row.repo_link,
    size_bytes: row.size_bytes,
  }
}

function projectRollup(items: Array<{ project: unknown; size_bytes?: unknown }>) {
  const map = new Map<string, { name: string; count: number; size_bytes: number | null }>()
  for (const item of items) {
    const name = typeof item.project === 'string' && item.project.trim() ? item.project.trim() : 'Unassigned project'
    const current = map.get(name) ?? { name, count: 0, size_bytes: null }
    current.count += 1
    if (typeof item.size_bytes === 'number') current.size_bytes = (current.size_bytes ?? 0) + item.size_bytes
    map.set(name, current)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

function uniqueRows(rows: Array<Record<string, unknown>>) {
  const map = new Map<unknown, Record<string, unknown>>()
  for (const row of rows) map.set(row.id, row)
  return [...map.values()]
}

async function selectChemicals(service: ReturnType<typeof createClient>, targetId: string, aliases: string[]) {
  const columns = 'id, code, name, project, location, sub_location, status, owner, created_by, quantity, size_value, size_unit'
  const rows: Array<Record<string, unknown>> = []

  const byOwner = await service
    .from('chemicals')
    .select(columns)
    .in('owner', aliases)
    .order('name', { ascending: true })
  if (byOwner.error && /column .* does not exist|Could not find/i.test(byOwner.error.message)) {
    const fallback = await service
      .from('chemicals')
      .select('id, code, name, project, location, sub_location, status, owner, quantity, size_value, size_unit')
      .in('owner', aliases)
      .order('name', { ascending: true })
    if (fallback.error) throw fallback.error
    rows.push(...(fallback.data ?? []))
    return uniqueRows(rows)
  }
  if (byOwner.error) throw byOwner.error
  rows.push(...(byOwner.data ?? []))

  const byCreator = await service
    .from('chemicals')
    .select(columns)
    .eq('created_by', targetId)
    .order('name', { ascending: true })
  if (!byCreator.error) rows.push(...(byCreator.data ?? []))

  return uniqueRows(rows)
}

async function selectResearchAssets(service: ReturnType<typeof createClient>, targetId: string, aliases: string[]) {
  const columns = 'id, stable_id, type, title, project, owner, created_by, created_by_name, status, external_path, storage_link, output_link, repo_link, size_bytes, size_label, software'
  const fallbackColumns = 'id, stable_id, type, title, project, owner, created_by, created_by_name, status, external_path, storage_link, output_link, repo_link, size_bytes, software'
  const legacyColumns = 'id, type, title, project, owner, created_by, created_by_name, status, external_path, storage_link, output_link, repo_link, size_bytes, software'
  const rows: Array<Record<string, unknown>> = []

  async function addResult(query: PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>, fallback?: () => PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>) {
    const result = await query
    if (result.error && /relation .* does not exist|Could not find the table/i.test(result.error.message)) return
    if (result.error && fallback && /column .* does not exist|Could not find/i.test(result.error.message)) {
      const fallbackResult = await fallback()
      if (fallbackResult.error && /relation .* does not exist|Could not find the table/i.test(fallbackResult.error.message)) return
      if (fallbackResult.error && /column .* does not exist|Could not find/i.test(fallbackResult.error.message)) {
        return
      }
      if (fallbackResult.error) throw fallbackResult.error
      rows.push(...(fallbackResult.data ?? []))
      return
    }
    if (result.error) throw result.error
    rows.push(...(result.data ?? []))
  }

  await addResult(
    service.from('research_assets').select(columns).eq('created_by', targetId),
    async () => {
      const fallback = await service.from('research_assets').select(fallbackColumns).eq('created_by', targetId)
      if (fallback.error && /stable_id/i.test(fallback.error.message)) {
        return await service.from('research_assets').select(legacyColumns).eq('created_by', targetId)
      }
      return fallback
    },
  )
  if (aliases.length) {
    await addResult(
      service.from('research_assets').select(columns).in('owner', aliases),
      async () => {
        const fallback = await service.from('research_assets').select(fallbackColumns).in('owner', aliases)
        if (fallback.error && /stable_id/i.test(fallback.error.message)) {
          return await service.from('research_assets').select(legacyColumns).in('owner', aliases)
        }
        return fallback
      },
    )
  }

  return uniqueRows(rows)
}

async function loadSummary(service: ReturnType<typeof createClient>, target: Record<string, unknown>) {
  const fullName = String(target.full_name ?? '')
  const email = String(target.email ?? '')
  const targetId = String(target.id)
  const aliases = [fullName, email].filter((value) => value.trim())

  const chemicals = await selectChemicals(service, targetId, aliases)
  const assets = await selectResearchAssets(service, targetId, aliases)

  const chemicalItems = chemicals.map(itemForChemical)
  const assetItems = assets.map(itemForAsset)

  return {
    member: { id: target.id, full_name: target.full_name, email: target.email },
    chemicals: chemicalItems,
    research_assets: assetItems,
    projects: projectRollup([...chemicalItems, ...assetItems]),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorization = req.headers.get('authorization')
  if (!authorization) return json({ error: 'Missing authorization header' }, 401)
  const userId = userIdFromJwt(authorization.replace(/^Bearer\s+/i, '').trim())
  if (!userId) return json({ error: 'Invalid session token format' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const key = secretKey()
  if (!url || !key) return json({ error: 'Service role environment is not configured' }, 500)

  const service = createClient(url, key, { auth: { persistSession: false } })
  const { data: actor, error: actorError } = await service
    .from('profiles')
    .select('id, full_name, email, role, approved, is_pi')
    .eq('id', userId)
    .single()
  if (actorError || !actor?.approved || actor.role !== 'admin') {
    return json({ error: 'Only approved admins can run member handover.' }, 403)
  }

  const body = await req.json().catch(() => ({}))
  const targetId = String(body.target_member_id ?? '')
  if (!targetId) return json({ error: 'target_member_id is required' }, 400)

  const { data: target, error: targetError } = await service
    .from('profiles')
    .select('id, full_name, email, role, approved, is_pi')
    .eq('id', targetId)
    .single()
  if (targetError || !target) return json({ error: 'Target member not found' }, 404)
  if (target.is_pi && !actor.is_pi) {
    return json({ error: 'Only the PI can run handover for the PI account.' }, 403)
  }

  if (body.action === 'delete_member') {
    if (target.id === actor.id) {
      return json({ error: 'You cannot remove your own account from the Members page.' }, 400)
    }
    const { error } = await service.auth.admin.deleteUser(targetId)
    if (error) return json({ error: error.message }, 500)
    return json({ deleted: true })
  }

  if (body.action === 'summary') {
    try {
      return json(await loadSummary(service, target))
    } catch (err) {
      return json({ error: errorMessage(err, 'Could not load handover summary') }, 500)
    }
  }

  if (body.action === 'transfer') {
    const transfers = Array.isArray(body.transfers) ? (body.transfers as TransferInput[]) : []
    if (transfers.length === 0) return json(await loadSummary(service, target))

    const profileIds = [...new Set(transfers.map((transfer) => transfer.to_member_id))]
    const { data: destinations, error: destinationError } = await service
      .from('profiles')
      .select('id, full_name, email, approved')
      .in('id', profileIds)
    if (destinationError) return json({ error: destinationError.message }, 500)
    const destinationMap = new Map((destinations ?? []).filter((row) => row.approved).map((row) => [row.id, row]))

    for (const transfer of transfers) {
      const to = destinationMap.get(transfer.to_member_id)
      if (!to) return json({ error: 'Every transfer needs an approved destination member.' }, 400)

      if (transfer.resource_type === 'chemical') {
        const { error } = await service
          .from('chemicals')
          .update({ owner: to.full_name })
          .eq('id', transfer.resource_id)
        if (error) return json({ error: error.message }, 500)
      } else if (transfer.resource_type === 'research_asset') {
        const { error } = await service
          .from('research_assets')
          .update({
            owner: to.full_name,
            created_by: to.id,
            created_by_name: to.full_name,
          })
          .eq('id', transfer.resource_id)
        if (error) return json({ error: error.message }, 500)
      } else {
        return json({ error: 'Unsupported resource_type' }, 400)
      }

      await service.from('ownership_transfers').insert({
        resource_type: transfer.resource_type,
        resource_id: transfer.resource_id,
        from_member: target.id,
        from_member_name: target.full_name,
        to_member: to.id,
        to_member_name: to.full_name,
        transferred_by: actor.id,
        transferred_by_name: actor.full_name,
      })
    }

    return json(await loadSummary(service, target))
  }

  return json({ error: 'Unsupported action' }, 400)
})
