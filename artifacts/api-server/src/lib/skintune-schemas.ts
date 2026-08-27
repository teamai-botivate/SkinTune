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
  // Optional here: the frontend deliberately omits the raw photo (a
  // multi-megabyte base64 data URL) from AI request bodies — neither route
  // uses it, only the already-derived appearance.skinTone/undertone below.
  photoUrl: z.string().optional(),
  appearance: z.object({
    skinTone: z.string(),
    undertone: z.string(),
    confidence: z.number(),
    contrast: z.string(),
  }),
  bodyBuild: z.string(),
  // Single-select fields (Fitted/Regular/Relaxed/Oversized;
  // Style First/Comfort First/Balance Both) — must stay in sync with
  // artifacts/skintune/src/types.ts's SkinTuneProfile.
  fit: z.string(),
  priorities: z.string(),
  style: z.array(z.string()),
  colorsLove: z.array(z.string()),
  colorsAvoid: z.array(z.string()),
  restrictions: z.array(z.string()),
  occasion: z.string(),
  occasionDetails: z.string(),
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

// ---- /api/generate-images ----

export const GenerateImagesRequestSchema = z.object({
  recommendations: z.array(LookRecommendationSchema),
  profile: SkinTuneProfileSchema,
  context: OccasionContextSchema,
});

export const GenerateImagesResponseSchema = z.object({
  recommendations: z.array(LookRecommendationSchema),
});
