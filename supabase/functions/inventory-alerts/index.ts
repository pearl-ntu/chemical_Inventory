/**
 * Daily digest of expiring-soon and low-stock/reorder chemicals, posted to a
 * Slack channel via an Incoming Webhook. Meant to be triggered on a schedule
 * (see supabase/upgrade_inventory_alerts_cron.sql for the pg_cron wiring),
 * not by a browser session — there's no end user here, so it's gated by the
 * project's own service-role key rather than a user JWT.
 *
 * Read-only: this only queries `chemicals` and posts a summary to Slack. It
 * never writes anything back.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
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

interface ChemicalRow {
  id: string
  code: string
  name: string
  status: string
  location: string | null
  expiry_date: string | null
  reorder_priority: string
  supplier: string | null
}

function formatList(rows: ChemicalRow[], describe: (row: ChemicalRow) => string, limit = 10): string {
  if (rows.length === 0) return '_none_'
  const shown = rows
    .slice(0, limit)
    .map((row) => `• *${row.name}* (${row.code})${row.location ? ` — ${row.location}` : ''} — ${describe(row)}`)
    .join('\n')
  const more = rows.length > limit ? `\n_…and ${rows.length - limit} more_` : ''
  return shown + more
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const key = secretKey()
  if (!key) return json({ error: 'Supabase service role key is not configured' }, 500)

  const authorization = req.headers.get('authorization') ?? ''
  const provided = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!provided || provided !== key) {
    return json({ error: 'This function is only callable by the project\'s own scheduler' }, 401)
  }

  const slackWebhookUrl = Deno.env.get('SLACK_WEBHOOK_URL')
  const teamsWebhookUrl = Deno.env.get('TEAMS_WEBHOOK_URL')
  if (!slackWebhookUrl && !teamsWebhookUrl) {
    return json({ error: 'Neither SLACK_WEBHOOK_URL nor TEAMS_WEBHOOK_URL is configured' }, 500)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl) return json({ error: 'SUPABASE_URL is not configured' }, 500)

  const supabase = createClient(supabaseUrl, key, { auth: { persistSession: false } })

  const { data, error } = await supabase
    .from('chemicals')
    .select('id, code, name, status, location, expiry_date, reorder_priority, supplier')
    .in('status', ['active', 'low'])
  if (error) return json({ error: `Query failed: ${error.message}` }, 500)

  const rows = (data ?? []) as ChemicalRow[]
  const soon = new Date()
  soon.setMonth(soon.getMonth() + 3)

  const expiring = rows
    .filter((c) => c.expiry_date && new Date(c.expiry_date) <= soon)
    .sort((a, b) => (a.expiry_date ?? '').localeCompare(b.expiry_date ?? ''))
  const reorder = rows.filter((c) => c.status === 'low' || c.reorder_priority !== 'none')

  if (expiring.length === 0 && reorder.length === 0) {
    return json({ posted: false, expiring: 0, reorder: 0, reason: 'nothing to report' })
  }

  const describeReorder = (c: ChemicalRow) =>
    (c.status === 'low' ? 'low stock' : c.reorder_priority) + (c.supplier ? ` — usually from ${c.supplier}` : '')

  const errors: string[] = []

  if (slackWebhookUrl) {
    const text =
      `*PEARL Inventory — daily alerts*\n\n` +
      `*Expiring within 3 months (${expiring.length}):*\n${formatList(expiring, (c) => `expires ${c.expiry_date}`)}\n\n` +
      `*Low stock / reorder (${reorder.length}):*\n${formatList(reorder, describeReorder)}`
    const slackRes = await fetch(slackWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!slackRes.ok) errors.push(`Slack post failed: ${(await slackRes.text()).slice(0, 300)}`)
  }

  if (teamsWebhookUrl) {
    // Plain text, not Slack's *bold* mrkdwn — Teams' Workflows "post a
    // message" action doesn't render that syntax.
    const text =
      `PEARL Inventory — daily alerts\n\n` +
      `Expiring within 3 months (${expiring.length}):\n${formatList(expiring, (c) => `expires ${c.expiry_date}`)}\n\n` +
      `Low stock / reorder (${reorder.length}):\n${formatList(reorder, describeReorder)}`
    const teamsRes = await fetch(teamsWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!teamsRes.ok) errors.push(`Teams post failed: ${(await teamsRes.text()).slice(0, 300)}`)
  }

  if (errors.length > 0) return json({ posted: true, errors, expiring: expiring.length, reorder: reorder.length }, 207)
  return json({ posted: true, expiring: expiring.length, reorder: reorder.length })
})
