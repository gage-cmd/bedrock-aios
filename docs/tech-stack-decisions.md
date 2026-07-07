# Tech Stack Decisions

Recorded at Phase 0 so this doesn't get re-litigated later.

| Layer | Choice | Reasoning |
|---|---|---|
| Frontend | Next.js (TypeScript, App Router) + Tailwind CSS | App Router gives server components and file-based routing out of the box; Tailwind avoids hand-rolling a design system for an early-stage dashboard. |
| Frontend hosting | Vercel | Zero-config deploys for Next.js, generous free tier, first-party support for the framework we're using. |
| Backend | NestJS (TypeScript) | Opinionated module/provider structure maps directly onto the AIOS core/module split we need (auth, tenant-resolver, orchestrator, etc. as isolated Nest modules). |
| Backend hosting | Railway | Simple deploys for long-running Node services without the cold-start tradeoffs of serverless functions. |
| Database + Auth + vector search | Supabase (Postgres + pgvector + built-in Auth) | One provider covers relational data, multi-tenant auth, and vector search for RAG/context features, instead of stitching together three services. |
| Package manager | pnpm | Fast, disk-efficient, and has first-class workspace support for the monorepo layout. |
| Repo layout | Monorepo (apps/dashboard + backend) | Frontend and backend evolve together at this stage; one repo keeps versioning and deploys simple until there's a reason to split. |

## Live URLs

- Frontend (Vercel): https://bedrock-aios-dashboard.vercel.app/
- Backend (Railway): https://backend-production-7f81.up.railway.app/
