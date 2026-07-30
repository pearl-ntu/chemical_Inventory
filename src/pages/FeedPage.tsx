import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Beaker, Database, Heart, Image as ImageIcon, MessageSquare, Send, Trash2 } from 'lucide-react'
import { CommentThread } from '../components/CommentThread'
import { EmptyState, LoadingScreen, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import { resolveFeedImageUrl, uploadFeedImage } from '../lib/feedImage'
import type { FeedLinkedResourceType, FeedPost, FeedPostLike, Profile, Project, ResearchAsset } from '../lib/types'
import { cx, formatRelative } from '../lib/utils'

function activeMentionQuery(value: string, cursor: number): string | null {
  const upToCursor = value.slice(0, cursor)
  const at = upToCursor.lastIndexOf('@')
  if (at === -1) return null
  const between = upToCursor.slice(at + 1)
  if (/\s/.test(between)) return null
  return between
}

function Composer({ onPosted }: { onPosted: (post: FeedPost) => void }) {
  const { profile } = useAuth()
  const { chemicals } = useInventory()
  const toast = useToast()
  const [members, setMembers] = useState<Profile[]>([])
  const [assets, setAssets] = useState<ResearchAsset[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [body, setBody] = useState('')
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [linkType, setLinkType] = useState<FeedLinkedResourceType | ''>('')
  const [linkId, setLinkId] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [crossPost, setCrossPost] = useState(false)
  const [posting, setPosting] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void api.listProfiles().then((rows) => setMembers(rows.filter((r) => r.approved && r.id !== profile?.id)))
    void api.listResearchAssets().then(setAssets)
    void api.listProjects().then(setProjects)
  }, [profile])

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return []
    const needle = mentionQuery.toLowerCase()
    return members.filter((m) => m.full_name.toLowerCase().includes(needle)).slice(0, 5)
  }, [mentionQuery, members])

  function onBodyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setBody(e.target.value)
    setMentionQuery(activeMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length))
  }

  function pickMention(member: Profile) {
    const cursor = inputRef.current?.selectionStart ?? body.length
    const upToCursor = body.slice(0, cursor)
    const at = upToCursor.lastIndexOf('@')
    if (at === -1) return
    const next = `${body.slice(0, at)}@${member.full_name} ${body.slice(cursor)}`
    setBody(next)
    setMentionQuery(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const linkOptions =
    linkType === 'chemical' ? chemicals.filter((c) => c.status !== 'disposed') : linkType === 'research_asset' ? assets : linkType === 'project' ? projects : []

  async function submit() {
    if (!profile || !body.trim()) {
      toast.error('Write something first.')
      return
    }
    setPosting(true)
    try {
      let image_url: string | null = null
      if (imageFile) image_url = await uploadFeedImage(imageFile)
      const post = await api.createFeedPost(
        {
          body: body.trim(),
          image_url,
          linked_resource_type: linkType || null,
          linked_resource_id: linkId || null,
          cross_post_to_teams: crossPost,
        },
        profile,
      )
      onPosted(post)
      setBody('')
      setImageFile(null)
      setLinkType('')
      setLinkId('')
      setCrossPost(false)
      toast.success('Posted to the feed.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not post that.')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="card relative p-4">
      <textarea
        ref={inputRef}
        className="input min-h-[80px] resize-y"
        placeholder="Share something with the lab… type @ to mention someone"
        value={body}
        onChange={onBodyChange}
        onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
      />
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div className="absolute z-10 mt-1 w-64 rounded-lg border border-ink-200 bg-white p-1 shadow-pop dark:border-ink-700 dark:bg-ink-900">
          {mentionMatches.map((m) => (
            <button
              key={m.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800"
              onMouseDown={(e) => {
                e.preventDefault()
                pickMention(m)
              }}
            >
              {m.full_name}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          className="input w-auto py-1.5 text-xs"
          value={linkType}
          onChange={(e) => {
            setLinkType(e.target.value as FeedLinkedResourceType | '')
            setLinkId('')
          }}
        >
          <option value="">Not linked to anything</option>
          <option value="chemical">Link a chemical</option>
          <option value="research_asset">Link a research asset</option>
          <option value="project">Link a project</option>
        </select>
        {linkType && (
          <select className="input w-auto py-1.5 text-xs" value={linkId} onChange={(e) => setLinkId(e.target.value)}>
            <option value="">Choose…</option>
            {linkOptions.map((item: { id: string; name?: string; title?: string }) => (
              <option key={item.id} value={item.id}>
                {item.name ?? item.title}
              </option>
            ))}
          </select>
        )}

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
        <button type="button" className="btn-secondary py-1.5 text-xs" onClick={() => fileRef.current?.click()}>
          <ImageIcon className="h-3.5 w-3.5" /> {imageFile ? imageFile.name.slice(0, 16) : 'Add photo'}
        </button>

        <label className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400">
          <input type="checkbox" checked={crossPost} onChange={(e) => setCrossPost(e.target.checked)} />
          Cross-post to Teams
        </label>

        <button type="button" className="btn-primary ml-auto py-1.5 text-xs" disabled={posting} onClick={() => void submit()}>
          {posting ? <Spinner className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />} Post
        </button>
      </div>
    </div>
  )
}

function LinkedResourceCard({ post, chemicals, assets, projects }: { post: FeedPost; chemicals: ReturnType<typeof useInventory>['chemicals']; assets: ResearchAsset[]; projects: Project[] }) {
  if (!post.linked_resource_type || !post.linked_resource_id) return null
  if (post.linked_resource_type === 'chemical') {
    const c = chemicals.find((row) => row.id === post.linked_resource_id)
    if (!c) return null
    return (
      <Link to={`/inventory?code=${encodeURIComponent(c.code)}`} className="mt-2 flex items-center gap-1.5 rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs text-pearl-700 hover:underline dark:bg-ink-950/40 dark:text-pearl-300">
        <Beaker className="h-3.5 w-3.5" /> {c.name}
      </Link>
    )
  }
  if (post.linked_resource_type === 'research_asset') {
    const a = assets.find((row) => row.id === post.linked_resource_id)
    if (!a) return null
    return (
      <Link to="/research-assets" className="mt-2 flex items-center gap-1.5 rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs text-pearl-700 hover:underline dark:bg-ink-950/40 dark:text-pearl-300">
        <Database className="h-3.5 w-3.5" /> {a.title}
      </Link>
    )
  }
  const p = projects.find((row) => row.id === post.linked_resource_id)
  if (!p) return null
  return (
    <Link to={`/pi-dashboard/projects/${p.id}`} className="mt-2 flex items-center gap-1.5 rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs text-pearl-700 hover:underline dark:bg-ink-950/40 dark:text-pearl-300">
      {p.name}
    </Link>
  )
}

function PostImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    resolveFeedImageUrl(path).then((u) => live && setUrl(u)).catch(() => {})
    return () => {
      live = false
    }
  }, [path])
  if (!url) return null
  return <img src={url} alt="" className="mt-2 max-h-80 w-full rounded-lg object-cover" />
}

/**
 * A free-form, lab-wide feed — visible regardless of Experimental/
 * Computational workspace, the same way Members and Settings already sit
 * outside that toggle. Any approved member can post and like, no approval
 * queue — the only moderation is "author or admin can delete."
 */
export default function FeedPage() {
  const { profile, isAdmin } = useAuth()
  const { chemicals } = useInventory()
  const toast = useToast()
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [likes, setLikes] = useState<FeedPostLike[]>([])
  const [assets, setAssets] = useState<ResearchAsset[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [openComments, setOpenComments] = useState<Set<string>>(new Set())

  async function load() {
    const [p, l, a, pr] = await Promise.all([
      api.listFeedPosts(),
      api.listFeedPostLikes(),
      api.listResearchAssets(),
      api.listProjects(),
    ])
    setPosts(p)
    setLikes(l)
    setAssets(a)
    setProjects(pr)
  }

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [])

  const likesByPost = useMemo(() => {
    const map = new Map<string, FeedPostLike[]>()
    for (const l of likes) map.set(l.post_id, [...(map.get(l.post_id) ?? []), l])
    return map
  }, [likes])

  async function toggleLike(post: FeedPost) {
    if (!profile) return
    const mine = likesByPost.get(post.id)?.some((l) => l.member_id === profile.id)
    try {
      if (mine) {
        await api.unlikeFeedPost(post.id, profile)
        setLikes((prev) => prev.filter((l) => !(l.post_id === post.id && l.member_id === profile.id)))
      } else {
        await api.likeFeedPost(post.id, profile)
        setLikes((prev) => [...prev, { post_id: post.id, member_id: profile.id, created_at: new Date().toISOString() }])
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update your like.')
    }
  }

  async function remove(post: FeedPost) {
    try {
      await api.deleteFeedPost(post)
      setPosts((prev) => prev.filter((p) => p.id !== post.id))
      toast.success('Post deleted.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete that post.')
    }
  }

  if (loading) return <LoadingScreen label="Loading the feed…" />

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">Lab Feed</h1>
      <p className="mb-5 text-sm text-ink-500 dark:text-ink-400">Whatever's worth sharing — wins, questions, a photo from the bench.</p>

      <div className="mb-5">
        <Composer onPosted={(post) => setPosts((prev) => [post, ...prev])} />
      </div>

      {posts.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="h-6 w-6" />}
          title="Nothing posted yet"
          description="Be the first — share a result, a question, or just say hi."
        />
      ) : (
        <div className="space-y-3">
          {posts.map((post) => {
            const postLikes = likesByPost.get(post.id) ?? []
            const mine = postLikes.some((l) => l.member_id === profile?.id)
            return (
              <div key={post.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{post.author_name ?? 'Unknown'}</p>
                    <p className="text-xs text-ink-400">{formatRelative(post.created_at)}</p>
                  </div>
                  {(isAdmin || post.author_id === profile?.id) && (
                    <button className="btn-ghost p-1.5 text-rose-600" onClick={() => void remove(post)} title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{post.body}</p>
                {post.image_url && <PostImage path={post.image_url} />}
                <LinkedResourceCard post={post} chemicals={chemicals} assets={assets} projects={projects} />

                <div className="mt-3 flex items-center gap-3 border-t border-ink-100 pt-2.5 dark:border-ink-800">
                  <button
                    type="button"
                    className={cx('flex items-center gap-1.5 text-xs font-medium', mine ? 'text-rose-600' : 'text-ink-400 hover:text-ink-600 dark:hover:text-ink-300')}
                    onClick={() => void toggleLike(post)}
                  >
                    <Heart className={cx('h-3.5 w-3.5', mine && 'fill-current')} /> {postLikes.length || ''}
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-xs font-medium text-ink-400 hover:text-ink-600 dark:hover:text-ink-300"
                    onClick={() =>
                      setOpenComments((prev) => {
                        const next = new Set(prev)
                        if (next.has(post.id)) next.delete(post.id)
                        else next.add(post.id)
                        return next
                      })
                    }
                  >
                    <MessageSquare className="h-3.5 w-3.5" /> Comments
                  </button>
                </div>

                {openComments.has(post.id) && (
                  <div className="mt-2">
                    <CommentThread resourceType="feed_post" resourceId={post.id} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
