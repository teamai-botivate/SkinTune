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
  // A single distinct mood word for this look (e.g. "Radiant", "Grounded",
  // "Playful") — used downstream by the image-generation pose agent (see
  // artifacts/api-server/src/routes/generate-image.ts) to pick a genuinely
  // different pose/expression per look. Optional so older cached looks
  // (before this field existed) still validate.
  vibe: z.string().optional(),
  // 1-2 vivid sentences describing how this person would actually move,
  // stand, and feel in this specific look — concrete photographer-facing
  // direction, not just a mood label. Also feeds the pose agent.
  personaEnergy: z.string().optional(),
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
  // The OTHER 4 looks' vibe words in this same batch (see
  // LookRecommendationSchema.vibe), sent so the per-look styling-addendum
  // agent (writeStylingAddendum in generate-image.ts) can actively steer
  // away from expressions/poses it's already "used" elsewhere in this
  // batch, instead of each of the 5 parallel per-look requests
  // independently converging on the same generic "confident portrait"
  // answer with no visibility into its siblings. Optional/best-effort —
  // omitted entirely for older frontend builds or if a caller doesn't have
  // the full batch (e.g. a future single-look regeneration).
  siblingVibes: z.array(z.string()).optional(),
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

// ---- /api/search-dresses (real-dress-search branch) ----
//
// Replaces the AI-generated-look recommendation step on this branch: instead
// of GPT-4o inventing an outfit description, this route searches the real
// web (via Tavily, see lib/tavily-client.ts) for actual purchasable dresses/
// outfits matching the user's profile, and returns real product photos with
// a price (when found), the store name, and a link to buy. See
// routes/search-dresses.ts for how results are built and paginated.

export const DressResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  imageUrl: z.string(),
  siteName: z.string(),
  // Where "Interested" sends the user — the store domain this photo's own
  // image came from (normalized from its CDN hostname, e.g.
  // i.etsystatic.com -> etsy.com), not necessarily the exact product page.
  // See routes/search-dresses.ts's doc comment on why an exact per-image
  // product page link isn't reliably available from this data source.
  sourceUrl: z.string(),
});
export type DressResult = z.infer<typeof DressResultSchema>;

// A general shopping link surfaced alongside the dress photo grid — a real
// store's search/category page (not tied to any one specific dress card),
// with a price when Tavily's page snippet happened to contain one.
export const ShopLinkSchema = z.object({
  title: z.string(),
  url: z.string(),
  siteName: z.string(),
  price: z.string().optional(),
});
export type ShopLink = z.infer<typeof ShopLinkSchema>;

export const SearchDressesRequestSchema = z.object({
  profile: SkinTuneProfileSchema,
  // Pagination for the "More" button — offset into the ranked result set,
  // not a raw API page number, since Tavily itself doesn't paginate a
  // single query; each "page" here is a fresh, slightly broadened search.
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(20).default(10),
});

export const SearchDressesResponseSchema = z.object({
  results: z.array(DressResultSchema),
  shopLinks: z.array(ShopLinkSchema),
  hasMore: z.boolean(),
});

// ---- /api/try-on (real-dress-search branch) ----
//
// Takes ONE real dress the user picked from /api/search-dresses plus their
// own uploaded photo, and edits their photo to show them wearing that exact
// dress — same gpt-image-2 edit machinery as generate-image.ts (Responses
// API primary, images.edit fallback), just with the dress's real product
// photo as a second reference image instead of a text description alone.

export const TryOnRequestSchema = z.object({
  dress: DressResultSchema,
  profile: SkinTuneProfileSchema,
  // Historically the user's raw selfie. On this branch it should now be the
  // user's ACTIVE AVATAR image (see /api/avatar/create below) instead — the
  // avatar is itself already an identity-preserving full-length photo, so
  // reusing it here means try-on never needs to re-derive identity/build
  // framing from a raw close-up selfie for every single dress. The field
  // name/shape is unchanged (still just a data: URL) so this is a pure
  // caller-side swap, not a schema change — see CLAUDE.md for the full
  // avatar-reuse rationale.
  photoUrl: z.string().min(1), // required here — there is no "no photo" fallback for a real try-on
});

export const TryOnResponseSchema = z.object({
  imageUrl: z.string(),
});

// ---- /api/avatar (avatar creation/versioning — real-dress-avatar-intelligent-tryon branch) ----
//
// See CLAUDE.md for full rationale. No auth/accounts exist in this codebase
// (confirmed by inspection before this branch was started, and per explicit
// product direction: "no auth now") — so "the user" here is scoped to
// whatever device/browser is calling this API, the same implicit scoping
// every other route on this branch already uses via localStorage. There is
// no user_id anywhere in these schemas; if real accounts are added later,
// that's a genuinely separate project (auth + a real database), not a
// small addition to this one.

export const AvatarCreateRequestSchema = z.object({
  // The user's raw uploaded selfie (base64 data URL) — the one-time input
  // this whole avatar exists to avoid needing again for every dress.
  photoUrl: z.string().min(1),
  profile: SkinTuneProfileSchema,
});

export const AvatarSchema = z.object({
  id: z.string(),
  imageUrl: z.string(), // the generated avatar photo (base64 data URL)
  createdAt: z.string(), // ISO timestamp
  active: z.boolean(),
});
export type Avatar = z.infer<typeof AvatarSchema>;

export const AvatarCreateResponseSchema = z.object({
  avatar: AvatarSchema,
});

// ---- /api/products/feedback (Interested / Not Interested) ----

export const ProductFeedbackTypeSchema = z.enum(["INTERESTED", "NOT_INTERESTED"]);

export const ProductFeedbackRequestSchema = z.object({
  dress: DressResultSchema,
  feedbackType: ProductFeedbackTypeSchema,
  // Optional quick rejection reason (see CLAUDE.md's "OPTIONAL REJECTION
  // REASON" section of the product spec) — never required, a NOT_INTERESTED
  // click is recorded even with no reason given.
  reason: z.string().optional(),
  sessionId: z.string().optional(),
});

// ---- /api/search-dresses/research and /refine (session-aware re-search) ----
//
// Both extend the base SearchDressesRequestSchema with the session-memory
// fields described in this branch's product spec: what's already been
// shown/rejected/liked, and (for refine) a free-text steering instruction.
// Deliberately NOT sent as a giant history blob — see buildSearchQuery in
// search-dresses.ts for how this gets folded into one query, not replayed
// verbatim to the model.

export const SessionMemorySchema = z.object({
  // Titles/domains of dresses already shown this session — used to steer
  // away from repeats, not sent as full DressResult objects (keeps the
  // request small; a title/domain pair is enough of a fingerprint for the
  // "don't just repeat page one" instruction this feeds into).
  seenTitles: z.array(z.string()).default([]),
  // Titles of dresses the user explicitly rejected, WITH the optional
  // reason if one was given — this is the actual negative-preference
  // signal, kept separate from seenTitles because a merely-unseen-again
  // product isn't the same signal as an actively-disliked one.
  rejected: z.array(z.object({ title: z.string(), reason: z.string().optional() })).default([]),
  // Titles the user explicitly liked — a soft positive signal, used the
  // same way (steer toward more like these), never a hard requirement.
  interested: z.array(z.string()).default([]),
});
export type SessionMemory = z.infer<typeof SessionMemorySchema>;

export const ResearchAgainRequestSchema = z.object({
  profile: SkinTuneProfileSchema,
  limit: z.number().int().min(1).max(20).default(10),
  memory: SessionMemorySchema,
});

export const RefineSearchRequestSchema = z.object({
  profile: SkinTuneProfileSchema,
  limit: z.number().int().min(1).max(20).default(10),
  memory: SessionMemorySchema,
  // Free-text steering instruction, e.g. "show me more elegant options",
  // "now find something in dark green", "less expensive" — see this
  // branch's product spec's "SEARCH REFINEMENT" section. Temporary for
  // this session only; never written back into `profile`.
  refinement: z.string().min(1).max(300),
});
