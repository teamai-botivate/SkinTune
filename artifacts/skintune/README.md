# SkinTune

SkinTune is a responsive frontend prototype for personal appearance intelligence. It turns a user's appearance cues, fit preferences, style, colors, restrictions, occasion, desired impression, and budget into five complete styling suggestions.

## Run locally

From the repository root:

```bash
pnpm install
pnpm --filter @workspace/skintune run dev
```

The Replit workflow supplies the app port and base path. For a production build:

```bash
pnpm --filter @workspace/skintune run build
pnpm --filter @workspace/skintune run serve
```

## Project structure

- `src/App.tsx` — the complete screen flow, shared shell, interactive cards, and local state orchestration.
- `src/types.ts` — profile, appearance, context, recommendation, feedback, and generation result types.
- `src/services/mock-ai.ts` — the replaceable image-generation service boundary.
- `src/index.css` — SkinTune's visual system, typography, textures, responsive rules, and motion.
- `src/components/` — scaffolded UI primitives and the error boundary.

## How state works

The prototype keeps the active profile in React state so selections survive back navigation. A completed profile is stored as `skintune-profile` in `localStorage`; saved looks and feedback use separate keys. Returning to the app reopens the personal journal instead of restarting onboarding.

The privacy screen explains this prototype storage model and includes a confirmed data-deletion action that clears the profile, saved looks, and feedback.

## Mock data and image generation

The five starting recommendation objects live in `src/App.tsx`. Each recommendation contains a palette and complete-look details for the outfit, jewellery, hairstyle, makeup, footwear, and accessories. Their image URLs intentionally point to replaceable image slots for this frontend-only version.

`src/services/mock-ai.ts` exposes `generateLookImages(profile, context, recommendations)`. The current implementation simulates generation latency and returns the recommendation strategy unchanged. A future GPT Image 2 adapter should implement this same boundary and return the visual URLs without requiring changes to the UI components.

The recommendation strategy belongs to the app/service layer; an image model should visualize those decisions rather than invent a new styling strategy.

## Continuing the project

To connect a real backend, keep `SkinTuneProfile`, `LookRecommendation`, `LookFeedback`, and `GenerationResult` as the client-facing contracts, then replace the localStorage adapter and `mock-ai.ts` implementation behind the existing UI. Keep consent and deletion behavior explicit before sending any photo beyond the browser. The app deliberately avoids wardrobe digitisation, wardrobe upload, real-time try-on, medical claims, and beauty scoring.