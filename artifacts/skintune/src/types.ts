// Photo-quality diagnostic states. `good` means the photo is usable; every other
// value maps to a specific, explainable problem (see data/photo-diagnostics.ts).
export type PhotoStatus =
  | 'good'
  | 'low-light'
  | 'warm-light'
  | 'blurry'
  | 'angle'
  | 'filter'
  | 'occluded'
  | 'low-confidence';

export type AppearanceProfile = {
  skinTone: string;
  undertone: string;
  confidence: number;
  contrast: string;
};

export type SkinTuneProfile = {
  name: string;
  pronouns: string;
  ageGroup: string;
  height: string;
  photoUrl: string;
  appearance: AppearanceProfile;
  bodyBuild: string;
  /** Single-select: Fitted / Regular / Relaxed / Oversized. */
  fit: string;
  style: string[];
  colorsLove: string[];
  colorsAvoid: string[];
  restrictions: string[];
  occasion: string;
  impression: string[];
  budget: string;
};

/** Alias kept for continuity with a future backend contract. */
export type UserProfile = SkinTuneProfile;

// ---- real-dress-search branch ----
//
// LookPiece, LookRecommendation, LookFeedback, and GenerationResult (the
// AI-generated-look contract with recommendation-engine.ts/
// image-generation.ts) were removed here — this branch replaces that flow
// entirely with real web-sourced dresses. See CLAUDE.md.
//
// Replaces the AI-generated-look flow: instead of GPT-4o inventing an
// outfit description, the backend searches the real web (Tavily) for
// actual purchasable dresses/outfits matching the profile. See
// services/dress-search.ts and artifacts/api-server/src/routes/
// search-dresses.ts.

export type DressResult = {
  id: string;
  title: string;
  imageUrl: string;
  siteName: string;
  /** Where "Interested" sends the user — this photo's own source store domain, not necessarily the exact product page. */
  sourceUrl: string;
};

/** A general shopping link shown alongside the dress grid — a real store's page, not tied to any specific DressResult card. */
export type ShopLink = {
  title: string;
  url: string;
  siteName: string;
  price?: string;
};
