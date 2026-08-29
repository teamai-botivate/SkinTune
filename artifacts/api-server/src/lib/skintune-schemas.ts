// Server-side mirror of the SkinTune frontend's data contracts
// (artifacts/skintune/src/types.ts). Kept local to api-server rather than a
// shared lib package so the two AI routes can move independently of the
// codegen pipeline — if these routes graduate into the OpenAPI spec later,
// promote these into lib/api-zod instead of duplicating by hand.
import { z } from "zod";

export const SkinTuneProfileSchema = z.object({
  name: z.string(),
  pronouns: z.string(),
  ageGroup: z.string(),
  height: z.string(),
  // Optional here: /api/recommendations never needs the raw photo (only
  // the already-derived appearance.skinTone/undertone below), so the
  // frontend omits it from that call. /api/generate-image DOES need it —
  // see GenerateImageRequestSchema.photoUrl below, sent as a separate
  // top-level field on that request rather than nested in profile.
  photoUrl: z.string().optional(),
  appearance: z.object({
    skinTone: z.string(),
    undertone: z.string(),
    confidence: z.number(),
    contrast: z.string(),
  }),
  bodyBuild: z.string(),
  // Single-select field (Fitted/Regular/Relaxed/Oversized) — must stay in
  // sync with artifacts/skintune/src/types.ts's SkinTuneProfile.
  fit: z.string(),
  style: z.array(z.string()),
  colorsLove: z.array(z.string()),
  colorsAvoid: z.array(z.string()),
  restrictions: z.array(z.string()),
  occasion: z.string(),
  impression: z.array(z.string()),
  budget: z.string(),
});
export type SkinTuneProfile = z.infer<typeof SkinTuneProfileSchema>;

export const LookPieceSchema = z.object({
  category: z.string(),
  name: z.string(),
  detail: z.string(),
});

export const LookRecommendationSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string(),
  category: z.string().optional(),
  palette: z.array(z.string()),
  pieces: z.array(LookPieceSchema),
  outfit: z.string(),
  outfitColor: z.string(),
  jewellery: z.string(),
  hairstyle: z.string(),
  makeup: z.string(),
  accessories: z.string(),
  footwear: z.string(),
  reasoning: z.array(z.string()),
  confidence: z.number(),
  imageUrl: z.string(),
});
export type LookRecommendation = z.infer<typeof LookRecommendationSchema>;

export const OccasionContextSchema = z.object({
  occasion: z.string(),
  details: z.string(),
});

// ---- /api/recommendations ----

export const RecommendationsRequestSchema = z.object({
  profile: SkinTuneProfileSchema,
});

export const RecommendationsResponseSchema = z.object({
  recommendations: z.array(LookRecommendationSchema).length(5),
});

// ---- /api/generate-image (one look per call) ----
//
// Deliberately singular/per-look rather than batching all 5 looks into one
// request/response: a single generated image (base64, even compressed) can
// run into the low single-digit MB, so 5 of them in one JSON payload risks
// tripping body-size limits anywhere in the chain (this server, a hosting
// platform's reverse proxy, etc.) in a way that's hard to predict or fully
// control. One-look-per-call keeps every request and response small and
// bounded regardless of image size, and lets the frontend show each look's
// image as soon as it's ready instead of waiting on the slowest of five.

export const GenerateImageRequestSchema = z.object({
  look: LookRecommendationSchema,
  profile: SkinTuneProfileSchema,
  context: OccasionContextSchema,
  // The user's own uploaded photo, sent so the generated look edits their
  // actual photo (images.edit) rather than generating a stranger from a
  // text prompt. This is the one AI request that legitimately needs it —
  // see the note on SkinTuneProfileSchema.photoUrl. Optional: if the user
  // skipped the photo step, the route falls back to text-to-image
  // generation instead of an edit.
  photoUrl: z.string().optional(),
});

export const GenerateImageResponseSchema = z.object({
  look: LookRecommendationSchema,
});

// ---- /api/refine-image (per-look retry with a user customization note) ----
//
// Takes the look that was already generated (with its real imageUrl) plus
// the user's original uploaded photo, and re-edits using BOTH as reference
// images alongside a free-text correction from the user (e.g. "make the
// sleeves longer", "different shoe colour") — a refinement of the existing
// result, not a fresh generation from scratch. Same one-look-per-call
// reasoning as /api/generate-image applies here.

export const RefineImageRequestSchema = z.object({
  look: LookRecommendationSchema, // look.imageUrl here is the ALREADY-GENERATED image to refine
  profile: SkinTuneProfileSchema,
  context: OccasionContextSchema,
  photoUrl: z.string().optional(), // the user's original uploaded photo, for identity reference
  customization: z.string().min(1).max(500),
});

export const RefineImageResponseSchema = z.object({
  look: LookRecommendationSchema,
});

// ---- /api/analyze-photo ----

export const AnalyzePhotoRequestSchema = z.object({
  // Base64 data URL of the uploaded photo. This route is the one place
  // that legitimately needs it — everywhere else it's stripped from
  // requests (see recommendation-engine.ts / image-generation.ts).
  photoUrl: z.string().min(1),
});

export const PhotoAnalysisStatusSchema = z.enum([
  "good",
  "low-light",
  "warm-light",
  "blurry",
  "angle",
  "filter",
  "occluded",
  "low-confidence",
]);

export const AnalyzePhotoResponseSchema = z.object({
  status: PhotoAnalysisStatusSchema,
  skinTone: z.string(),
  undertone: z.string(),
  confidence: z.number().min(0).max(100),
  contrast: z.string(),
});
export type AnalyzePhotoResponse = z.infer<typeof AnalyzePhotoResponseSchema>;
