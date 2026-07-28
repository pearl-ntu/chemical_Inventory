// Reads a photographed delivery order/invoice and returns a best guess at
// the chemical's purchase details — never applied automatically. The client
// always shows these as a checklist the person confirms before anything
// touches the registration form.
//
// Deploy: supabase functions deploy extract-invoice
// Needs a secret: supabase secrets set OPENAI_API_KEY=sk-...
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Structured Outputs (json_schema, strict mode) requires every property to
// be listed in `required` — "optional" is expressed by unioning with `null`
// instead of omitting the key, and the model is told to use null rather
// than guess when a field isn't actually legible on the page.
const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: ['string', 'null'], description: 'The chemical or product name as printed.' },
    cas: { type: ['string', 'null'], description: 'CAS registry number, e.g. 64-17-5.' },
    supplier: { type: ['string', 'null'], description: 'The vendor/supplier name on the invoice letterhead.' },
    catalog_no: { type: ['string', 'null'], description: 'Catalogue / product / SKU number.' },
    quantity: { type: ['number', 'null'], description: 'Number of containers/units ordered.' },
    size_value: { type: ['number', 'null'], description: 'Pack size per container, numeric part only.' },
    size_unit: {
      type: ['string', 'null'],
      enum: ['g', 'mg', 'kg', 'mL', 'L', 'µL', 'mol', 'mmol', 'units', null],
      description: 'Pack size unit.',
    },
    purity: { type: ['string', 'null'], description: 'Purity or grade, e.g. "98%" or "ACS grade".' },
    price: { type: ['number', 'null'], description: 'Line-item or unit price, numeric part only.' },
    currency: { type: ['string', 'null'], description: '3-letter currency code, e.g. SGD, USD.' },
    system: { type: ['string', 'null'], description: 'Purchasing system/platform named on the document, if any.' },
  },
  required: [
    'name', 'cas', 'supplier', 'catalog_no', 'quantity', 'size_value',
    'size_unit', 'purity', 'price', 'currency', 'system',
  ],
  additionalProperties: false,
} as const

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on this project.')

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

    const openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'This is a photo of a chemical delivery order or invoice. Extract the purchase details. Use null for any field that is not clearly legible in the photo — never guess or estimate.',
              },
              { type: 'input_image', image_url: `data:${mediaType};base64,${image}`, detail: 'auto' },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'invoice_fields',
            schema: EXTRACTION_SCHEMA,
            strict: true,
          },
        },
      }),
    })

    if (!openaiRes.ok) {
      const detail = await openaiRes.text()
      throw new Error(`Extraction service error (${openaiRes.status}): ${detail.slice(0, 300)}`)
    }

    const result = await openaiRes.json()
    const message = result.output?.find((item: { type: string }) => item.type === 'message')
    const textBlock = message?.content?.find((c: { type: string }) => c.type === 'output_text')
    if (!textBlock) {
      const refusal = message?.content?.find((c: { type: string }) => c.type === 'refusal')
      throw new Error(refusal?.refusal ?? 'The model did not return a result for this photo.')
    }

    const parsed = JSON.parse(textBlock.text)
    // Strip the nulls Structured Outputs' strict mode forces us to include —
    // the client only wants to see fields that actually had a value.
    const fields = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v != null))

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
