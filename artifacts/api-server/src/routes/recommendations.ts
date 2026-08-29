import { Router, type IRouter } from "express";
import {
  RecommendationsRequestSchema,
  RecommendationsResponseSchema,
  LookRecommendationSchema,
  type LookRecommendation,
  type SkinTuneProfile,
} from "../lib/skintune-schemas";
import { getOpenAIClient, RECOMMENDATION_MODEL } from "../lib/openai-client";
import { logger } from "../lib/logger";
import { z } from "zod";

const router: IRouter = Router();

const SYSTEM_PROMPT = `You are SkinTune's styling engine. Given a user's appearance, body, taste, and occasion profile, propose exactly 5 distinct complete-look recommendations.

Guidelines:
- Each look must be a genuinely complete outfit: outfit, colour direction, jewellery, hairstyle, makeup, footwear, and accessories.
- Vary the 5 looks meaningfully — not just different outfit details, but a genuinely different PERSONALITY AND ENERGY per look, because a downstream photo-generation step uses your "vibe" and "personaEnergy" fields to decide how the person should be posed and photographed for each look, and near-duplicate energy across looks produces near-duplicate photos. The 5 "vibe" values must be 5 DIFFERENT single words, no repeats, chosen freely to fit this person and occasion (do not just reuse "Elegant"/"Modern"/"Minimal"/"Bold"/"Glamorous" every time — pick whatever 5 distinct words genuinely fit, e.g. "Radiant", "Grounded", "Playful", "Regal", "Effortless", "Daring", "Serene", "Magnetic" — vary them per request). "personaEnergy" must be 1-2 vivid sentences describing how this person would actually move, stand, and feel in this specific look — concrete enough that a photographer could act on it (e.g. "Warm and unhurried — the kind of confidence that doesn't need to perform, a soft knowing smile" vs. "Sharp and electric — chin up, a look that says she owns the room the second she walks in"). Make these 5 personaEnergy descriptions clearly distinguishable from each other; do not let two looks read as the same energy in different words.
- One look should be the closest overall match to their stated preferences; the other 4 should meaningfully diverge from it and from each other in vibe/energy, not just in colour or garment type.
- Respect the user's stated colour preferences and restrictions; never contradict a stated dislike.
- The user was NOT asked to separately state a style-vs-comfort priority or occasion notes beyond a single occasion word — infer a sensible balance of style and comfort yourself from their style-world choices, desired impression, and occasion (e.g. glamorous/luxury style choices or a formal occasion lean toward style-first; casual/minimal choices or an everyday occasion lean toward comfort-first), and infer reasonable context for the occasion from the occasion word alone (e.g. "Wedding" implies a celebratory, semi-formal to formal setting) without needing it spelled out.
- reasoning must be 3-5 short, concrete, supportive bullet points explaining why THIS look suits THIS person's profile (appearance, body/fit, occasion, impression). Never use words like "flaws", "hide your body", "make you fairer", "dull", "unsuitable body", or "imperfections" — this product is about confidence and expression, never judgement or diagnosis.
- confidence is an integer 0-100 reflecting how well the look matches the stated profile.
- palette is an array of 3 hex color strings representing the look's dominant colours.
- pieces is an array of 3-5 {category, name, detail} objects breaking the outfit into its key items.
- Output must be valid JSON matching the provided schema exactly, with an "id" like "look-01".."look-05".`;

function buildUserPrompt(profile: SkinTuneProfile): string {
  return `User profile:
- Styling for: ${profile.pronouns || "not specified"}, age group ${profile.ageGroup || "not specified"}, height ${profile.height || "not specified"}
- Appearance: skin tone ${profile.appearance.skinTone || "unspecified"}, ${profile.appearance.undertone || "unspecified"} undertone, contrast ${profile.appearance.contrast || "unspecified"}
- Body build: ${profile.bodyBuild || "not specified"}
- Fit preference: ${profile.fit || "no strong preference"}
- Style worlds: ${profile.style.join(", ") || "open to suggestion"}
- Colours loved: ${profile.colorsLove.join(", ") || "no strong favourites stated"}
- Colours to avoid: ${profile.colorsAvoid.join(", ") || "none stated"}
- Restrictions: ${profile.restrictions.join(", ") || "none stated"}
- Occasion: ${profile.occasion || "not specified"}
- Desired impression: ${profile.impression.join(", ") || "not specified"}
- Budget: ${profile.budget || "not specified"}

Return exactly 5 complete-look recommendations as JSON.`;
}

const ModelOutputSchema = z.object({
  recommendations: z.array(LookRecommendationSchema.omit({ imageUrl: true })).length(5),
});

// Hand-written JSON Schema mirror of ModelOutputSchema for OpenAI's strict
// structured-output mode. Keeping this in lockstep with skintune-schemas.ts
// is a deliberate trade-off: it lets the response_format guarantee the
// shape (no free-form JSON drift) without adding a schema-conversion
// dependency. If LookRecommendationSchema changes, update this too.
const LOOK_PIECE_JSON_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string" },
    name: { type: "string" },
    detail: { type: "string" },
  },
  required: ["category", "name", "detail"],
  additionalProperties: false,
} as const;

const LOOK_JSON_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    note: { type: "string" },
    category: { type: "string" },
    // See skintune-schemas.ts's LookRecommendationSchema doc comments —
    // these two feed the downstream image-generation pose agent so each of
    // the 5 looks gets a genuinely different pose/expression, not just a
    // different outfit on the same expression.
    vibe: { type: "string" },
    personaEnergy: { type: "string" },
    palette: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
    pieces: { type: "array", items: LOOK_PIECE_JSON_SCHEMA, minItems: 3, maxItems: 5 },
    outfit: { type: "string" },
    outfitColor: { type: "string" },
    jewellery: { type: "string" },
    hairstyle: { type: "string" },
    makeup: { type: "string" },
    accessories: { type: "string" },
    footwear: { type: "string" },
    reasoning: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
    confidence: { type: "integer" },
  },
  required: [
    "id", "title", "note", "category", "vibe", "personaEnergy", "palette", "pieces", "outfit",
    "outfitColor", "jewellery", "hairstyle", "makeup", "accessories", "footwear", "reasoning", "confidence",
  ],
  additionalProperties: false,
} as const;

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    recommendations: { type: "array", items: LOOK_JSON_SCHEMA, minItems: 5, maxItems: 5 },
  },
  required: ["recommendations"],
  additionalProperties: false,
} as const;

router.post("/recommendations", async (req, res) => {
  const parsed = RecommendationsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  try {
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: RECOMMENDATION_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(parsed.data.profile) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "skintune_recommendations",
          strict: true,
          schema: RESPONSE_JSON_SCHEMA,
        },
      },
      temperature: 0.9,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Model returned no content");

    const modelResult = ModelOutputSchema.parse(JSON.parse(raw));
    const recommendations: LookRecommendation[] = modelResult.recommendations.map((look) => ({
      ...look,
      // Placeholder until /api/generate-images fills in a real visual.
      imageUrl: "/replace-with-generated/pending.webp",
    }));

    const data = RecommendationsResponseSchema.parse({ recommendations });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Failed to generate recommendations");
    if (process.env["NODE_ENV"] !== "production") {
      // Surface the raw failure in dev logs to make prompt/schema mismatches
      // easy to diagnose without a debugger.
      // eslint-disable-next-line no-console -- intentional dev-only diagnostic
      console.error("recommendations route error detail:", err);
    }
    res.status(502).json({
      error: "Failed to generate recommendations",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
