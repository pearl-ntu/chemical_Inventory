# Setting up the shared database

This turns PEARL Inventory from a browser-only demo into a real shared system:
one live database, accounts for everyone in the group, and permissions the
interface cannot be talked out of.

It takes about ten minutes and costs nothing. Supabase's free tier is far more
than a research group's inventory will ever need.

You need to do this **once**. After that, everyone else just signs up.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com> and sign up (GitHub login is easiest).
2. **New project**.
   - **Name:** `pearl-inventory`
   - **Database password:** generate one and save it in the group password
     manager. You will rarely need it, but you cannot recover it later.
   - **Region:** **Southeast Asia (Singapore)** — closest to NTU, so the app
     feels instant.
3. Wait about two minutes while it provisions.

---

## 2. Create the tables

1. In the left sidebar, open **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from this repository, copy the whole file, paste
   it in, and press **Run**.
3. You should see *Success. No rows returned.* That is correct — it creates
   tables, not rows.

This gives you:

- `profiles` — one row per account, created automatically on sign-up
- `chemicals` — one row per physical container
- `activity_log` — append-only audit trail
- Row Level Security policies for the three access levels
- A trigger that makes **the first account to sign up an admin, fully
  approved**, and every account after that **unapproved** — invisible to the
  inventory entirely — until an admin approves them from the Members page

The file is safe to re-run if you need to.

---

## 3. Load the lab's existing inventory (optional)

Two ways — pick either.

**From the app:** sign in and the dashboard offers a *Load 235 starter
containers* button on an empty database. Easiest.

**From SQL:** in the SQL Editor, run `supabase/seed.sql` the same way you ran
the schema. This is faster for a large load and is the one to use if you are
restoring after a wipe.

---

## 4. Turn off email confirmation (recommended for a lab)

This affects the **password** sign-up path only. By default Supabase emails a
confirmation link to every new password sign-up, and the free tier's built-in
mailer is rate-limited and often lands in spam. For an internal lab tool, it
is friction with no benefit.

**Authentication → Sign In / Providers → Email** → switch **Confirm email**
off → **Save**.

Now a new member signs up with a password and is straight in. If you would
rather keep confirmation on, the app handles it — it tells people to check
their inbox.

> Keeping unwanted sign-ups out is better handled by the email allow-list,
> set in `.env` in step 7 below — it restricts accounts to NTU addresses.

> **Magic links are a different story.** The app defaults to email-link
> sign-in, and that *always* needs a real email to arrive — there's no
> "confirmation toggle" to skip it, the whole method is the email. Supabase's
> built-in mailer is fine for testing but is rate-limited (a few sends per
> hour) and not meant for a whole lab's daily use. Before relying on this day
> to day, set up custom SMTP (steps below) — otherwise sign-ins and invites
> will intermittently fail to arrive, especially to institutional addresses
> like `@ntu.edu.sg`, which tend to filter automated mail from unrecognised
> senders more aggressively than a personal inbox does.

### Setting up custom SMTP with Resend (do this before relying on the app)

Takes about ten minutes. **One prerequisite you need before starting: a
domain you control the DNS for.** Resend (like every serious email provider)
requires you to verify a domain you own — there's no shared "just send it"
option, because that's exactly the kind of unverified sending that gets
filtered as spam, which is the whole problem this fixes. If the lab or NTU
doesn't already have a domain you can add DNS records to, the cheapest path
is registering one for a few dollars a year (Cloudflare and Namecheap both
sell them) just for this — you don't need to build a website on it, it only
has to exist for the DNS records below. A subdomain like `mail.pearl-ntu.org`
works fine and is actually recommended over using a bare root domain.

1. **Sign up** at [resend.com](https://resend.com) — free tier, no card needed.
2. **Add your domain**: Dashboard → **Domains → Add Domain**. Use a
   subdomain (e.g. `mail.yourdomain.com`) rather than the root domain, so
   this sending reputation stays separate from anything else on the domain.
3. Resend shows you a handful of DNS records (SPF, DKIM, and usually DMARC).
   **Add every one of them** at wherever your domain's DNS is managed
   (Cloudflare, Namecheap, GoDaddy, whoever you registered it through).
4. Back in Resend, click **Verify** — DNS changes can take anywhere from a
   few minutes to a few hours to propagate, so this may not go green
   immediately. Refresh and check back if it doesn't.
5. Once verified, go to **API Keys → Create API Key** and copy it — this is
   your SMTP password, shown only once.
6. In Supabase: **Authentication → Emails → SMTP Settings** → enable custom
   SMTP → fill in:

   | Field | Value |
   |---|---|
   | Sender email | something **@your verified domain** (e.g. `noreply@mail.pearl-ntu.org`) — must match the domain you verified, not a Gmail address |
   | Sender name | PEARL Inventory (or whatever the group prefers) |
   | Host | `smtp.resend.com` |
   | Port | `587` (or `465` for SSL instead of STARTTLS — either works) |
   | Username | `resend` (literally that word, not your email) |
   | Password | the API key from step 5 |

7. **Save**, then try a sign-up or invite again to confirm it goes through.

If nobody in the group can get a domain, ask NTU IT whether they'll run
automated mail for a departmental tool through their own mail relay instead
— many universities do this on request; it sidesteps the domain-verification
step entirely since the mail would come from an address NTU's own filters
already trust.

---

## 5. Get the two keys

**Project Settings → API Keys**, and copy:

- **Project URL** — looks like `https://abcdefgh.supabase.co`
- The **publishable key** — a shorter string starting `sb_publishable_…`

Supabase renamed its keys in 2025; older projects (or ones you set up a while
ago) instead show an **anon / public** key, a long string starting `eyJ…` — if
that's what you see, use that one. Same purpose, just two names for it
depending on when the project was created.

> **On key safety.** Whichever name it has, this key is *designed* to ship
> inside a browser. It grants nothing on its own; every query is still checked
> against the Row Level Security policies from step 2. Putting it in the
> repository or in a public build is expected and fine.
>
> The **secret key** (`sb_secret_…`, formerly called `service_role`) on that
> same page is the opposite — it bypasses all security. Never put it in
> `.env`, in the repository, or anywhere near the frontend.

---

## 6. Add the app's URL to the redirect allow-list

A magic link bounces the browser back to the app after the click. Supabase
only allows that redirect to land on URLs you've approved.

**Authentication → URL Configuration**:

- **Site URL:** the address the app will live at once published — e.g.
  `https://your-group.github.io/pearl-inventory/`
- **Redirect URLs:** add that same address, **and** `http://localhost:5173/`
  (or whatever port `npm run dev` prints) so it also works while developing.

Add every URL the app is ever reachable at — the deployed one and your local
one both need to be listed, or clicking a magic link will fail with a
"redirect not allowed" error.

### If a link says "invalid or expired" within seconds of being sent

A magic link is single-use. If NTU's (or any institution's) email gateway
pre-fetches links in incoming mail to scan them for phishing — which is what
the **"[Alert: Non-NTU Email]"** banner on external senders is a sign of —
that scan opens and burns the link before the person ever clicks it. The app
now shows a plain-language error when this happens instead of silently
dropping you on the sign-in page, but the real fix is giving people a second
way in that a scanner can't use on their behalf: the same email also carries
a plain 6-digit code, and the app has a "Link not working? Enter the code
from the email instead" option — but only once the template actually includes
that code.

**Authentication → Email Templates → Magic Link** — add `{{ .Token }}`
somewhere in the body, e.g.:

```html
<h2>Your sign-in link</h2>
<p>Follow the link below to sign in. This link expires shortly and can only be used once.</p>
<p><a href="{{ .ConfirmationURL }}">Sign in</a></p>
<p>Link not working? Enter this code in the app instead: <strong>{{ .Token }}</strong></p>
```

This one template covers both the sign-up magic link and an admin's invite
from the Members page — both go through the same `signInWithOtp` call under
the hood, so there's nothing to change in a separate "Invite" template.

---

## 7. Point the app at it

Copy `.env.example` to `.env` in the project folder and fill it in:

```bash
VITE_SUPABASE_URL=https://abcdefgh.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...

# Restrict sign-ups to the university. Delete the line to let anyone in.
VITE_ALLOWED_EMAIL_DOMAINS=e.ntu.edu.sg,ntu.edu.sg

VITE_LAB_NAME=PEARL
VITE_LAB_SUBTITLE=Photon Emission & Reactivity Lab · Prof. Xiaogang Liu · NTU Singapore
```

Restart the dev server (`npm run dev`). The amber "Demo mode" banner disappears
and Settings shows the connected host — that is how you know it worked.

---

## 8. Create the admin account

**The first account ever created in the project automatically becomes admin**
— everyone after that starts locked out (see below), so this one matters.

Two ways to set it up, pick whichever suits the group:

- **Tied to a person** — sign up with the PI's or a senior member's own email.
  Simple, but the account leaves when they do.
- **A standing admin account, handed down over time** (recommended if you
  want this to outlive any one person) — sign up once with a shared address
  the group controls, e.g. `pearlntu2025@gmail.com`, and a password kept in
  the group's password manager or handed to whoever's running things this
  year. Nobody's personal name is on it, so admin duty passes along with the
  password, not with a person leaving the group.

If a test account accidentally became admin first, fix it in Supabase:
**Table Editor → profiles →** set `role` to `admin` (and `approved` to `true`)
on the right row.

### Everyone else has to be let in — this is the real security gate

Sign-up is open to any email address with no domain allow-list, **but signing
up does not grant access.** Every account after the first lands unapproved:
it exists, but Row Level Security means it cannot read a single row of the
inventory yet — not "read-only", genuinely nothing. It shows a "waiting for
approval" screen instead of the app.

On the **Members** page, the admin account sees a **Waiting for approval**
list at the top. Clicking **Approve** on someone does two things at once:
flips them to visible, and sets them up as a `member` (able to add/edit).
That's the whole flow — this is what actually stops "anyone can sign up and
see the inventory," not the sign-up form itself.

---

## 9. Publish it for the group

See the *Publishing* section in [README.md](README.md). Short version: push to
GitHub, set **Pages → Source → GitHub Actions**, and add `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` as repository **Variables**.

Once it's live at its real GitHub Pages URL, double check that URL is in the
redirect allow-list from step 6 — that's the step people forget, and the
symptom is sign-in working locally but failing the moment it's live.

---

## Optional: read delivery-photo details automatically

Registering a chemical can attach a photo of the delivery order/invoice —
that part works out of the box once you've run `schema.sql` (it adds a
private `delivery-photos` storage bucket). Reading the photo to suggest
field values (chemical name, CAS, supplier, price, ...) needs one more
piece: a Supabase Edge Function that calls an AI vision API. Skip this
section entirely and the photo-attach feature still works fine — people
just fill in fields by hand, same as always.

**You'll need:**
- The [Supabase CLI](https://supabase.com/docs/guides/cli) installed
  (`npm install -g supabase`)
- An [Anthropic API key](https://console.anthropic.com/settings/keys) —
  this is billed separately from Claude.ai/Claude Code, a few cents per
  photo read

**Steps:**

1. **Link the CLI to your project**: `supabase login`, then from this
   folder, `supabase link --project-ref <your-project-ref>` (the ref is in
   your Supabase project's URL: `supabase.com/dashboard/project/<ref>`).
2. **Set the secret** the function needs — never put this in `.env`, it
   must stay off the client entirely:
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   ```
3. **Deploy the function**:
   ```bash
   supabase functions deploy extract-invoice
   ```
4. Try it: open a chemical's registration form, attach a delivery photo,
   and click **Extract details from photo**. Whatever it reads shows up as
   a checklist — nothing is filled in until you tick fields and apply them.

If it fails, check **Supabase dashboard → Edge Functions → extract-invoice
→ Logs** first — most failures are either a missing/typo'd secret or a
photo too blurry for the model to read anything confidently.

---

## Looking after it

**Backups.** Supabase takes daily backups on paid plans. On the free plan, get
into the habit of Settings → *Export everything as CSV* once a term, and keep
the file in the group Dropbox. Two minutes, and it means the inventory can never
be lost.

**Someone leaves the group.** Members → set them to `viewer`, or delete the
account under Supabase **Authentication → Users**. Their name stays on the
records they registered, which is the point of the audit trail.

**Free-tier projects pause after a week of no activity.** A lab using this daily
will never hit that. If it does pause, open the Supabase dashboard and press
*Restore* — nothing is lost.

**Upgrading the app later.** `git pull`, `npm install`, `npm run build`. If a
future version needs new columns, it will come with a migration file in
`supabase/`.

---

## When something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Still shows "Demo mode" | `.env` not read | Restart the dev server. The file must be at the project root and the variables must start with `VITE_`. |
| "Invalid login credentials" | Wrong password, or email not confirmed | Use *Forgot password*, or turn off email confirmation (step 4). |
| Sign-up succeeds, then "no profile could be loaded" | The trigger from step 2 did not run | Re-run `supabase/schema.sql`. |
| "new row violates row-level security policy" | Your account is a `viewer` | An admin can promote you on the Members page. |
| Nobody is an admin | The first sign-up predated the schema | Supabase → Table Editor → `profiles` → set `role` to `admin` and `approved` to `true`. |
| Signed in but stuck on "Waiting for approval" | Expected — nobody but the first account is approved automatically | An existing admin approves you from the **Members** page. If there's no admin yet either, see the row above. |
| Approved someone but they still see "Waiting for approval" | They're on a cached session | Have them hit **Check again** on that screen, or sign out and back in. |
| Magic link redirects to an error page, or "redirect not allowed" | The app's URL isn't on the allow-list | Add it under **Authentication → URL Configuration** (step 6) — both the deployed URL and your `localhost` one. |
| Clicking a magic link signs in on a different device than expected | Expected — the link itself carries the session | Open it on the device you actually want signed in; if you checked mail on your phone, forward the link or open it there. |
| Magic link email never arrives, especially to `@ntu.edu.sg` | Supabase's default mailer is rate-limited (a few emails/hour) and institutional mail filters are often stricter about unrecognised senders than a personal inbox | Check spam first. Set up custom SMTP with Resend (step 4, above) — this is the actual fix, not a workaround, and worth doing before relying on the app day to day. |
| "For security purposes, you can only request this after N seconds" | Supabase's own cooldown between consecutive sign-in/invite requests to the same address — normal, unrelated to whether earlier emails arrived | Just wait it out. Doesn't indicate a delivery problem either way. |
| Published site is blank | Wrong base path | The app uses `HashRouter` and relative asset paths, so this should not happen. If it does, check that the Pages build actually finished in the Actions tab. |
| Structures and auto-fill do nothing | PubChem unreachable | This is optional enrichment and always fails soft. Everything else keeps working. |

---

<div align="center"><sub>Questions? The code is commented, and
<code>src/lib/api.ts</code> is the place to start reading.</sub></div>
