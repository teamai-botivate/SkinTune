# SkinTune — CLAUDE.md

Guidance for Claude Code (or any agent) working in this repo.

## What this is

SkinTune is a personal appearance-intelligence product. A user answers a
short, tap-driven wizard (appearance, body/fit, taste, colours, occasion,
context, desired impression, budget) and gets 5 personalized complete-look
recommendations (outfit, colour, jewellery, hairstyle, makeup, accessories).

**Explicitly out of scope — do not add these:** wardrobe digitisation,
wardrobe upload, real-time try-on, medical/diagnostic claims, beauty scoring.
The product is about confidence and expression, not judgement.

## Repo layout (pnpm workspace monorepo)

```
artifacts/
  skintune/          the actual product frontend (React + Vite + Tailwind v4)
  api-server/         Express 5 API; also serves the built frontend in prod
  mockup-sandbox/      Replit design-preview scaffold — not shipped product
lib/
  api-spec/            OpenAPI spec (Orval codegen source)
  api-zod/              generated Zod schemas from the spec
  api-client-react/     generated React Query hooks from the spec (unused by skintune today)
  db/                   Drizzle ORM + Postgres scaffold (schema currently empty)
scripts/               trivial workspace script package
Dockerfile              single-service deploy image (frontend + API in one container)
```

The **real product code** lives entirely in `artifacts/skintune/src/`. Read
`artifacts/skintune/README.md` for the frontend's own architecture notes
(state, services, mock data, image-generation boundary).

## Frontend architecture (artifacts/skintune)

- **No router.** Navigation is a hand-rolled `Screen` state machine in
  `App.tsx` (`useState<Screen>` + a `go()`/`back()` pair). `wouter` is
  installed but intentionally unused — don't wire it in without discussing;
  the state-machine approach is deliberate and keeps the WhatsApp-style
  one-question-at-a-time flow simple.
- **Wizard steps are generic, not duplicated per field.** `SingleChoiceStep`,
  `MultiChoiceStep`, and `HeightStep` (in `App.tsx`) are reused across every
  onboarding screen, driven by option lists in `src/data/options.ts`. Don't
  hand-roll a new one-off step component for a single-choice or multi-choice
  field — extend the generic step with a new entry in `screenContent`
  instead.
- **Single-choice steps auto-advance.** Tapping an option in
  `SingleChoiceStep` both selects it and calls `onNext()` after a short delay
  — this is intentional (tap → next, no separate "Continue" tap, no need to
  scroll to a footer button). The footer Continue button is kept only as a
  fallback for keyboard/assistive-tech users. Multi-choice steps do NOT
  auto-advance (the user needs to pick more than one thing).
- **Photo analysis** (`PhotoPanel` in `App.tsx`) shows staged "Analyzing…"
  copy (`src/data/photo-diagnostics.ts`), then either a good-photo appearance
  read or a specific, explainable problem (Problem / Why it matters / How to
  improve) with a Retry CTA. It never shows a generic "photo rejected"
  message.
- **Recommendation engine vs. image generation are separate services** — see
  below. UI components only ever call these two functions; they never talk
  to a specific model/provider directly.

### `src/services/recommendation-engine.ts`

Owns the *styling decision*: given a `SkinTuneProfile`, returns 5
`LookRecommendation` objects (outfit, colour, jewellery, hairstyle, makeup,
accessories, reasoning). Currently a mock returning a curated static set.

### `src/services/image-generation.ts`

Owns *visualising* those decisions. `generateLookImages(recommendations,
profile, context)` takes the recommendation engine's output and would call an
image provider (e.g. GPT Image 2) to produce real images — currently mocked
(simulated latency, returns the recommendations with their placeholder
`imageUrl`s unchanged). `buildLookImagePrompt()` shows how structured look
data becomes a prompt; a real provider adapter should build on this rather
than letting the image model invent its own styling strategy.

**To connect a real image provider later:** implement the provider call
inside `generateLookImages()` (keep the same signature) and have it return
each look with a real `imageUrl`. No UI changes should be required.

### Data model

`src/types.ts` — `SkinTuneProfile`, `LookRecommendation`, `LookFeedback`,
`GenerationResult` are the client-facing contracts. Keep these stable if you
add a real backend.

### State / persistence

Frontend-only prototype. Three `localStorage` keys, all in `App.tsx`:
`skintune-profile` (includes the uploaded photo as a base64 data URL —
prototype-only, do not add more sensitive data here), `skintune-saved-looks`,
`skintune-feedback`. `Settings` has a working delete-everything flow.

## Backend (artifacts/api-server)

Express 5, esbuild-bundled to a single `dist/index.mjs`. Currently exposes
one real route, `GET /api/healthz`. In production it **also serves the built
SkinTune frontend as static files** — see `src/app.ts`: if `STATIC_DIR`
(or `./public` next to the bundle) exists, it's served via
`express.static`, with an SPA fallback to `index.html` for any non-`/api`,
non-file route. If no static dir is present (e.g. local API-only dev), it
just logs a warning and serves the API alone — this file should keep working
either way.

## Deployment — Render, single Docker web service

**One Render web service, built from the root `Dockerfile`.** No
`render.yaml` — configure the service directly in the Render dashboard
(Environment: Docker, Dockerfile path: `Dockerfile` at repo root, no build/
start command overrides — the Dockerfile's `CMD` is authoritative).

The image:
1. Installs the full pnpm workspace (needed because `artifacts/api-server`
   depends on workspace packages like `@workspace/api-zod`).
2. Builds `artifacts/skintune` (Vite) → `artifacts/skintune/dist/public`.
3. Builds `artifacts/api-server` (esbuild) → `artifacts/api-server/dist`.
4. Runtime stage copies only `dist/` (API bundle) and `dist/public` (frontend
   build, renamed to `/app/public`) into a slim `node:24-slim` image and runs
   `node dist/index.mjs`.

Render sets `$PORT` itself; `artifacts/api-server/src/index.ts` already reads
`process.env.PORT` (throws clearly if missing) — nothing else to configure.
`STATIC_DIR` is baked into the image as `/app/public` by the Dockerfile.

**Do not add a `render.yaml`** unless the user asks for one — the dashboard
Docker service + this Dockerfile is the whole deployment story.

If you change the Dockerfile, re-verify by hand against the actual repo
paths (`docker build` may not be available in this dev environment — it
wasn't when this file was written). At minimum: confirm every path the
Dockerfile `COPY`s exists, and that `pnpm --filter @workspace/skintune run
build` and `pnpm --filter @workspace/api-server run build` both still
succeed from repo root.

## Commands

```bash
pnpm install                                          # from repo root
pnpm --filter @workspace/skintune run dev              # frontend dev server (needs PORT + BASE_PATH env vars)
pnpm --filter @workspace/api-server run dev             # API dev server (needs PORT)
pnpm run typecheck                                       # whole workspace
pnpm --filter @workspace/skintune run build               # frontend production build
pnpm --filter @workspace/api-server run build               # API production bundle
```

`artifacts/skintune`'s Vite config requires `PORT` and `BASE_PATH` env vars
to even start (throws otherwise) — this is intentional, inherited from the
Replit workflow. For a plain local dev run: `PORT=5173 BASE_PATH=/ pnpm
--filter @workspace/skintune run dev`.

## Working conventions

- Don't add wardrobe upload/try-on features — see "What this is" above.
- Keep option vocabulary (labels, emojis) centralized in
  `src/data/options.ts`, not inline in `App.tsx`.
- Keep the recommendation engine and image generation as two separate
  service files — never let a UI component import a provider SDK directly.
- No medical/diagnostic language anywhere in copy. Avoid words like "flaws",
  "hide your body", "make you fairer", "dull", "unsuitable body",
  "imperfections" — see the product brief's supportive-language guidance.
- This repo has no test suite yet. Verify changes with `pnpm run typecheck`
  and the relevant `build` script at minimum before considering a change
  done.
