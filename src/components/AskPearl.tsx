import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Cpu, Send, X } from 'lucide-react'
import { useToast } from '../context/ToastContext'
import { api, type AskPearlReply } from '../lib/api'
import { Logo } from './Logo'
import { Spinner } from './ui'

type WidgetState = 'pill' | 'icon' | 'panel'
type Message = { role: 'user' | 'assistant'; text: string; sources?: AskPearlReply['sources'] }

const SUGGESTIONS = {
  experimental: [
    'What is running low?',
    'Which chemicals expire soon?',
    'Any duplicated stock?',
    'Summarize pending requests.',
  ],
  computational: [
    'Which assets need versions?',
    'What simulations are running?',
    'What needs verification?',
    'Summarize private assets.',
  ],
} as const

const LOCAL_MODE_KEY = 'pearl.ask.local.enabled'
const LOCAL_URL_KEY = 'pearl.ask.local.url'
const LOCAL_MODEL_KEY = 'pearl.ask.local.model'

function storedBoolean(key: string, fallback = false) {
  try {
    return localStorage.getItem(key) === 'true' || fallback
  } catch {
    return fallback
  }
}

function storedString(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

function workspaceFromPath(pathname: string) {
  return pathname.startsWith('/research-assets') || pathname.startsWith('/computational')
    ? 'computational'
    : 'experimental'
}

function PearlMark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-ink-200 bg-white p-0.5 dark:border-ink-700 dark:bg-ink-900 ${className}`}
      aria-hidden="true"
    >
      <Logo className="h-full w-full rounded-full" />
    </span>
  )
}

export function AskPearl() {
  const location = useLocation()
  const toast = useToast()
  const workspace = useMemo(() => workspaceFromPath(location.pathname), [location.pathname])
  const [state, setState] = useState<WidgetState>('pill')
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [localMode, setLocalMode] = useState(() => storedBoolean(LOCAL_MODE_KEY))
  const [localUrl, setLocalUrl] = useState(() => storedString(LOCAL_URL_KEY, 'http://127.0.0.1:11434'))
  const [localModel, setLocalModel] = useState(() => storedString(LOCAL_MODEL_KEY, 'qwen2.5:7b-instruct'))

  function saveLocalMode(enabled: boolean) {
    setLocalMode(enabled)
    try {
      localStorage.setItem(LOCAL_MODE_KEY, String(enabled))
    } catch {
      /* session still updates */
    }
  }

  function saveLocalUrl(value: string) {
    setLocalUrl(value)
    try {
      localStorage.setItem(LOCAL_URL_KEY, value)
    } catch {
      /* session still updates */
    }
  }

  function saveLocalModel(value: string) {
    setLocalModel(value)
    try {
      localStorage.setItem(LOCAL_MODEL_KEY, value)
    } catch {
      /* session still updates */
    }
  }

  async function askLocal(trimmed: string): Promise<AskPearlReply> {
    const [chemicals, researchAssets, chemicalRequests] = await Promise.all([
      api.listChemicals(),
      api.listResearchAssets(),
      api.listChemicalRequests(),
    ])
    const context = {
      workspace,
      chemicals: chemicals.slice(0, 300).map((c) => ({
        code: c.code,
        name: c.name,
        cas: c.cas,
        location: c.location,
        sub_location: c.sub_location,
        supplier: c.supplier,
        quantity: c.quantity,
        size_value: c.size_value,
        size_unit: c.size_unit,
        status: c.status,
        hazards: c.hazards,
        expiry_date: c.expiry_date,
        owner: c.owner,
        project: c.project,
      })),
      research_assets: researchAssets.slice(0, 220).map((asset) => ({
        stable_id: asset.stable_id,
        type: asset.type,
        title: asset.title,
        project: asset.project,
        owner: asset.owner,
        software: asset.software,
        method: asset.method,
        status: asset.status,
        visibility: asset.visibility,
        last_verified_at: asset.last_verified_at,
        tags: asset.tags,
      })),
      chemical_requests: chemicalRequests.slice(0, 120).map((request) => ({
        status: request.status,
        chemical_name_or_cas: request.chemical_name_or_cas,
        supplier: request.supplier,
        quantity: request.quantity,
        justification_project: request.justification_project,
        notes: request.notes,
        requested_by_name: request.requested_by_name,
        requested_at: request.requested_at,
      })),
    }
    const res = await fetch(`${localUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: localModel,
        stream: false,
        prompt: `You are Ask PEARL, a careful read-only lab inventory assistant. The user is currently in the ${workspace} workspace. Answer only from the supplied JSON context. If the context is insufficient, say what is missing. Do not invent records, prices, safety rules, or file contents. Be concise and include specific record names/codes when useful.\n\nQuestion: ${trimmed}\n\nScoped JSON context:\n${JSON.stringify(context)}`,
        options: { num_predict: 700 },
      }),
    })
    if (!res.ok) throw new Error(`Local model failed: ${await res.text()}`)
    const data = await res.json()
    return {
      answer: String(data.response ?? '').trim() || 'No answer was returned.',
      sources: [
        { table: 'chemicals', count: context.chemicals.length },
        { table: 'research_assets', count: context.research_assets.length },
        { table: 'chemical_requests', count: context.chemical_requests.length },
      ],
    }
  }

  function askSuggestion(nextQuestion: string) {
    void askText(nextQuestion)
  }

  async function askText(nextQuestion: string) {
    const trimmed = nextQuestion.trim()
    if (!trimmed || busy) return
    setQuestion('')
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }])
    setBusy(true)
    try {
      const reply = localMode ? await askLocal(trimmed) : await api.askPearl(trimmed, workspace)
      setMessages((prev) => [...prev, { role: 'assistant', text: reply.answer, sources: reply.sources }])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ask PEARL failed.'
      toast.error(
        !localMode && /Failed to send a request/i.test(message)
          ? 'Ask PEARL server is not reachable. Deploy the ask-pearl Edge Function, or turn on Local model and use Ollama.'
          : message,
      )
      setMessages((prev) => [...prev, { role: 'assistant', text: message }])
    } finally {
      setBusy(false)
    }
  }

  if (state === 'panel') {
    return (
      <section className="no-print fixed bottom-5 right-5 z-40 flex h-[380px] w-[300px] flex-col overflow-hidden rounded-lg border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-950">
        <header className="flex items-center gap-2 border-b border-ink-200 px-3 py-2 dark:border-ink-800">
          <PearlMark className="h-5 w-5" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-ink-900 dark:text-ink-100">Ask PEARL</h2>
            <p className="text-[11px] capitalize text-ink-400">{workspace}</p>
          </div>
          <button type="button" className="btn-ghost p-1" aria-label="Close Ask PEARL" onClick={() => setState('icon')}>
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3 text-sm">
          {messages.length === 0 ? (
            <div className="rounded-lg border border-ink-200 bg-ink-50 p-3 text-xs text-ink-500 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-400">
              Ask read-only questions about the records you can access.
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={
                  message.role === 'user'
                    ? 'ml-7 rounded-lg bg-pearl-600 px-3 py-2 text-white'
                    : 'mr-7 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-ink-700 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-200'
                }
              >
                <p className="whitespace-pre-wrap leading-snug">{message.text}</p>
                {message.sources && message.sources.length > 0 && (
                  <p className="mt-2 text-[10px] text-ink-400">
                    {message.sources.map((source) => `${source.table}: ${source.count}`).join(' / ')}
                  </p>
                )}
              </div>
            ))
          )}
          {busy && (
            <div className="mr-7 flex items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-500 dark:border-ink-800 dark:bg-ink-900">
              <Spinner /> Thinking...
            </div>
          )}
        </div>

        <div className="border-t border-ink-200 p-2 dark:border-ink-800">
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {SUGGESTIONS[workspace].map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="shrink-0 rounded-full border border-ink-200 px-2 py-1 text-[11px] font-medium text-ink-500 hover:border-pearl-300 hover:bg-pearl-50 dark:border-ink-800 dark:text-ink-400 dark:hover:border-pearl-500/40 dark:hover:bg-pearl-500/10"
                disabled={busy}
                onClick={() => askSuggestion(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
          <div className="mb-2 rounded-lg border border-ink-200 p-2 dark:border-ink-800">
            <label className="flex items-center justify-between gap-2 text-[11px] font-semibold text-ink-500 dark:text-ink-400">
              <span className="flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5" /> Local model
              </span>
              <input
                type="checkbox"
                checked={localMode}
                onChange={(e) => saveLocalMode(e.target.checked)}
              />
            </label>
            {localMode && (
              <div className="mt-2 grid gap-1.5">
                <input className="input h-8 text-xs" value={localUrl} onChange={(e) => saveLocalUrl(e.target.value)} />
                <input className="input h-8 text-xs" value={localModel} onChange={(e) => saveLocalModel(e.target.value)} />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              className="input h-9 text-sm"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void askText(question)
                }
              }}
              placeholder="Ask a question..."
            />
            <button type="button" className="btn-primary h-9 shrink-0 px-3" disabled={busy || !question.trim()} onClick={() => void askText(question)}>
              {busy ? <Spinner /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (state === 'icon') {
    return (
      <button
        type="button"
        className="no-print fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-950"
        aria-label="Open Ask PEARL"
        onClick={() => setState('panel')}
      >
        <PearlMark className="h-6 w-6" />
      </button>
    )
  }

  return (
    <div className="no-print fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-ink-200 bg-white py-2 pl-2 pr-2 dark:border-ink-800 dark:bg-ink-950">
      <button type="button" className="flex items-center gap-2 pl-1 pr-2" onClick={() => setState('panel')}>
        <PearlMark className="h-6 w-6" />
        <span className="text-sm font-semibold text-ink-800 dark:text-ink-100">Ask PEARL</span>
      </button>
      <button type="button" className="btn-ghost rounded-full p-1" aria-label="Collapse Ask PEARL" onClick={() => setState('icon')}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
