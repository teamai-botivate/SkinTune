import { Router, type IRouter } from "express";
import {
  GenerateImageRequestSchema,
  GenerateImageResponseSchema,
  type LookRecommendation,
  type SkinTuneProfile,
} from "../lib/skintune-schemas";
import { getOpenAIClient, IMAGE_MODEL } from "../lib/openai-client";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type OccasionContext = { occasion: string; details: string };

/**
 * Converts one recommendation's structured styling data into an image
 * prompt. The image model only ever visualizes a styling decision made by
 * the recommendation engine (see routes/recommendations.ts) — it never
 * invents its own outfit, colour, or styling strategy.
 */
function buildLookImagePrompt(
  look: LookRecommendation,
  profile: SkinTuneProfile,
  context: OccasionContext,
): string {
  const parts = [
    `Editorial fashion photograph, style visualisation, full-length, ${context.occasion || "everyday"} setting.`,
    `Outfit: ${look.outfit}`,
    `Colour direction: ${look.outfitColor}`,
    `Jewellery: ${look.jewellery}`,
    `Hairstyle: ${look.hairstyle}`,
    `Makeup: ${look.makeup}`,
    `Footwear: ${look.footwear}`,
    `Accessories: ${look.accessories}`,
    profile.appearance.skinTone
      ? `Skin tone: ${profile.appearance.skinTone}, ${profile.appearance.undertone} undertone.`
      : "",
    profile.bodyBuild ? `Build: ${profile.bodyBuild}.` : "",
    context.details ? `Context: ${context.details}` : "",
    "Natural lighting, tasteful and supportive, no beauty filter, no visible text or watermark.",
  ];
  return parts.filter(Boolean).join(" ");
}

// One look per call — see the schema file's comment on GenerateImageRequestSchema
// for why this is deliberately not batched across all 5 looks.
router.post("/generate-image", async (req, res) => {
  const parsed = GenerateImageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { look, profile, context } = parsed.data;

  try {
    const openai = getOpenAIClient();
    const prompt = buildLookImagePrompt(look, profile, context);
    const result = await openai.images.generate({
      model: IMAGE_MODEL,
      prompt,
      size: "1024x1536",
      // jpeg compresses far better than the png default for a photographic
      // subject — meaningfully smaller response body for the same visual
      // quality, which matters even per-image now that this is the only
      // image in the response.
      output_format: "jpeg",
      output_compression: 80,
      n: 1,
    });

    const image = result.data?.[0];
    const imageUrl =
      image?.url ??
      (image?.b64_json ? `data:image/jpeg;base64,${image.b64_json}` : undefined);
    if (!imageUrl) throw new Error("Image provider returned no image");

    const data = GenerateImageResponseSchema.parse({ look: { ...look, imageUrl } });
    res.json(data);
  } catch (err) {
    logger.error({ err, lookId: look.id }, "Failed to generate image for look");
    res.status(502).json({
      error: "Failed to generate look image",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
