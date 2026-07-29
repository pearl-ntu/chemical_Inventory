import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

const hits = new Map<string, number[]>()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function rateLimited(userId: string) {
  const now = Date.now()
  const windowMs = 60_000
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= 12) {
    hits.set(userId, recent)
    return true
  }
  recent.push(now)
  hits.set(userId, recent)
  return false
}

function publishableKey(): string | null {
  const keys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
  if (keys) {
    try {
      const parsed = JSON.parse(keys)
      if (typeof parsed === 'string') return parsed
      if (Array.isArray(parsed)) return parsed.find((value) => typeof value === 'string') ?? null
      if (parsed && typeof parsed === 'object') {
        return Object.values(parsed).find((value) => typeof value === 'string') as string | undefined ?? null
      }
    } catch {
      return keys
    }
  }
  return Deno.env.get('SUPABASE_ANON_KEY')
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

async function callModel(prompt: string): Promise<string> {
  const provider = (Deno.env.get('ASK_PEARL_PROVIDER') ?? '').toLowerCase()
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  const openRouterKey = Deno.env.get('OPENROUTER_API_KEY')
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  const selected =
    provider || (geminiKey ? 'gemini' : openRouterKey ? 'openrouter' : anthropicKey ? 'anthropic' : '')

  if (selected === 'gemini') {
    if (!geminiKey) throw new Error('GEMINI_API_KEY is not configured')
    const model = Deno.env.get('ASK_PEARL_MODEL') ?? Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash'
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': geminiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: 'You are Ask PEARL, a careful read-only lab inventory assistant. Answer only from the supplied JSON context. If the context is insufficient, say what is missing. Do not invent records, prices, safety rules, or file contents. Be concise and include specific record names/codes when useful.',
              },
            ],
          },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 900 },
        }),
      },
    )
    if (!upstream.ok) throw new Error(`Gemini error: ${(await upstream.text()).slice(0, 500)}`)
    const result = await upstream.json()
    return (
      result?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text ?? '')
        ?.join('\n\n')
        ?.trim() || 'No answer was returned.'
    )
  }

  if (selected === 'openrouter') {
    if (!openRouterKey) throw new Error('OPENROUTER_API_KEY is not configured')
    const model = Deno.env.get('ASK_PEARL_MODEL') ?? Deno.env.get('OPENROUTER_MODEL') ?? 'openrouter/free'
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${openRouterKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are Ask PEARL, a careful read-only lab inventory assistant. Answer only from the supplied JSON context. If the context is insufficient, say what is missing. Do not invent records, prices, safety rules, or file contents. Be concise and include specific record names/codes when useful.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 900,
      }),
    })
    if (!upstream.ok) throw new Error(`OpenRouter error: ${(await upstream.text()).slice(0, 500)}`)
    const result = await upstream.json()
    return String(result?.choices?.[0]?.message?.content ?? '').trim() || 'No answer was returned.'
  }

  if (selected === 'anthropic') {
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY is not configured')
    const model = Deno.env.get('ASK_PEARL_MODEL') ?? Deno.env.get('ANTHROPIC_MODEL')
    if (!model) throw new Error('ASK_PEARL_MODEL or ANTHROPIC_MODEL is not configured')
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        system:
          'You are Ask PEARL, a careful read-only lab inventory assistant. Answer only from the supplied JSON context. If the context is insufficient, say what is missing. Do not invent records, prices, safety rules, or file contents. Be concise and include specific record names/codes when useful.',
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!upstream.ok) throw new Error(`Anthropic error: ${(await upstream.text()).slice(0, 500)}`)
    const result = await upstream.json()
    return (
      result?.content
        ?.filter((part: { type?: string }) => part.type === 'text')
        ?.map((part: { text?: string }) => part.text ?? '')
        ?.join('\n\n')
        ?.trim() || 'No answer was returned.'
    )
  }

  if (selected === 'ollama' || selected === 'local') {
    const baseUrl = Deno.env.get('ASK_PEARL_BASE_URL') ?? Deno.env.get('OLLAMA_BASE_URL')
    if (!baseUrl) throw new Error('ASK_PEARL_BASE_URL or OLLAMA_BASE_URL is not configured')
    const model = Deno.env.get('ASK_PEARL_MODEL') ?? Deno.env.get('OLLAMA_MODEL') ?? 'qwen2.5:7b-instruct'
    const upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `You are Ask PEARL, a careful read-only lab inventory assistant. Answer only from the supplied JSON context. If the context is insufficient, say what is missing. Do not invent records, prices, safety rules, or file contents. Be concise and include specific record names/codes when useful.\n\n${prompt}`,
        stream: false,
        options: { num_predict: 900 },
      }),
    })
    if (!upstream.ok) throw new Error(`Local model error: ${(await upstream.text()).slice(0, 500)}`)
    const result = await upstream.json()
    return String(result?.response ?? '').trim() || 'No answer was returned.'
  }

  throw new Error('Configure ASK_PEARL_PROVIDER plus a matching server-side API key secret')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorization = req.headers.get('authorization')
  if (!authorization) return json({ error: 'Missing authorization header' }, 401)
  const jwt = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return json({ error: 'Missing user session token' }, 401)
  const userId = userIdFromJwt(jwt)
  if (!userId) return json({ error: 'Invalid session token format' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const apiKey = publishableKey()
  if (!url || !apiKey) return json({ error: 'Supabase environment is not configured' }, 500)

  const supabase = createClient(url, apiKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false },
  })

  if (rateLimited(userId)) return json({ error: 'Too many questions. Try again in a minute.' }, 429)

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, approved')
    .eq('id', userId)
    .single()
  if (profileError || !profile?.approved) {
    return json({ error: `Profile is not approved or session was rejected: ${profileError?.message ?? 'no profile returned'}` }, 403)
  }

  const body = await req.json().catch(() => ({}))
  const question = String(body.question ?? '').trim().slice(0, 1200)
  const workspace = body.workspace === 'computational' ? 'computational' : 'experimental'
  if (!question) return json({ error: 'Question is required' }, 400)

  const [chemicals, assets, requests] = await Promise.all([
    supabase
      .from('chemicals')
      .select('code,name,cas,location,sub_location,supplier,quantity,size_value,size_unit,status,hazards,expiry_date,opened_date,reorder_priority,owner,project,remarks')
      .limit(300),
    supabase
      .from('research_assets')
      .select('stable_id,type,title,project,owner,software,method,status,visibility,last_verified_at,tags,notes')
      .limit(220),
    supabase
      .from('chemical_requests')
      .select('id,status,chemical_name_or_cas,supplier,quantity,justification_project,notes,requested_by_name,requested_at,decided_at,received_container_id')
      .order('requested_at', { ascending: false })
      .limit(120),
  ])

  const context = {
    user: { name: profile.full_name, role: profile.role },
    workspace,
    chemicals: chemicals.data ?? [],
    research_assets: assets.data ?? [],
    chemical_requests: requests.data ?? [],
  }

  const prompt = `The user is currently in the ${workspace} workspace.\n\nQuestion: ${question}\n\nScoped JSON context:\n${JSON.stringify(context)}`
  let answer = ''
  try {
    answer = await callModel(prompt)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Assistant provider error' }, 502)
  }

  return json({
    answer,
    sources: [
      { table: 'chemicals', count: chemicals.data?.length ?? 0 },
      { table: 'research_assets', count: assets.data?.length ?? 0 },
      { table: 'chemical_requests', count: requests.data?.length ?? 0 },
    ],
  })
})
