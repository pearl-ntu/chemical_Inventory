import { Bug, ExternalLink, Mail, Sparkles } from 'lucide-react'
import { PageHeader } from '../components/Layout'

const DEVELOPER_EMAIL = 'abedisyedaliabbas@gmail.com'
const DEVELOPER_SITE = 'https://abedisyedaliabbas.github.io/molecular-design-lab/'

function mailto(subject: string, body: string) {
  return `mailto:${DEVELOPER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export default function ContactDeveloperPage() {
  const page = typeof window === 'undefined' ? 'PEARL' : window.location.href
  const bugBody = [
    'Hi Syed,',
    '',
    'I found a PEARL issue:',
    '',
    'What happened:',
    '',
    'What I expected:',
    '',
    'Steps to reproduce:',
    '1. ',
    '',
    `Page: ${page}`,
    `Browser: ${typeof navigator === 'undefined' ? 'Unknown' : navigator.userAgent}`,
  ].join('\n')
  const productBody = [
    'Hi Syed,',
    '',
    'I am interested in PEARL / the inventory platform.',
    '',
    'Lab / organization:',
    '',
    'What we want to manage:',
    '',
    'Best way to contact me:',
  ].join('\n')

  return (
    <>
      <PageHeader
        title="Contact Developer"
        description="Reach the PEARL developer for bug reports, product interest, customization, or collaboration."
      />

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-950/40">
          <div className="mb-4 flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-pearl-600 text-white">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">
                PEARL Inventory and Research Platform
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-500 dark:text-ink-400">
                Built for chemical inventory, computational research assets, HPC metadata, safety
                workflows, member handover, and lab-wide project visibility.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <a className="btn-primary justify-center" href={mailto('Interested in PEARL', productBody)}>
              <Mail className="h-4 w-4" /> Contact for product interest
            </a>
            <a className="btn-secondary justify-center" href={mailto('PEARL bug report', bugBody)}>
              <Bug className="h-4 w-4" /> Report a bug
            </a>
          </div>
        </section>

        <section className="rounded-xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-950/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Developer
          </p>
          <h2 className="mt-2 text-lg font-bold text-ink-900 dark:text-ink-50">
            Syed Ali Abbas Abedi
          </h2>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            Bugs and product inquiries are always sent to:
          </p>
          <a
            className="mt-3 inline-flex text-sm font-semibold text-pearl-700 hover:text-pearl-800 dark:text-pearl-300"
            href={`mailto:${DEVELOPER_EMAIL}`}
          >
            {DEVELOPER_EMAIL}
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
      </div>
    </>
  )
}
