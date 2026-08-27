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
- Vary the 5 looks meaningfully: one should be the closest overall match, then vary by mood (e.g. more glamorous, more elegant/soft, more minimal, a bolder/modern alternative) so the set feels like a real wardrobe of options, not five near-duplicates.
- Respect the user's stated colour preferences and restrictions; never contradict a stated dislike.
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
- Fit preference: ${profile.fit.join(", ") || "no strong preference"}
- Priorities: ${profile.priorities.join(", ") || "not specified"}
- Style worlds: ${profile.style.join(", ") || "open to suggestion"}
- Colours loved: ${profile.colorsLove.join(", ") || "no strong favourites stated"}
- Colours to avoid: ${profile.colorsAvoid.join(", ") || "none stated"}
- Restrictions: ${profile.restrictions.join(", ") || "none stated"}
- Occasion: ${profile.occasion || "not specified"} — ${profile.occasionDetails || "no further detail given"}
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
    "id", "title", "note", "category", "palette", "pieces", "outfit", "outfitColor",
    "jewellery", "hairstyle", "makeup", "accessories", "footwear", "reasoning", "confidence",
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
