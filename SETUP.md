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
- A trigger that makes **the first account to sign up an admin**

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

By default Supabase emails a confirmation link to every new sign-up, and the
free tier's built-in mailer is rate-limited and often lands in spam. For an
internal lab tool, it is friction with no benefit.

**Authentication → Sign In / Providers → Email** → switch **Confirm email**
off → **Save**.

Now a new member signs up and is straight in. If you would rather keep
confirmation on, the app handles it — it tells people to check their inbox.

> Keeping unwanted sign-ups out is better handled by the email allow-list in
> step 6, which restricts accounts to NTU addresses.

---

## 5. Get the two keys

**Project Settings → API**, and copy:

- **Project URL** — looks like `https://abcdefgh.supabase.co`
- **anon / public** key — a long string starting `eyJ…`

> **On key safety.** The `anon` key is *designed* to ship inside a browser. It
> grants nothing on its own; every query is still checked against the Row Level
> Security policies from step 2. Putting it in the repository or in a public
> build is expected and fine.
>
> The **`service_role`** key on that same page is the opposite — it bypasses all
> security. Never put it in `.env`, in the repository, or anywhere near the
> frontend.

---

## 5b. Add the app's URL to the redirect allow-list

Both magic links and Google sign-in bounce the browser back to the app after
the click. Supabase only allows that redirect to land on URLs you've approved.

**Authentication → URL Configuration**:

- **Site URL:** the address the app will live at once published — e.g.
  `https://your-group.github.io/pearl-inventory/`
- **Redirect URLs:** add that same address, **and** `http://localhost:5173/`
  (or whatever port `npm run dev` prints) so it also works while developing.

Add every URL the app is ever reachable at — the deployed one and your local
one both need to be listed, or sign-in will fail with a "redirect not allowed"
error right after the click.

---

## 6. Add Google sign-in (optional)

Skip this section if email links are enough for the group — magic links work
out of the box with nothing further to configure. Add Google on top if people
would rather use their NTU Google account.

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an **OAuth client ID** of type **Web application**.
   - **Authorized redirect URI:** copy this from Supabase — **Authentication →
     Providers → Google** shows the exact callback URL to paste in
     (`https://<project>.supabase.co/auth/v1/callback`).
2. Copy the **Client ID** and **Client Secret** Google gives you.
3. Back in Supabase, **Authentication → Providers → Google** → paste both →
   **Enable** → **Save**.

That's it — the "Continue with Google" button in the app starts working
immediately, no rebuild needed. If your group is entirely `@e.ntu.edu.sg`, you
can restrict the Google OAuth consent screen to your Google Workspace domain
from the same Cloud Console project, which stops anyone outside NTU from even
seeing the login prompt.

---

## 7. Point the app at it

Copy `.env.example` to `.env` in the project folder and fill it in:

```bash
VITE_SUPABASE_URL=https://abcdefgh.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...

# Restrict sign-ups to the university. Delete the line to let anyone in.
VITE_ALLOWED_EMAIL_DOMAINS=e.ntu.edu.sg,ntu.edu.sg

VITE_LAB_NAME=PEARL Group
VITE_LAB_SUBTITLE=Prof. Xiaogang Liu Lab · NTU Singapore
```

Restart the dev server (`npm run dev`). The amber "Demo mode" banner disappears
and Settings shows the connected host — that is how you know it worked.

---

## 8. Create the first account

Sign up in the app — by email link, Google, or password, whichever you set up.
**The first account created becomes the admin**, so make it yours or the PI's,
not a test address. If you do create a test account first, you can fix it in
Supabase: **Table Editor → profiles →** change `role` to `admin` on the right
row.

From then on, invite the group by simply sending them the link. Everyone who
signs up becomes a `member` — able to add and edit, but not delete. Promote or
restrict people from the **Members** page.

---

## 9. Publish it for the group

See the *Publishing* section in [README.md](README.md). Short version: push to
GitHub, set **Pages → Source → GitHub Actions**, and add `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` as repository **Variables**.

Once it's live at its real GitHub Pages URL, double check that URL is in the
redirect allow-list from step 5b — that's the step people forget, and the
symptom is sign-in working locally but failing the moment it's live.

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
| Nobody is an admin | The first sign-up predated the schema | Supabase → Table Editor → `profiles` → set `role` to `admin`. |
| Magic link / Google redirects to an error page, or "redirect not allowed" | The app's URL isn't on the allow-list | Add it under **Authentication → URL Configuration** (step 5b) — both the deployed URL and your `localhost` one. |
| Clicking a magic link signs in on a different device than expected | Expected — the link itself carries the session | Open it on the device you actually want signed in; if you checked mail on your phone, forward the link or open it there. |
| "Continue with Google" does nothing / shows a Google error | Google provider not enabled, or the redirect URI in Google Cloud doesn't match | Re-check step 6 — the callback URL must match exactly, including `https://`. |
| Published site is blank | Wrong base path | The app uses `HashRouter` and relative asset paths, so this should not happen. If it does, check that the Pages build actually finished in the Actions tab. |
| Structures and auto-fill do nothing | PubChem unreachable | This is optional enrichment and always fails soft. Everything else keeps working. |

---

<div align="center"><sub>Questions? The code is commented, and
<code>src/lib/api.ts</code> is the place to start reading.</sub></div>
