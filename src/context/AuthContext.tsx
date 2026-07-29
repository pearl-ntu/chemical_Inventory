import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { auth } from '../lib/api'
import type { Profile } from '../lib/types'

interface AuthState {
  profile: Profile | null
  loading: boolean
  /** True once an admin has approved the account — before that, nothing else matters. */
  isApproved: boolean
  /** True for approved admins and members; false for viewers, unapproved accounts, and signed-out visitors. */
  canEdit: boolean
  isAdmin: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ needsConfirmation: boolean }>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setProfile(await auth.currentProfile())
    } catch (err) {
      console.error('Failed to restore the session:', err)
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    return auth.onChange(() => {
      void refresh()
    })
  }, [refresh])

  const value = useMemo<AuthState>(
    () => ({
      profile,
      loading,
      isApproved: profile?.approved === true,
      canEdit: profile?.approved === true && (profile?.role === 'admin' || profile?.role === 'member'),
      isAdmin: profile?.approved === true && profile?.role === 'admin',
      async signIn(email, password) {
        setProfile(await auth.signIn(email, password))
      },
      async signUp(email, password, fullName) {
        const { profile: p, needsConfirmation } = await auth.signUp(email, password, fullName)
        if (p) setProfile(p)
        return { needsConfirmation }
      },
      async signOut() {
        await auth.signOut()
        try {
          sessionStorage.removeItem('pearl.new_chemical_draft')
          localStorage.removeItem('pearl.new_chemical_draft')
        } catch {
          /* ignore unavailable browser storage */
        }
        setProfile(null)
      },
      refresh,
    }),
    [profile, loading, refresh],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
