# PEARL Inventory

Chemical and computational research inventory for the PEARL Group  
Photon Emission & Reactivity Lab, Prof. Xiaogang Liu Lab, Nanyang Technological University

PEARL Inventory is a browser-based lab operations app for tracking chemical bottles, storage locations, safety metadata, members, QR labels, computational research assets, and Linux/HPC calculation folders.

The experimental chemical inventory is shared across approved lab members. The computational workspace is private by default, so each user sees only their own computational assets and HPC activity.

## Main Features

### Experimental Inventory

- Account approval workflow with admin, member, and viewer roles.
- One record per physical chemical container.
- CAS lookup and PubChem enrichment for compound name, formula, molar mass, and structure.
- Built-in structure and reaction/scheme editors.
- Supplier, catalogue, price, project, SDS, CoA, invoice, batch, concentration, opened date, expiry date, and disposal metadata.
- Delivery photo attachment and on-device extraction helpers.
- QR label generation and printable bottle labels.
- Location and shelf views for cabinets, fridges, freezers, and storage areas.
- Hazard tags, storage classes, and segregation checks.
- Low-stock, expiry, opened-date, disposal, and reorder metadata.
- CSV import/export and starter inventory loading.
- Append-only activity log for chemical inventory operations.
- Admin members area for approvals, role changes, invites, revokes, and member access management.

### Computational Workspace

- Separate computational dashboard, research assets registry, analytics, activity, and Linux/HPC sync pages.
- Research assets for datasets, models, simulations, code, notebooks, compute resources, samples, publications, and other digital/scientific records.
- Metadata-first design: store pointers, ownership, project, method, software, path, status, tags, notes, and relationships rather than uploading raw HPC data.
- Private-by-default computational records. Users do not see another user's computational assets or research-asset activity.
- Local code/data asset upload for Python, MATLAB, notebooks, scripts, and data pointers.
- CSV template/import/export for research assets.
- Linux/HPC sync using a small read-only Python agent.
- Folder-level import from Gaussian, GAMESS, ORCA, and VASP-style calculation folders.
- Live HPC folder browser with text preview and preview download.
- PEARL metadata delete/edit actions that do not delete or modify NSCC/HPC files.

Full details are in [FEATURES.md](FEATURES.md).

## Running Locally

```bash
npm install
npm run dev
```

Open <http://localhost:5173>.

For a production build:

```bash
npm run typecheck
npm run build
npm run preview
```

## Database Setup

The app can run in demo mode using browser storage, but the real group deployment should use Supabase.

1. Create a Supabase project.
2. Run [supabase/schema.sql](supabase/schema.sql).
3. Optionally run [supabase/seed.sql](supabase/seed.sql) to load the starter chemical inventory.
4. Configure `.env` from `.env.example`.
5. Configure Supabase Authentication redirect URLs for local and deployed URLs.

Detailed instructions are in [SETUP.md](SETUP.md).

### Required Privacy Patch For Computational Assets

If upgrading an existing deployed database, run:

[supabase/make_computational_assets_private.sql](supabase/make_computational_assets_private.sql)

This makes computational records private per user and hides research-asset activity from other users. Chemical inventory sharing is unchanged.

## Linux/HPC Sync

The app includes a downloadable Python agent:

[tools/pearl_hpc_agent.py](tools/pearl_hpc_agent.py)

Typical workflow:

1. Open **Computational -> HPC Tutorial**.
2. Download `pearl_hpc_agent.py`.
3. Put it anywhere in your Linux/HPC account.
4. From your local computer, open an SSH tunnel:

```bash
ssh -L 8788:127.0.0.1:8787 <your-account>@aspire2antu.nscc.sg
```

5. On HPC, run the agent against the folder you want PEARL to inspect:

```bash
PEARL_AGENT_ROOT=/scratch/users/sutd/your_account/project/run_01 PEARL_AGENT_TOKEN=choose-a-secret python3 ~/pearl_hpc_agent.py
```

6. In PEARL, open **Computational -> Linux/HPC Sync**, set:

```text
Agent URL: http://127.0.0.1:8788
Token: choose-a-secret
Folder to analyze: .
```

7. Scan and import. PEARL stores metadata and folder summaries only. Raw files stay on HPC.

## Publishing

The repository includes a GitHub Actions workflow for GitHub Pages. In the GitHub repository:

1. Go to **Settings -> Pages**.
2. Set **Source** to **GitHub Actions**.
3. Add repository Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Push to `main`.

Any static host also works because the app builds to plain static files.

## Project Structure

```text
src/
  components/       Shared UI, layout, forms, drawers, dialogs, charts
  context/          Auth, inventory state, toasts
  lib/              Data layer, Supabase/local storage, CSV, PubChem, types
  pages/            App routes
supabase/
  schema.sql        Main database schema, triggers, policies
  seed.sql          Starter chemical inventory
  *.sql             Upgrade/privacy helper scripts
tools/
  pearl_hpc_agent.py  Read-only Linux/HPC metadata agent
```

The main data boundary is `src/lib/api.ts`. Pages call this API layer and do not need to know whether data is coming from Supabase or local demo storage.

## License

MIT. Use, fork, and adapt for another research group.
