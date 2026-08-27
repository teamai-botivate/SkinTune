# SkinTune

SkinTune helps people turn their appearance profile and personal preferences into five supportive, complete looks for the occasion ahead.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/skintune run dev` — run the SkinTune frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/skintune/src/App.tsx` — frontend flow and screen state
- `artifacts/skintune/src/types.ts` — SkinTune data contracts
- `artifacts/skintune/src/data/options.ts` — centralized wizard option lists
- `artifacts/skintune/src/services/recommendation-engine.ts` — the styling-decision boundary
- `artifacts/skintune/src/services/image-generation.ts` — replaceable image-generation boundary
- `artifacts/skintune/src/index.css` — app theme and responsive styles
- `artifacts/skintune/README.md` — frontend setup and continuation notes
- `Dockerfile` (repo root) — single-service Render deployment image
- `CLAUDE.md` (repo root) — architecture and deployment guide for agents

## Architecture decisions

- This first version is intentionally frontend-only: localStorage makes the full journey testable without a backend.
- Image generation is behind a service boundary so a real image provider can replace the mock without rewriting UI.
- Recommendations are complete-look strategies first; images visualize those strategies rather than inventing them.
- Appearance guidance is framed as supportive styling context, never a medical assessment or beauty score.

## Product

SkinTune supports profile onboarding, photo consent and confidence diagnostics, body and fit preferences, personal style and color preferences, restrictions, occasion context, desired impression, budget, editable review, five generated looks, detailed look views, saved looks, feedback, returning-user continuity, and local data deletion.

## User preferences

The requested experience is mobile-first, tap/select/continue-oriented, supportive, fashion-tech, feminine-neutral, and free of wardrobe digitization or try-on.

## Gotchas

- The frontend workflow provides `PORT` and `BASE_PATH`; use the managed workflow rather than starting Vite without them.
- The photo preview is read via `FileReader` as a base64 data URL for this prototype and is not uploaded to a server.

## Deployment

Deployed as a single Render Docker web service (see repo-root `Dockerfile` and `CLAUDE.md`): one container builds and runs both the frontend and `artifacts/api-server`, with Express serving the frontend's production build as static files alongside its `/api/*` routes. No `render.yaml` — the service is configured directly in the Render dashboard against the root `Dockerfile`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
