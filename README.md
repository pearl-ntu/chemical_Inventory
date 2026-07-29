# PEARL Inventory

Internal chemical and computational research inventory for the PEARL Group  
Photon Emission & Reactivity Lab, Prof. Xiaogang Liu Lab, Nanyang Technological University

This repository is maintained for PEARL internal use. It contains the web app, Supabase schema, setup notes, and Linux/HPC metadata agent used by the group inventory system.

## Maintainer Notes

- Setup instructions: [SETUP.md](SETUP.md)
- Feature documentation: [FEATURES.md](FEATURES.md)
- Database schema: [supabase/schema.sql](supabase/schema.sql)
- Computational privacy patch: [supabase/make_computational_assets_private.sql](supabase/make_computational_assets_private.sql)
- HPC agent: [tools/pearl_hpc_agent.py](tools/pearl_hpc_agent.py)

## Local Checks

```bash
npm run typecheck
npm run build
python -m py_compile tools/pearl_hpc_agent.py
```

---

Vibecoded by Syed Ali Abbas Abedi as a parting gift for the PEARL Group.
