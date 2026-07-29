# PEARL Inventory Feature Documentation

This document describes the major features currently implemented in PEARL Inventory, how they work, and which files are involved.

## 1. Workspace Model

PEARL has two workspaces:

- **Experimental**: shared chemical inventory for approved lab members.
- **Computational**: private research asset inventory for each user.

The workspace switch is handled in:

- `src/components/Layout.tsx`
- `src/App.tsx`

Experimental routes include dashboard, inventory, locations, operations, analytics, activity, QR labels, members, and settings.

Computational routes include dashboard, research assets, Linux/HPC sync, HPC tutorial, analytics, activity, members, and settings.

## 2. Authentication And Access

The app supports:

- email/password sign-in
- magic-link sign-in
- first account becomes approved admin
- later accounts wait for admin approval
- roles: admin, member, viewer

Access is enforced in Supabase Row Level Security, not only in the interface.

Important files:

- `src/context/AuthContext.tsx`
- `src/pages/LoginPage.tsx`
- `src/pages/PendingApprovalPage.tsx`
- `src/pages/MembersPage.tsx`
- `supabase/schema.sql`

## 3. Chemical Inventory

The chemical inventory tracks one row per physical bottle/container.

Fields include:

- PEARL code
- name
- CAS number
- molecular formula
- molar mass
- purity/grade
- concentration
- quantity
- size/unit
- status
- location
- shelf/position
- supplier
- catalogue number
- purchasing system
- price/currency
- project/grant
- responsible person
- registered date
- opened date
- expiry date
- batch/lot number
- SDS link
- CoA link
- invoice or delivery order link
- GHS hazards
- storage class
- disposal date, reason, and waste class
- notes

Important files:

- `src/pages/InventoryPage.tsx`
- `src/components/ChemicalForm.tsx`
- `src/components/ChemicalDrawer.tsx`
- `src/lib/types.ts`
- `src/lib/api.ts`
- `src/lib/localDb.ts`
- `supabase/schema.sql`

## 4. CAS And PubChem Auto-Fill

When a user enters a CAS number, PEARL can query PubChem and fill:

- compound name
- formula
- molar mass
- structure data

The app fails softly if PubChem is unavailable.

Important files:

- `src/lib/pubchem.ts`
- `src/components/ChemicalForm.tsx`
- `src/components/StructureEditor.tsx`

## 5. Structure And Reaction Drawing

The app includes editing tools for:

- 2D chemical structures
- reaction or synthesis scheme notes
- stored molfile/reaction text metadata

Important files:

- `src/components/StructureEditor.tsx`
- `src/components/ReactionEditor.tsx`
- `src/components/ChemicalForm.tsx`
- `src/components/ChemicalDrawer.tsx`

## 6. Safety And Storage

Safety features include:

- GHS hazard tags
- storage classes
- hazard hints
- segregation/incompatibility warnings
- expiry/opened-date metadata
- disposal metadata
- low-stock/reorder metadata

Important files:

- `src/lib/hazardHints.ts`
- `src/pages/OperationsPage.tsx`
- `src/pages/LocationsPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/components/HazardBadges.tsx`

## 7. QR Labels

QR labels can be printed for chemical containers. Each label links back to the relevant container record.

Important files:

- `src/pages/LabelsPage.tsx`
- `src/lib/qr.ts`
- `src/index.css`

## 8. Delivery Photo Support

Users can attach a delivery photo/invoice image. The app can extract likely CAS, price, and pack-size fields locally and presents them as suggestions for confirmation.

Important files:

- `src/components/DeliveryPhotoPanel.tsx`
- `src/lib/deliveryPhoto.ts`
- `src/components/ChemicalForm.tsx`
- `supabase/schema.sql`

## 9. Import And Export

Chemical inventory supports CSV import/export. The parser accepts both PEARL column names and common spreadsheet headings.

Research assets also support:

- CSV export
- CSV template download
- CSV import
- local code/data asset upload

Important files:

- `src/lib/csv.ts`
- `src/components/ImportDialog.tsx`
- `src/pages/InventoryPage.tsx`
- `src/pages/ResearchAssetsPage.tsx`

## 10. Admin Members Area

Admins can:

- approve waiting users
- invite users
- change roles
- revoke access
- remove member profiles
- review invited/pending users

Important files:

- `src/pages/MembersPage.tsx`
- `src/lib/api.ts`
- `supabase/schema.sql`

## 11. Computational Research Assets

The computational registry stores metadata and pointers for:

- datasets
- models
- simulations
- code
- notebooks
- compute resources
- samples
- publications
- other research assets

Typical fields:

- type
- title
- description
- project
- owner
- source
- external path
- storage link
- size
- format
- checksum/version
- tags
- method
- software
- input/output links
- repository link
- environment
- metrics
- status
- notes
- related chemical links

Important files:

- `src/pages/ResearchAssetsPage.tsx`
- `src/pages/ComputationalDashboardPage.tsx`
- `src/pages/ComputationalAnalyticsPage.tsx`
- `src/pages/ComputationalActivityPage.tsx`
- `src/lib/types.ts`
- `src/lib/api.ts`
- `src/lib/localDb.ts`
- `supabase/schema.sql`

## 12. Computational Privacy

Computational assets are private per user. A user should only see their own:

- research asset rows
- research asset links
- computational activity entries
- imported HPC folder metadata

The chemical inventory remains shared across approved lab members.

Important files:

- `src/lib/types.ts`
- `src/lib/api.ts`
- `src/pages/ComputationalActivityPage.tsx`
- `src/pages/ResearchAssetsPage.tsx`
- `supabase/schema.sql`
- `supabase/make_computational_assets_private.sql`

For an existing deployed database, run:

```sql
-- See the full file:
-- supabase/make_computational_assets_private.sql
```

## 13. Linux/HPC Sync

The Linux/HPC workflow uses a small Python agent that runs inside the user's HPC account.

The agent is read-only by default. It can:

- report health
- run safe inspection commands
- list folders
- preview text files
- scan calculation folders
- return parsed metadata to PEARL

The app then imports folder-level research assets. It does not upload raw calculation files.

Important files:

- `tools/pearl_hpc_agent.py`
- `tools/pearl-hpc-agent.mjs`
- `src/pages/HpcSyncPage.tsx`
- `src/pages/HpcTutorialPage.tsx`
- `src/pages/ResearchAssetsPage.tsx`

### User Workflow

1. Open **Computational -> HPC Tutorial**.
2. Download `pearl_hpc_agent.py`.
3. Place it in the HPC account, for example in the home folder.
4. Open a local SSH tunnel:

```bash
ssh -L 8788:127.0.0.1:8787 <your-account>@aspire2antu.nscc.sg
```

5. On HPC, start the agent:

```bash
PEARL_AGENT_ROOT=/scratch/users/sutd/your_account/project/run_01 PEARL_AGENT_TOKEN=choose-a-secret python3 ~/pearl_hpc_agent.py
```

6. In PEARL, open **Computational -> Linux/HPC Sync**.
7. Set:

```text
Agent URL: http://127.0.0.1:8788
Token: choose-a-secret
Folder to analyze: .
```

8. Use the terminal to inspect or click **Scan and import**.
9. Open **Research Assets** to browse imported folder cards and preview files.

### Safety Model

The default agent blocks destructive or write-oriented commands, including common operations such as remove, move, copy, chmod, mkdir, touch, redirection, and shell command chaining. PEARL delete buttons only delete PEARL metadata rows. They do not delete HPC files.

## 14. Analytics

Experimental analytics include inventory totals, suppliers, hazards, statuses, and registrations over time.

Computational analytics include:

- asset counts
- dataset/model/simulation coverage
- duplicate dataset watch
- storage/size metadata
- missing descriptions/tags/links
- stale verification records
- software and source breakdowns

Important files:

- `src/pages/AnalyticsPage.tsx`
- `src/pages/ComputationalAnalyticsPage.tsx`
- `src/components/charts.tsx`

## 15. Activity Logs

Chemical inventory activity is shared for approved users because it is part of the lab audit trail.

Computational activity is private. The computational activity page filters to the signed-in user, and the database policy blocks research-asset activity rows from other users.

Important files:

- `src/pages/ActivityPage.tsx`
- `src/pages/ComputationalActivityPage.tsx`
- `src/lib/api.ts`
- `supabase/schema.sql`

## 16. Appearance And UX

UI improvements include:

- experimental/computational workspace switch
- adjustable sidebar width
- light/dark themes
- theme options in settings
- compact action toolbars
- responsive pages for mobile and desktop
- separate tutorial and working pages for HPC sync

Important files:

- `src/components/Layout.tsx`
- `src/pages/SettingsPage.tsx`
- `src/lib/appearance.ts`
- `src/index.css`
- `tailwind.config.js`

## 17. Database Scripts

Main scripts:

- `supabase/schema.sql`: full schema and policies for new deployments.
- `supabase/seed.sql`: starter chemical inventory.
- `supabase/upgrade_current_to_computational_hpc.sql`: upgrade an existing database with computational/HPC tables and policies.
- `supabase/make_computational_assets_private.sql`: privacy patch for existing deployments.
- `supabase/cleanup_hpc_file_level_assets.sql`: removes older noisy file-level HPC imports from PEARL metadata only.

## 18. Verification Commands

Recommended checks before pushing:

```bash
npm run typecheck
npm run build
python -m py_compile tools/pearl_hpc_agent.py
```

The production build may warn that chemistry/library chunks are large. That warning is expected because chemistry tooling and resource data are bundled; it is not a failed build.
