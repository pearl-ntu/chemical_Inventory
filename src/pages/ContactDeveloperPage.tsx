import { useState, type FormEvent } from 'react'
import { Bug, CheckCircle2, ExternalLink, Mail, Send, Sparkles } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'

const DEVELOPER_EMAIL = 'abedisyedaliabbas@gmail.com'
const DEVELOPER_SITE = 'https://abedisyedaliabbas.github.io/molecular-design-lab/'
const FORMSPREE_ENDPOINT = import.meta.env.VITE_FORMSPREE_ENDPOINT

type InquiryType = 'bug' | 'feature' | 'product' | 'collaboration' | 'other'

const INQUIRY_OPTIONS: Array<{ value: InquiryType; label: string }> = [
  { value: 'bug', label: 'Bug report' },
  { value: 'feature', label: 'Feature request' },
  { value: 'product', label: 'Use PEARL in another lab' },
  { value: 'collaboration', label: 'Collaboration' },
  { value: 'other', label: 'Other' },
]

function fallbackMailto(values: {
  type: InquiryType
  name: string
  email: string
  subject: string
  message: string
  page: string
}) {
  const body = [
    `Type: ${values.type}`,
    `Name: ${values.name}`,
    `Email: ${values.email}`,
    `Page: ${values.page}`,
    '',
    values.message,
  ].join('\n')

  return `mailto:${DEVELOPER_EMAIL}?subject=${encodeURIComponent(values.subject || 'PEARL contact')}&body=${encodeURIComponent(body)}`
}

export default function ContactDeveloperPage() {
  const { profile } = useAuth()
  const [type, setType] = useState<InquiryType>('bug')
  const [name, setName] = useState(profile?.full_name ?? '')
  const [email, setEmail] = useState(profile?.email ?? '')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const page = typeof window === 'undefined' ? 'PEARL' : window.location.href

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSent(false)

    const values = { type, name, email, subject, message, page }
    if (!message.trim()) {
      setError('Please write a short message first.')
      return
    }

    if (!FORMSPREE_ENDPOINT) {
      window.location.href = fallbackMailto(values)
      return
    }

    setBusy(true)
    try {
      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          _subject: subject || `PEARL ${type}`,
          type,
          name,
          email,
          message,
          page,
          user_agent: typeof navigator === 'undefined' ? 'Unknown' : navigator.userAgent,
        }),
      })

      if (!res.ok) throw new Error(`Formspree returned ${res.status}.`)
      setSent(true)
      setMessage('')
      setSubject('')
      setType('bug')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the message.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Contact Developer"
        description="Send bugs, feature ideas, customization requests, or product inquiries directly to the PEARL developer."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="rounded-xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-950/40">
          <div className="mb-5 flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-pearl-600 text-white">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">
                Tell me what PEARL needs next
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-500 dark:text-ink-400">
                The form can be wired to Formspree using <code>VITE_FORMSPREE_ENDPOINT</code>.
                Until that is set, it falls back to a prefilled email to the developer.
              </p>
            </div>
          </div>

          <form className="space-y-4" onSubmit={(e) => void submit(e)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">
                Type
                <select
                  className="input"
                  value={type}
                  onChange={(event) => setType(event.target.value as InquiryType)}
                >
                  {INQUIRY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">
                Subject
                <input
                  className="input"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Short summary"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">
                Name
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                />
              </label>
              <label className="space-y-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">
                Reply email
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </label>
            </div>

            <label className="space-y-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">
              Message
              <textarea
                className="input min-h-40 resize-y"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="For bugs, include what happened and what you expected. For product interest, tell me your lab, use case, and timeline."
              />
            </label>

            <input type="hidden" name="page" value={page} />

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {error}
              </div>
            )}
            {sent && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Message sent. Thank you.
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-ink-500 dark:text-ink-400">
                Sends to {DEVELOPER_EMAIL}
              </p>
              <button className="btn-primary" disabled={busy}>
                {busy ? <Spinner /> : <Send className="h-4 w-4" />} Send message
              </button>
            </div>
          </form>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-950/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              Developer
            </p>
            <h2 className="mt-2 text-lg font-bold text-ink-900 dark:text-ink-50">
              Syed Ali Abbas Abedi
            </h2>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              Bug reports, product inquiries, and collaboration messages route here.
            </p>
            <a
              className="mt-3 inline-flex text-sm font-semibold text-pearl-700 hover:text-pearl-800 dark:text-pearl-300"
              href={`mailto:${DEVELOPER_EMAIL}`}
            >
              <Mail className="mr-1.5 h-4 w-4" /> {DEVELOPER_EMAIL}
            </a>
            <a
              className="mt-4 flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-700 hover:border-pearl-300 hover:text-pearl-700 dark:border-ink-800 dark:text-ink-200 dark:hover:border-pearl-500/40 dark:hover:text-pearl-300"
              href={DEVELOPER_SITE}
              target="_blank"
              rel="noreferrer"
            >
              Molecular Design Lab <ExternalLink className="h-4 w-4" />
            </a>
          </section>

          <section className="rounded-xl border border-ink-200 bg-ink-50/70 p-5 dark:border-ink-800 dark:bg-ink-900/40">
            <div className="flex items-start gap-3">
              <Bug className="mt-0.5 h-4 w-4 text-pearl-600 dark:text-pearl-300" />
              <p className="text-sm leading-relaxed text-ink-500 dark:text-ink-400">
                For a bug report, the most useful note is: page, button clicked, what happened,
                and what should have happened.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}
