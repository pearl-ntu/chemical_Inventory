/**
 * One global creator credit, mounted by App above every route and layout.
 * Keeping it outside individual pages means new pages inherit it without
 * remembering to add another footer.
 */
export function SiteCredit() {
  return (
    <footer
      className="no-print shrink-0 border-t border-ink-200 bg-white/85 px-4 py-2 text-center text-xs text-ink-400 backdrop-blur dark:border-ink-800 dark:bg-ink-950/85 dark:text-ink-500"
      data-site-credit
    >
      Created and designed by{' '}
      <a
        className="font-medium text-pearl-600 hover:text-pearl-700 dark:text-pearl-300 dark:hover:text-pearl-200"
        href="https://abedisyedaliabbas.github.io/molecular-design-lab/"
        target="_blank"
        rel="noreferrer"
      >
        Syed Ali Abbas Abedi
      </a>
    </footer>
  )
}
