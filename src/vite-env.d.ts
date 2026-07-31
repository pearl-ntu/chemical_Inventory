/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_ALLOWED_EMAIL_DOMAINS?: string
  readonly VITE_LAB_NAME?: string
  readonly VITE_LAB_SUBTITLE?: string
  readonly VITE_FORMSPREE_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
