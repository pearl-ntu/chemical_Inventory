<div align="center">

# PEARL Inventory

**Chemical inventory management for the PEARL Group**
Prof. Xiaogang Liu Lab · Nanyang Technological University, Singapore

*Every reagent, every shelf, one source of truth.*

</div>

---

## What this is

A web app that replaces the group's shared inventory spreadsheet. It runs in any
browser, works on a phone at the bench, and gives everyone in the group their own
account so you can always tell who registered what and when.

It ships pre-loaded with the group's real inventory as of **27 July 2026** —
235 containers across 16 storage locations, 40 suppliers.

### What it does

| | |
|---|---|
| 🔑 **Accounts for everyone** | Sign in with an email link or a password. Three access levels — admin, member, viewer — enforced by the database, not just the interface. |
| ✅ **Approval gate** | Anyone can sign up, but nobody sees a single row of the inventory until an admin approves the account. Open sign-up, closed by default. |
| 🔍 **Instant search** | Press `/` anywhere. Search by name, CAS, PEARL code, supplier, shelf, or remarks, all at once. |
| 🧪 **One row per bottle** | Amount, pack size, purity, supplier, catalogue number, project, price, opened date, expiry. |
| 🗺️ **Shelf map** | Every fridge and cabinet with its contents, grouped into cold storage / cabinets / flammables store. |
| ⚠️ **Safety built in** | GHS hazard tags, storage classes, and an automatic **segregation check** that flags shelves holding incompatible classes together. |
| 🏷️ **Printable QR labels** | A sticker per bottle. Scan with any phone camera and that container's record opens. |
| 🧬 **PubChem lookup** | Type a CAS number, get the formula, molar mass and structure drawing filled in. |
| 📊 **Analytics** | Totals on hand, top suppliers, purchasing routes, hazard profile, registrations over time. |
| 🔁 **Duplicate warning** | Registering something the lab already holds? It tells you before you order again. |
| 📥 **Import / export** | Plain CSV both ways. The original Excel sheet's column headings are recognised as-is. |
| 📝 **Audit trail** | Append-only log of every change, with who and when. |
| 🌙 **Light & dark** | Both properly designed, not an automatic inversion. |
| 📱 **Works on a phone** | Fully responsive; the whole point is to check the shelf without walking back to a desk. |

---

## Two ways to run it

### Demo mode — zero setup

Just open the app. Everything is stored in your browser's local storage,
pre-loaded with the lab's real starter inventory. Nothing is shared between
people. Good for trying it out, for a public preview, and for offline reference.

### Cloud mode — what the group should actually use

Connect a free [Supabase](https://supabase.com) project and you get real
accounts, one shared live database, permissions enforced at the database level,
and instant updates across everyone's screens.

**→ [SETUP.md](SETUP.md) walks through it in about ten minutes.**

---

## Running it locally

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. To connect a database, copy `.env.example` to
`.env` and fill in the two Supabase values.

```bash
npm run build      # production build into dist/
npm run preview    # serve the production build
npm run typecheck  # TypeScript, no emit
```

---

## Publishing it so the whole group can use it

The repository includes a GitHub Actions workflow that builds the app and
publishes it to **GitHub Pages** on every push to `main`.

1. Push this folder to a GitHub repository.
2. In the repository, go to **Settings → Pages** and set **Source** to
   **GitHub Actions**.
3. Add your Supabase keys under **Settings → Secrets and variables → Actions →
   Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   (Use *Variables*, not *Secrets* — these are public client-side keys that have
   to be baked into the built JavaScript. The database is protected by Row Level
   Security policies, not by keeping the key hidden. Never publish the
   `service_role` key.)
4. Push. The app appears at `https://<user>.github.io/<repo>/`.

If you skip step 3, the published site still works — it just runs in demo mode.

Any static host works equally well: Netlify, Vercel, Cloudflare Pages, or an NTU
web server. The build is plain static files with no server-side component.

---

## How it is put together

```
src/
  lib/
    types.ts        Domain model — Chemical, Profile, Status, hazards
    api.ts          THE data layer. Every page talks to this and nothing else.
    supabase.ts     Cloud client (null in demo mode)
    localDb.ts      Demo-mode backend, localStorage
    seedData.ts     The lab's 235 containers, generated from the Excel sheet
    csv.ts          Import parser + export writer, forgiving header matching
    pubchem.ts      Optional PubChem enrichment, cached, fails soft
    hazardHints.ts  Curated hazard suggestions + incompatibility rules
    qr.ts           QR label deep links
    utils.ts        Formatting, CAS check-digit validation, unit normalisation
  context/          Auth, inventory store, toasts
  components/       Layout, charts, forms, drawer, dialogs
  pages/            One file per route
supabase/
  schema.sql        Tables, triggers, RLS policies — run this first
  seed.sql          The 235 starter containers — run this second (optional)
```

The important design decision: **`src/lib/api.ts` is the only module that knows
whether the app is talking to Supabase or to local storage.** Pages call
`api.listChemicals()` and never care. That is what makes demo mode more than a
gimmick, and it is where to look first when something misbehaves.

### A note on access control

Permissions are enforced by PostgreSQL Row Level Security policies in
`supabase/schema.sql`, not by hiding buttons. A viewer who opens the browser
console still cannot write to the inventory, and — the part that actually
matters on an open sign-up page — an unapproved account cannot read a single
row of it either. The first account created in a fresh database automatically
becomes the admin, fully approved. Every account after that starts locked
out entirely (a "waiting for approval" screen, not a limited view) until an
admin approves them from the Members page, which is the real gate here, not
the sign-up form.

### A note on safety data

Hazard tags and storage classes are there so you can **filter and segregate** —
they are not a safety reference. The supplier's Safety Data Sheet is the
authority, and every relevant screen says so. The curated hazard suggestions in
`hazardHints.ts` cover about thirty common lab chemicals and are deliberately
short and hand-checked; a long, half-verified list would be worse than none.

---

## Day-to-day use

- **Press `/`** anywhere to jump to search.
- **Finished a bottle?** Open it and hit *Mark empty* rather than deleting — the
  record stays for reordering and audits, and the date is stamped automatically.
- **New delivery?** *Add chemical*, type the CAS, press *Auto-fill*. The formula,
  molar mass and structure come from PubChem.
- **Print labels** for a whole shelf at once from the QR labels page.
- **Leaving the group?** Settings → *Export everything as CSV*. The data is
  yours, in a format anything can read.

---

## Licence

MIT — see [LICENSE](LICENSE). Use it, fork it, adapt it for another group.

---

<div align="center">
<sub>Built as a parting gift for the PEARL Group.<br/>
May your fridges always be organised. 🧪</sub>
</div>
