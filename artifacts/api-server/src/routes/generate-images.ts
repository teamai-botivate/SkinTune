import { Router, type IRouter } from "express";
import {
  GenerateImagesRequestSchema,
  GenerateImagesResponseSchema,
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

router.post("/generate-images", async (req, res) => {
  const parsed = GenerateImagesRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { recommendations, profile, context } = parsed.data;

  try {
    const openai = getOpenAIClient();

    const withImages: LookRecommendation[] = await Promise.all(
      recommendations.map(async (look) => {
        try {
          const prompt = buildLookImagePrompt(look, profile, context);
          const result = await openai.images.generate({
            model: IMAGE_MODEL,
            prompt,
            size: "1024x1536",
            n: 1,
          });
          const image = result.data?.[0];
          const imageUrl =
            image?.url ??
            (image?.b64_json ? `data:image/png;base64,${image.b64_json}` : undefined);
          if (!imageUrl) throw new Error("Image provider returned no image");
          return { ...look, imageUrl };
        } catch (err) {
          // One look's image failing shouldn't fail the whole batch — fall
          // back to its existing placeholder and log the reason.
          logger.error({ err, lookId: look.id }, "Failed to generate image for look");
          return look;
        }
      }),
    );

    const data = GenerateImagesResponseSchema.parse({ recommendations: withImages });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Failed to generate look images");
    res.status(502).json({
      error: "Failed to generate look images",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
