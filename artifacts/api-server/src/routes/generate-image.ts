import { Router, type IRouter } from "express";
import { toFile } from "openai";
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
 * Converts one recommendation's structured styling data into an edit
 * instruction. The image model only ever visualizes a styling decision made
 * by the recommendation engine (see routes/recommendations.ts) — it never
 * invents its own outfit, colour, or styling strategy. Framed as an edit
 * ("dress this same person in...") rather than a from-scratch generation
 * prompt, since the call itself is now images.edit against the user's own
 * uploaded photo — see the route handler below.
 */
function buildLookEditPrompt(
  look: LookRecommendation,
  profile: SkinTuneProfile,
  context: OccasionContext,
): string {
  const parts = [
    `Keep this exact same person — their face, identity, and expression must stay recognizably unchanged. Re-dress them for a ${context.occasion || "everyday"} setting, editorial style visualisation, full-length shot.`,
    `New outfit: ${look.outfit}`,
    `Colour direction: ${look.outfitColor}`,
    `Jewellery: ${look.jewellery}`,
    `Hairstyle: ${look.hairstyle}`,
    `Makeup: ${look.makeup}`,
    `Footwear: ${look.footwear}`,
    `Accessories: ${look.accessories}`,
    profile.bodyBuild ? `Preserve their natural build (${profile.bodyBuild}) — do not alter body shape.` : "",
    context.details ? `Context: ${context.details}` : "",
    "Natural lighting, tasteful and supportive, no beauty filter, no visible text or watermark. Do not change the person's face.",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Splits a "data:image/jpeg;base64,...." data URL into its mime type and raw bytes. */
function decodeDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("photoUrl is not a valid base64 data URL");
  const [, mime, base64] = match;
  return { mime, buffer: Buffer.from(base64, "base64") };
}

// One look per call — see the schema file's comment on GenerateImageRequestSchema
// for why this is deliberately not batched across all 5 looks.
router.post("/generate-image", async (req, res) => {
  const parsed = GenerateImageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { look, profile, context, photoUrl } = parsed.data;

  try {
    const openai = getOpenAIClient();
    const prompt = buildLookEditPrompt(look, profile, context);

    let imageUrl: string | undefined;

    if (photoUrl) {
      // Edit the user's own uploaded photo so the generated look shows the
      // same person, not a stranger — this is the whole point of the
      // feature. Note: input_fidelity is documented for gpt-image-1/1.5 but
      // gpt-image-2 rejects it with a 400 ("does not support the
      // 'input_fidelity' parameter") — confirmed against the live API, not
      // just docs, so deliberately omitted here. If a future model version
      // adds support, this is the natural place to re-add it.
      const { mime, buffer } = decodeDataUrl(photoUrl);
      const ext = mime.split("/")[1] ?? "jpg";
      const file = await toFile(buffer, `photo.${ext}`, { type: mime });
      const result = await openai.images.edit({
        model: IMAGE_MODEL,
        image: file,
        prompt,
        size: "1024x1536",
        output_format: "jpeg",
        output_compression: 80,
        n: 1,
      });
      const image = result.data?.[0];
      imageUrl = image?.b64_json ? `data:image/jpeg;base64,${image.b64_json}` : image?.url;
    } else {
      // No photo was provided (e.g. user skipped the photo step) — fall
      // back to text-to-image generation. The result won't resemble the
      // user, but it's still a usable style visualisation.
      const result = await openai.images.generate({
        model: IMAGE_MODEL,
        prompt,
        size: "1024x1536",
        output_format: "jpeg",
        output_compression: 80,
        n: 1,
      });
      const image = result.data?.[0];
      imageUrl = image?.b64_json ? `data:image/jpeg;base64,${image.b64_json}` : image?.url;
    }

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
