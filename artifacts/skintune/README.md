# SkinTune

SkinTune is a responsive frontend prototype for personal appearance intelligence. It turns a user's appearance cues, fit preferences, style, colors, restrictions, occasion, desired impression, and budget into five complete styling suggestions.

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

- `src/App.tsx` — the complete screen flow, shared shell, generic wizard step components (`SingleChoiceStep`, `MultiChoiceStep`, `HeightStep`), and local state orchestration.
- `src/types.ts` — profile, appearance, recommendation, feedback, and generation result types (the client-facing contracts).
- `src/data/options.ts` — every selection option list (pronouns, body build, fit, style, colours, occasion, impression, budget, feedback chips, etc.) in one place, so wizard screens stay data-driven instead of duplicating labels inline.
- `src/data/photo-diagnostics.ts` — the photo-quality problem/why-it-matters/how-to-improve copy for each `PhotoStatus`, plus the staged "Analyzing…" copy.
- `src/services/recommendation-engine.ts` — the recommendation strategy boundary: given a `SkinTuneProfile`, returns 5 `LookRecommendation` objects.
- `src/services/image-generation.ts` — the replaceable image-generation boundary: takes recommendations + profile + occasion context and returns them with visuals.
- `src/index.css` — SkinTune's visual system, typography, textures, responsive rules, and motion.
- `src/components/` — scaffolded UI primitives and the error boundary.

## How state works

The prototype keeps the active profile in React state so selections survive back navigation. A completed profile is stored as `skintune-profile` in `localStorage`; saved looks and feedback use separate keys. Returning to the app reopens the personal journal instead of restarting onboarding.

The privacy screen ("Privacy, plainly") explains this prototype storage model and includes a confirmed data-deletion action that clears the profile, saved looks, and feedback.

## Interaction model

Single-choice wizard screens (pronouns, age, body build, fit, priority, occasion, budget) auto-advance to the next screen a moment after you tap an option — no separate "Continue" tap needed, matching a WhatsApp-style tap → next flow. Multi-choice screens (style, colours, restrictions, impression) still require a Continue tap since you can pick more than one option. The footer Continue/Back bar is always present as a fallback (keyboard and assistive-tech navigation).

## Recommendation engine and image generation — two separate boundaries

```
Recommendation Engine  →  5 LookRecommendation objects  →  Image Generation Service  →  5 images
```

`src/services/recommendation-engine.ts` exposes `getLookRecommendations(profile)`. It owns the *styling decision* — outfit, colour, jewellery, hairstyle, makeup, accessories, and the reasoning behind each look. The current implementation returns a curated static set of five looks with full complete-look detail.

`src/services/image-generation.ts` exposes `generateLookImages(recommendations, profile, context)`. It owns *visualising* those decisions — nothing more. The current implementation simulates provider latency and returns the recommendations with their placeholder `imageUrl`s unchanged; `buildLookImagePrompt()` shows how a look's structured data becomes an image prompt.

**This separation is intentional and should be preserved:** an image model should visualize a styling decision, never invent its own. UI components import only these two functions — never a provider SDK directly.

### Connecting a real image provider (e.g. GPT Image 2) later

Implement the provider call inside `generateLookImages()` in `src/services/image-generation.ts`, keeping the same function signature (`(recommendations, profile, context) => Promise<LookRecommendation[]>`) and having it return each look with a real `imageUrl`. `buildLookImagePrompt()` is the natural place to tune the prompt template. No UI or recommendation-engine changes should be required.

## Continuing the project

To connect a real backend, keep `SkinTuneProfile`, `LookRecommendation`, `LookFeedback`, and `GenerationResult` (in `src/types.ts`) as the client-facing contracts, then replace the localStorage adapter and the two service implementations behind the existing UI. Keep consent and deletion behavior explicit before sending any photo beyond the browser. The app deliberately avoids wardrobe digitisation, wardrobe upload, real-time try-on, medical claims, and beauty scoring.

## Deployment

See the repository-root `CLAUDE.md` and `Dockerfile` — SkinTune is deployed as part of a single Render Docker web service, with `artifacts/api-server`'s Express app serving this app's production build as static files alongside its `/api/*` routes.
