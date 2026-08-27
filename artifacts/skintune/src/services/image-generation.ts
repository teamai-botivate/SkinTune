// Image Generation Service
// -------------------------
// Architecture:
//
//   Recommendation Engine  →  5 LookRecommendation objects  →  Image Generation Service  →  5 images
//
// This module is the ONLY place in the frontend that talks about images. It
// sends each LookRecommendation's structured styling data to the backend
// (/api/generate-images, which calls OpenAI's gpt-image-2), and returns each
// look with a real imageUrl. It never decides the styling strategy itself —
// that's the recommendation engine's job (see services/recommendation-engine.ts).
// UI components must not import a provider SDK directly; they call
// generateLookImages() and stay unaware of how images are produced.
//
// The actual provider call (and the OpenAI API key) lives server-side in
// artifacts/api-server/src/routes/generate-images.ts — never in this file —
// so the key is never exposed to the browser.

import type { LookRecommendation, SkinTuneProfile } from '../types';

export type OccasionContext = {
  occasion: string;
  details: string;
};

/**
 * Generate visuals for a set of recommendations by calling the backend's
 * /api/generate-images route. Falls back to returning the recommendations
 * unchanged (their existing placeholder imageUrls) if the call fails for any
 * reason — no OPENAI_API_KEY configured, network issue, provider error, etc.
 * — so the results screen always renders something rather than getting
 * stuck.
 */
export const generateLookImages = async (
  recommendations: LookRecommendation[],
  profile: SkinTuneProfile,
  context: OccasionContext,
): Promise<LookRecommendation[]> => {
  try {
    // Same as recommendation-engine.ts: buildLookImagePrompt (server-side)
    // never reads the raw photo, only appearance.skinTone/undertone — strip
    // it before sending so this request stays well under any body-size
    // limit regardless of photo resolution.
    const { photoUrl: _photoUrl, ...profileForRequest } = profile;
    const res = await fetch('/api/generate-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recommendations, profile: profileForRequest, context }),
    });
    if (!res.ok) throw new Error(`Image generation request failed: ${res.status}`);
    const data = (await res.json()) as { recommendations: LookRecommendation[] };
    if (!data.recommendations?.length) throw new Error('Empty image generation response');
    return data.recommendations;
  } catch (err) {
    console.warn('Falling back to placeholder look visuals:', err);
    // Keep a brief delay so the "generating" screen still feels intentional
    // rather than flashing past instantly on failure.
    await new Promise((resolve) => setTimeout(resolve, 800));
    return recommendations;
  }
};
