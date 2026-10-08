# SkinTune

SkinTune is a responsive frontend prototype for personal appearance intelligence. It turns a user's appearance cues, fit preferences, style, colors, restrictions, occasion, desired impression, and budget into real, purchasable dresses/outfits found from the web, then shows the user wearing whichever one they pick.

**This branch (`real-dress-search`) replaces the AI-generated-look flow** (a prior version of this app had GPT-4o invent 5 outfit descriptions, then visualize them) **with real web search**: the backend searches the web (Tavily) for actual dresses matching the profile, the user picks one to try on, and `gpt-image-2` edits their own photo to show them wearing that exact real garment. See "Real dress search and try-on" below.

## Run locally

From the repository root:

```bash
pnpm install
pnpm --filter @workspace/skintune run dev
```

Vite needs `PORT` and `BASE_PATH` env vars to start (it throws a clear error otherwise — inherited from the managed Replit workflow). For a plain local run:

```bash
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/skintune run dev
```

For a production build:

```bash
pnpm --filter @workspace/skintune run build
pnpm --filter @workspace/skintune run serve
```

## Project structure

- `src/App.tsx` — the complete screen flow, shared shell, generic wizard step components (`SingleChoiceStep`, `MultiChoiceStep`, `HeightStep`), the dress grid/try-on screens, and local state orchestration.
- `src/types.ts` — profile, appearance, dress result, and shop-link types (the client-facing contracts).
- `src/data/options.ts` — every selection option list (pronouns, body build, fit, style, colours, occasion, impression, budget, etc.) in one place, so wizard screens stay data-driven instead of duplicating labels inline.
- `src/data/photo-diagnostics.ts` — the photo-quality problem/why-it-matters/how-to-improve copy for each `PhotoStatus`, plus the staged "Analyzing…" copy.
- `src/services/dress-search.ts` — the real-dress-search and try-on boundary: given a `SkinTuneProfile`, searches the web for real dresses and generates a try-on image for a selected one.
- `src/index.css` — SkinTune's visual system, typography, textures, responsive rules, and motion.
- `src/components/` — scaffolded UI primitives and the error boundary.

## How state works

The prototype keeps the active profile in React state so selections survive back navigation. A completed profile is stored as `skintune-profile` in `localStorage`; saved dresses use a separate key (`skintune-saved-looks`, kept for continuity — each entry now holds a `DressResult` plus its generated try-on image). Returning to the app reopens the personal journal instead of restarting onboarding.

The privacy screen ("Privacy, plainly") explains this prototype storage model and includes a confirmed data-deletion action that clears the profile and saved dresses.

## Interaction model

Single-choice wizard screens (pronouns, age, body build, fit, priority, occasion, budget) auto-advance to the next screen a moment after you tap an option — no separate "Continue" tap needed, matching a WhatsApp-style tap → next flow. Multi-choice screens (style, colours, restrictions, impression) still require a Continue tap since you can pick more than one option. The footer Continue/Back bar is always present as a fallback (keyboard and assistive-tech navigation).

## Real dress search and try-on (`real-dress-search` branch)

```
Dress Search (Tavily web search)  →  10 real DressResult cards + shop links  →  user picks one  →  Try-On (gpt-image-2)  →  1 image
```

`src/services/dress-search.ts` exposes two functions:

- `searchDresses(profile, offset, limit)` calls the backend's `POST /api/search-dresses`, which searches the real web (Tavily) for dresses/outfits genuinely matching the profile's gender, style, colours, occasion, and budget — nothing hardcoded or templated, every query clause is conditional on what the user actually answered. It returns real product photos (`DressResult[]`, each with a title, image, store name, and a link to that store) plus a separate `shopLinks[]` list of general real-store pages (with price when found) not tied to any one photo — see `artifacts/api-server/src/routes/search-dresses.ts`'s doc comments for why these are two separate lists rather than one paired structure (Tavily's image results and page results come from largely different sites). `offset`/`limit` drive the "More dresses" button, which runs a fresh, slightly broadened search rather than paginating a cached list.
- `tryOnDress(dress, profile)` calls the backend's `POST /api/try-on`, which edits the user's own uploaded photo (via `gpt-image-2`, same Responses-API-primary/`images.edit`-fallback pattern used elsewhere in this app) using the picked dress's real product photo as a second reference image, so the result shows the same person wearing that exact real garment. A GPT-4o vision agent (`writeTryOnAddendum` in `try-on.ts`) looks at both photos together and decides pose/expression/setting/fit fresh each time — nothing about pose, expression, or environment is a fixed template; see that file's doc comments and the root `CLAUDE.md` for the "nothing hardcoded" principle this whole feature follows.

Picking a dress and disliking the try-on costs nothing — "Not this one — try another" goes straight back to the grid; "Interested" opens that dress's own store link.

`src/services/photo-analysis.ts` exposes `analyzePhoto(photoUrl)`. It calls the backend's `POST /api/analyze-photo` (GPT-4o vision) to judge photo quality and estimate skin tone/undertone/contrast/confidence from the actual uploaded photo — unchanged by this branch.

**This separation is intentional and should be preserved:** UI components import only `dress-search.ts`'s functions — never Tavily or OpenAI SDKs directly, and never an API key (both keys live only in `artifacts/api-server`).

### The AI and search are already connected

`artifacts/api-server/src/routes/search-dresses.ts` and `.../try-on.ts` hold the Tavily and OpenAI calls for this branch's flow (`.../analyze-photo.ts` is unchanged; `.../recommendations.ts`, `.../generate-image.ts`, and `.../refine-image.ts` are the prior AI-generated-look routes, left in place but unreachable from this branch's frontend). Set `TAVILY_API_KEY` and `OPENAI_API_KEY` (see `artifacts/api-server/.env.example`) to enable them — locally, or as Render environment variables in production. `OPENAI_TEXT_MODEL` (default `gpt-5.5` — see CLAUDE.md for why `gpt-4o` specifically hits an organization-verification 403 via the Responses API's image_generation tool on some accounts, confirmed live, while `gpt-5.5` doesn't) and `OPENAI_IMAGE_MODEL` (default `gpt-image-2`) are overridable if you want to point at different models later.

## Continuing the project

To connect a real backend, keep `SkinTuneProfile`, `DressResult`, and `ShopLink` (in `src/types.ts`) as the client-facing contracts, then replace the localStorage adapter and `dress-search.ts`'s implementation behind the existing UI. Keep consent and deletion behavior explicit before sending any photo beyond the browser. The app deliberately avoids wardrobe digitisation and beauty scoring, and makes no medical or diagnostic claims — real-time try-on is now this branch's core feature, a deliberate departure from an earlier, more conservative product direction (see root `CLAUDE.md`).

## Deployment

See the repository-root `CLAUDE.md` and `Dockerfile` — SkinTune is deployed as part of a single Render Docker web service, with `artifacts/api-server`'s Express app serving this app's production build as static files alongside its `/api/*` routes.
