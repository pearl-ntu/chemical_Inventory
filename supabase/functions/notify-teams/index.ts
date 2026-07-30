/**
 * Posts a plain-text message into a Microsoft Teams channel via the
 * Workflows app (Power Automate) — NOT the old Connectors/Incoming Webhook
 * flow, which Microsoft retired. Set up: Teams channel > Workflows > "Post
 * to a channel when a webhook request is received" > copy the generated
 * HTTP POST URL into the TEAMS_WEBHOOK_URL secret.
 *
 * Called two ways:
 *  - By Postgres triggers (pg_net), authenticated with the project's own
 *    service role key — this is the normal path, so a Teams post can never
 *    be missed just because a client tab was closed before finishing an
 *    action.
 *  - By the daily inventory-alerts function, for the same reason Slack
 *    already gets a daily digest.
 */
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const key = secretKey()
  if (!key) return json({ error: 'Supabase service role key is not configured' }, 500)

  const authorization = req.headers.get('authorization') ?? ''
  const provided = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!provided || provided !== key) {
    return json({ error: "This function is only callable by the project's own triggers/jobs" }, 401)
  }

  const webhookUrl = Deno.env.get('TEAMS_WEBHOOK_URL')
  if (!webhookUrl) return json({ posted: false, reason: 'TEAMS_WEBHOOK_URL is not configured' })

  let body: { message?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const message = (body.message ?? '').trim()
  if (!message) return json({ error: 'message is required' }, 400)

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: message }),
  })
  if (!res.ok) return json({ error: `Teams post failed: ${(await res.text()).slice(0, 300)}` }, 502)

  return json({ posted: true })
})
