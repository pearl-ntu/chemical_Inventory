// Reads a photographed delivery order/invoice and returns a best guess at
// the chemical's purchase details — never applied automatically. The client
// always shows these as a checklist the person confirms before anything
// touches the registration form.
//
// Deploy: supabase functions deploy extract-invoice
// Needs a secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EXTRACTION_TOOL = {
  name: 'record_invoice_fields',
  description:
    'Record the chemical purchase details read from a delivery order or invoice photo. Only include a field if it is actually visible and legible — never guess or estimate a value that is not on the page.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The chemical or product name as printed.' },
      cas: { type: 'string', description: 'CAS registry number, e.g. 64-17-5.' },
      supplier: { type: 'string', description: 'The vendor/supplier name on the invoice letterhead.' },
      catalog_no: { type: 'string', description: 'Catalogue / product / SKU number.' },
      quantity: { type: 'number', description: 'Number of containers/units ordered.' },
      size_value: { type: 'number', description: 'Pack size per container, numeric part only.' },
      size_unit: {
        type: 'string',
        enum: ['g', 'mg', 'kg', 'mL', 'L', 'µL', 'mol', 'mmol', 'units'],
        description: 'Pack size unit.',
      },
      purity: { type: 'string', description: 'Purity or grade, e.g. "98%" or "ACS grade".' },
      price: { type: 'number', description: 'Line-item or unit price, numeric part only.' },
      currency: { type: 'string', description: '3-letter currency code, e.g. SGD, USD.' },
      system: { type: 'string', description: 'Purchasing system/platform named on the document, if any.' },
    },
  },
} as const

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured on this project.')

    // Same authorization gate as the rest of the app: signed in AND approved,
    // not just "holds a valid token." Checked here explicitly because Edge
    // Functions only verify the JWT is real, not the app's own approval flag.
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Sign in required.' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('approved')
      .eq('id', userData.user.id)
      .maybeSingle()
    if (!profile?.approved) {
      return new Response(JSON.stringify({ error: 'Your account is not approved yet.' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const { image, mediaType } = (await req.json()) as { image?: string; mediaType?: string }
    if (!image || !mediaType) throw new Error('Missing image data.')

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        tools: [EXTRACTION_TOOL],
        tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
              {
                type: 'text',
                text: 'This is a photo of a chemical delivery order or invoice. Extract the purchase details using the tool provided. Leave out any field that is not clearly legible in the photo — do not guess.',
              },
            ],
          },
        ],
      }),
    })

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text()
      throw new Error(`Extraction service error (${anthropicRes.status}): ${detail.slice(0, 300)}`)
    }

    const result = await anthropicRes.json()
    const toolUse = result.content?.find((b: { type: string }) => b.type === 'tool_use')
    const fields = toolUse?.input ?? {}

    return new Response(JSON.stringify({ fields }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Extraction failed.' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
