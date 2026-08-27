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
  `MultiChoiceStep`, `HeightStep`, and `SectionStep` (in `App.tsx`) are
  reused across every onboarding screen, driven by option lists in
  `src/data/options.ts`. Don't hand-roll a new one-off step component for a
  single-choice or multi-choice field — extend a generic step (or a
  section's `fields` array) with a new entry instead.
- **Single-choice steps auto-advance; sections don't.** Tapping an option in
  a standalone `SingleChoiceStep` both selects it and calls `onNext()` after
  a short delay — this is intentional (tap → next, no separate "Continue"
  tap). The footer Continue button is kept only as a fallback for
  keyboard/assistive-tech users. Fields inside a `SectionStep` never
  auto-advance, even single-choice ones — a section holds several questions
  on one page, so advancing on the first tap would skip the rest before the
  user could answer them. One Continue button per section, gated on that
  section's required fields.
- **After the photo step, questions are grouped into 3 section screens, not
  11 individual ones.** `body-style` (build, fit, priorities, style),
  `colors-occasion` (colours loved/avoided, restrictions, occasion,
  occasion details), `final-prefs` (impression, budget) — each is one
  `SectionStep` call with a `fields` array, not separate `Screen` entries.
  This exists specifically to cut onboarding time after photo upload; if a
  new field belongs conceptually with one of these three groups, add it to
  that section's `fields` array rather than creating a new standalone
  screen. `SectionField`'s `kind: 'single' | 'multi' | 'text'` covers
  everything currently needed (a plain textarea uses `'text'`); required
  defaults to `true` — pass `required: false` for optional fields (e.g.
  colours to avoid, restrictions).
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
accessories, reasoning). Calls the backend's `POST /api/recommendations`
(GPT-4o, strict JSON-schema structured output — see
`artifacts/api-server/src/routes/recommendations.ts`); on any failure (no
`OPENAI_API_KEY` configured, network issue, provider error) it falls back to
a curated static mock set so the UI never dead-ends.

### `src/services/image-generation.ts`

Owns *visualising* those decisions. `generateLookImages(recommendations,
profile, context)` calls the backend's `POST /api/generate-image` **once per
look** (OpenAI `gpt-image-2` — see
`artifacts/api-server/src/routes/generate-image.ts`), in parallel, not one
batched request for all 5. Each look falls back independently to its
existing placeholder `imageUrl` if its own request fails, so one failure
never blocks the other four.

**Sends `profile.photoUrl` (unlike `recommendation-engine.ts`, which strips
it)** — the backend calls OpenAI's `images.edit` on that photo, so the
generated look shows THE SAME PERSON re-dressed, not a stranger from a text
prompt. This is deliberate and required for the product's core promise; if
the user skipped the photo step, the backend falls back to text-to-image
generation via `images.generate` (still usable as a style visualisation,
just won't resemble the user). Verified live: an edit call against a real
reference photo returned an image with the same face/hair/build, correctly
re-dressed per the look's outfit — see git history around this change.

`gpt-image-2`'s `images.edit` does **not** support the `input_fidelity`
parameter (confirmed against the live API with a 400, despite some docs
describing it for the gpt-image family generally — it's `gpt-image-1`/
`1.5`-only) — don't add it back without re-verifying against whatever model
is current at the time.

**Identity preservation is fragile and composition-dependent — this was a
real production bug.** `images.edit` does not strongly guarantee the output
face matches the input face; the model has more room to "reinterpret" the
face the further the requested output composition is from the input photo.
A close-up selfie edited into a full-length editorial shot lost the user's
actual face entirely in production. The fix (see `buildLookEditPrompt` in
`generate-image.ts`) was two things together, not prompting alone:
1. Very explicit, repeated identity instructions — stated up front AND
   restated at the end of the prompt (both ends of a prompt get weighted
   more heavily than the middle).
2. **Requesting waist-up/portrait framing instead of full-length.** This is
   the bigger lever: a smaller transformation from a typical selfie's
   framing empirically preserves the face far better than asking for a
   full-length editorial shot. Verified by generating a synthetic
   selfie-style reference photo (close-up, low angle, distinctive facial
   hair, matching a real user's actual upload style) and confirming the
   edited output kept the same face, hair, and build.

If you ever need full-length shots again, expect identity drift to return
and budget time to re-solve it (e.g. multi-step composition, or accepting
the tradeoff with a clear UI disclaimer) rather than assuming the current
prompt generalizes to a bigger transformation.

**Do not re-batch this into a single multi-look request.** A single
generated image (even JPEG-compressed) can run a few hundred KB to low
single-digit MB; 5 of them in one JSON response is exactly what caused a
real production `413 Payload Too Large` (intermittently, depending on
image size that round) — not from the request body (already small), but
because bundling 5 large images into one response risks tripping a
body-size limit somewhere in the deployment chain that isn't fully under
this app's control (a hosting platform's reverse proxy, for example). One
request per look keeps every request/response small and bounded regardless
of how many looks there are or how large any single image comes out.

**The OpenAI API key lives only in `artifacts/api-server`**, read from
`OPENAI_API_KEY` (see `src/lib/openai-client.ts`). It is never sent to or
readable from the browser — the frontend only ever calls same-origin
`/api/recommendations`, `/api/generate-image`, and `/api/analyze-photo`.
Model names are overridable via `OPENAI_TEXT_MODEL` (default `gpt-4o`) and
`OPENAI_IMAGE_MODEL` (default `gpt-image-2`).

### `src/services/photo-analysis.ts`

Calls the backend's `POST /api/analyze-photo` (GPT-4o **vision** — see
`artifacts/api-server/src/routes/analyze-photo.ts`) to actually look at the
uploaded photo and judge whether it's usable, and if so, estimate skin
tone/undertone/contrast/confidence. Falls back to a mock "good" result if
the call fails, same pattern as the other services.

**Two of the three AI routes now legitimately receive the raw photo:**
`/api/analyze-photo` (to read it) and `/api/generate-image` (to edit it —
see `image-generation.ts` above). Only `/api/recommendations` still strips
it (it only ever needs `appearance.skinTone`/`undertone`, already derived
by the analysis step). Don't assume "the photo never leaves the browser" as
a blanket rule when touching these routes — check which one you're actually
changing.

`PhotoPanel` in `App.tsx` calls this from `runAnalysis()`, which also keeps
the staged "Analyzing…" UI on screen for its full minimum duration even if
the real analysis returns faster, so the experience doesn't flash past.

Local dev: copy `artifacts/api-server/.env.example` to `.env` (gitignored)
and fill in `OPENAI_API_KEY`, or set it directly in your shell. The frontend
dev server proxies `/api/*` to `http://localhost:5000` by default (see
`API_PROXY_TARGET` in `artifacts/skintune/vite.config.ts`) so both `pnpm
--filter @workspace/api-server run dev` and `pnpm --filter @workspace/skintune
run dev` can run side by side locally.

### Data model

`src/types.ts` — `SkinTuneProfile`, `LookRecommendation`, `LookFeedback`,
`GenerationResult` are the client-facing contracts. Keep these stable if you
add a real backend.

**Every `SkinTuneProfile` field's array-vs-string shape must match how it's
actually populated in the wizard.** `App.tsx`'s generic `SingleChoiceStep`
writes a plain `string`; `MultiChoiceStep` writes a `string[]`. The
`update({ [field]: v } as Partial<SkinTuneProfile>)` cast inside both
bypasses TypeScript's per-field checking, so pairing the wrong step
component with a field's declared type will NOT be caught by `tsc` — it
will build and typecheck cleanly, then crash at runtime the first time
something calls `.join()` (or similar) on what's actually a string, or
tries to read a string as an array. This happened once in production (the
Review screen crashed on `profile.fit.join(...)` after `fit` was switched
from multi- to single-select) — when adding or changing a wizard field,
manually re-check `types.ts`, `initialProfile`, every place that field is
read (grep for `.fieldName`), AND `artifacts/api-server/src/lib/
skintune-schemas.ts`'s mirrored Zod schema, which is a second, independent
place this same mismatch can hide.

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

**Request body size:** `SkinTuneProfile.photoUrl` is a base64 data URL of
the user's photo and can be several hundred KB to a few MB. Only
`recommendation-engine.ts` strips it before POSTing (`/api/recommendations`
never uses the raw photo — only the already-derived
`appearance.skinTone`/`undertone`), so `photoUrl` is `.optional()` on
`SkinTuneProfileSchema`. `photo-analysis.ts` and `image-generation.ts` both
legitimately send it — the former to read it, the latter as a separate
top-level `photoUrl` field on `GenerateImageRequestSchema` (edited via
`images.edit`, not embedded in `profile`). `app.ts` raises Express's
default 100kb JSON body limit to 15mb, which comfortably covers a single
photo on any of these routes.

**Response body size:** see the "Do not re-batch" note under
`image-generation.ts` above — `/api/generate-image` is deliberately
one-look-per-call so no single response ever bundles multiple large
base64 images. This was a real production bug (intermittent 413s once real
images started coming back) and the fix was architectural (stop batching),
not just raising a limit further.

**Set `OPENAI_API_KEY` as a Render environment variable** on the service
(Render dashboard → service → Environment) for real AI recommendations,
images, and photo analysis to work in production. Without it, all three
routes return a 502 and the frontend transparently falls back to mock
data — the app still runs, just without real AI output.

**Do not add a `render.yaml`** unless the user asks for one — the dashboard
Docker service + this Dockerfile is the whole deployment story.

If you change the Dockerfile, re-verify by hand against the actual repo
paths (`docker build` may not be available in this dev environment — it
wasn't when this file was written). At minimum: confirm every path the
Dockerfile `COPY`s exists, and that `pnpm --filter @workspace/skintune run
build` and `pnpm --filter @workspace/api-server run build` both still
succeed from repo root.

**pnpm version must stay pinned.** Root `package.json` has
`"packageManager": "pnpm@9.15.9"` — this MUST match the pnpm version that
generated `pnpm-lock.yaml`. The Dockerfile's `corepack enable` reads this
field to resolve which pnpm to install; without it (or if it drifts from the
lockfile's version), a newer pnpm can normalize `pnpm-workspace.yaml`'s
`overrides` block differently and `pnpm install --frozen-lockfile` fails
with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` on Render even though nothing about
the actual dependencies changed (this happened once — see git history around
the fix). If you ever intentionally bump the local pnpm version, update this
field to match in the same commit, and regenerate `pnpm-lock.yaml` if needed.

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
