// Image Generation Service
// -------------------------
// Architecture:
//
//   Recommendation Engine  →  5 LookRecommendation objects  →  Image Generation Service  →  5 images
//
// This module is the ONLY place that should know about a specific image provider
// (e.g. GPT Image 2). It converts each LookRecommendation's structured styling
// data into a prompt and returns image URLs. It never decides the styling
// strategy itself — that's the recommendation engine's job (see
// services/recommendation-engine.ts). UI components must not import a provider
// SDK directly; they call generateLookImages() and stay unaware of how images
// are produced.
//
// To connect a real provider later: implement buildPrompt() + the provider call
// inside generateLookImages() (or swap the whole function body), keeping the
// same input/output signature. No UI changes should be required.

import type { LookRecommendation, SkinTuneProfile } from '../types';

export type OccasionContext = {
  occasion: string;
  details: string;
};

/**
 * Converts one recommendation's structured styling data into an image prompt.
 * Kept separate so a future provider adapter can reuse/tune this without
 * touching UI or recommendation logic.
 */
export const buildLookImagePrompt = (
  look: LookRecommendation,
  profile: SkinTuneProfile,
  context: OccasionContext,
): string => {
  const parts = [
    `Editorial fashion photograph, style visualisation, full-length, ${context.occasion || 'everyday'} setting.`,
    `Outfit: ${look.outfit}`,
    `Colour direction: ${look.outfitColor}`,
    `Jewellery: ${look.jewellery}`,
    `Hairstyle: ${look.hairstyle}`,
    `Makeup: ${look.makeup}`,
    `Footwear: ${look.footwear}`,
    `Accessories: ${look.accessories}`,
    profile.appearance.skinTone ? `Skin tone: ${profile.appearance.skinTone}, ${profile.appearance.undertone} undertone.` : '',
    profile.bodyBuild ? `Build: ${profile.bodyBuild}.` : '',
    context.details ? `Context: ${context.details}` : '',
    'Natural lighting, tasteful and supportive, no beauty filter.',
  ];
  return parts.filter(Boolean).join(' ');
};

/**
 * Generate visuals for a set of recommendations. Mock implementation: simulates
 * provider latency and returns the recommendations unchanged (their existing
 * imageUrl placeholders stay as "ready to replace" slots). A real GPT Image 2
 * adapter would call the provider with buildLookImagePrompt(...) per look and
 * return each look with a real imageUrl.
 */
export const generateLookImages = async (
  recommendations: LookRecommendation[],
  profile: SkinTuneProfile,
  context: OccasionContext,
): Promise<LookRecommendation[]> => {
  await new Promise((resolve) => setTimeout(resolve, 2200));
  // Mock: no real provider call. Prompts are still built so the boundary is
  // exercised end-to-end and easy to inspect/log during development.
  recommendations.forEach((look) => buildLookImagePrompt(look, profile, context));
  return recommendations;
};
