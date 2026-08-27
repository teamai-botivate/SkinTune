// Image Generation Service
// -------------------------
// Architecture:
//
//   Recommendation Engine  →  5 LookRecommendation objects  →  Image Generation Service  →  5 images
//
// This module is the ONLY place in the frontend that talks about images. It
// sends each LookRecommendation's structured styling data to the backend
// (/api/generate-image, which calls OpenAI's gpt-image-2), and returns each
// look with a real imageUrl. It never decides the styling strategy itself —
// that's the recommendation engine's job (see services/recommendation-engine.ts).
// UI components must not import a provider SDK directly; they call
// generateLookImages() and stay unaware of how images are produced.
//
// The actual provider call (and the OpenAI API key) lives server-side in
// artifacts/api-server/src/routes/generate-image.ts — never in this file —
// so the key is never exposed to the browser.
//
// One request per look, not one batch request for all 5: a single generated
// image (even compressed) can run into a few MB, so bundling 5 into one
// JSON response risks tripping body-size limits somewhere in the deployment
// chain (this was a real production bug — see CLAUDE.md). Per-look requests
// keep each request/response small and let the UI show each image as soon
// as it's ready instead of waiting on the slowest of five.

import type { LookRecommendation, SkinTuneProfile } from '../types';

export type OccasionContext = {
  occasion: string;
  details: string;
};

const generateOneLookImage = async (
  look: LookRecommendation,
  profileForRequest: Omit<SkinTuneProfile, 'photoUrl'>,
  context: OccasionContext,
): Promise<LookRecommendation> => {
  try {
    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ look, profile: profileForRequest, context }),
    });
    if (!res.ok) throw new Error(`Image generation request failed: ${res.status}`);
    const data = (await res.json()) as { look: LookRecommendation };
    if (!data.look) throw new Error('Empty image generation response');
    return data.look;
  } catch (err) {
    console.warn(`Falling back to placeholder visual for ${look.id}:`, err);
    return look;
  }
};

/**
 * Generate visuals for a set of recommendations. Fires one request per look
 * (in parallel) rather than a single batched request. Each look falls back
 * independently to its existing placeholder imageUrl if its own request
 * fails, so one failure never blocks the other four.
 */
export const generateLookImages = async (
  recommendations: LookRecommendation[],
  profile: SkinTuneProfile,
  context: OccasionContext,
): Promise<LookRecommendation[]> => {
  // Same as recommendation-engine.ts: the image prompt only ever uses the
  // already-derived appearance.skinTone/undertone, never the raw photo.
  const { photoUrl: _photoUrl, ...profileForRequest } = profile;
  return Promise.all(
    recommendations.map((look) => generateOneLookImage(look, profileForRequest, context)),
  );
};
