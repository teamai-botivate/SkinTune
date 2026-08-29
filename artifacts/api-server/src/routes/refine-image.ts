import { Router, type IRouter } from "express";
import { toFile } from "openai";
import {
  RefineImageRequestSchema,
  RefineImageResponseSchema,
  type LookRecommendation,
} from "../lib/skintune-schemas";
import { getOpenAIClient, IMAGE_MODEL, RECOMMENDATION_MODEL } from "../lib/openai-client";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * The non-negotiable rules from generate-image.ts's buildLookEditPrompt
 * (same face/identity, outfit fit) apply here too — restated explicitly
 * rather than imported, since this route's prompt shape (a correction on
 * top of an existing image, potentially with two reference images) is
 * different enough from a from-scratch edit that sharing the exact same
 * builder wasn't a clean fit.
 */
function buildRefinementPrompt(look: LookRecommendation, customization: string, hasOriginalPhoto: boolean): string {
  const parts = [
    hasOriginalPhoto
      ? "You are shown two images: the person's original photo (for face/identity reference) and an already-generated styled photo of them in a complete look. Keep the exact same face and identity as the original photo."
      : "You are shown an already-generated styled photo of a real person in a complete look. Keep the exact same face and identity as shown.",
    `Apply this specific correction requested by the user: ${customization}`,
    `Keep everything else about the look the same unless the correction implies otherwise: outfit "${look.outfit}" in ${look.outfitColor}, jewellery "${look.jewellery}", hairstyle "${look.hairstyle}", makeup "${look.makeup}", accessories "${look.accessories}".`,
    "The outfit must still fit this person's actual body correctly — proper shoulder line, sleeve and hem length, and natural fabric drape for their build, never pasted-on or generic.",
    "Do not change the person's face, facial structure, or identity. Do not start over from scratch — this is a targeted refinement of the existing styled photo, not a new photo.",
    "Natural lighting, tasteful and supportive, no beauty filter, no visible text or watermark. Professional editorial photo quality.",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Splits a "data:image/jpeg;base64,...." data URL into its mime type and raw bytes. */
function decodeDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Not a valid base64 data URL");
  const [, mime, base64] = match;
  return { mime, buffer: Buffer.from(base64, "base64") };
}

/**
 * Primary path: Responses API's image_generation tool, given BOTH the
 * user's original photo and the already-generated look image as reference
 * (when a photo was provided), so the model refines the existing result
 * rather than regenerating blind. Same org-verification requirement and
 * fallback pattern as generate-image.ts's editViaResponsesApi.
 */
async function refineViaResponsesApi(
  openai: ReturnType<typeof getOpenAIClient>,
  prompt: string,
  generatedImageUrl: string,
  originalPhotoUrl: string | undefined,
): Promise<string> {
  const imageInputs = originalPhotoUrl
    ? [
        { type: "input_image" as const, image_url: originalPhotoUrl, detail: "original" as const },
        { type: "input_image" as const, image_url: generatedImageUrl, detail: "original" as const },
      ]
    : [{ type: "input_image" as const, image_url: generatedImageUrl, detail: "original" as const }];

  const response = await openai.responses.create({
    model: RECOMMENDATION_MODEL,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }, ...imageInputs],
      },
    ],
    tools: [
      {
        type: "image_generation",
        model: IMAGE_MODEL,
        quality: "high",
        moderation: "low",
        size: "1024x1536",
        output_format: "jpeg",
        output_compression: 90,
      },
    ],
  });

  const imageCall = response.output.find(
    (item): item is Extract<typeof item, { type: "image_generation_call" }> =>
      item.type === "image_generation_call",
  );
  if (!imageCall?.result) {
    throw new Error(
      `Responses API refinement returned no result (status: ${imageCall?.status ?? "no call found"})`,
    );
  }
  return `data:image/jpeg;base64,${imageCall.result}`;
}

/**
 * Fallback path: classic images.edit, given the already-generated look
 * image as the base to edit (and the original photo as a second reference
 * image if available — images.edit accepts an array of up to 16 images).
 * Doesn't require org verification. Weaker identity preservation than the
 * Responses API path, same caveat as generate-image.ts's editViaImagesEdit.
 */
async function refineViaImagesEdit(
  openai: ReturnType<typeof getOpenAIClient>,
  prompt: string,
  generatedImageUrl: string,
  originalPhotoUrl: string | undefined,
): Promise<string> {
  const generated = decodeDataUrl(generatedImageUrl);
  const generatedFile = await toFile(generated.buffer, `look.${generated.mime.split("/")[1] ?? "jpg"}`, {
    type: generated.mime,
  });

  const images = [generatedFile];
  if (originalPhotoUrl) {
    const original = decodeDataUrl(originalPhotoUrl);
    images.push(
      await toFile(original.buffer, `photo.${original.mime.split("/")[1] ?? "jpg"}`, { type: original.mime }),
    );
  }

  const result = await openai.images.edit({
    model: IMAGE_MODEL,
    image: images,
    prompt,
    size: "1024x1536",
    quality: "high",
    output_format: "jpeg",
    output_compression: 90,
    n: 1,
  });
  const image = result.data?.[0];
  const imageUrl = image?.b64_json ? `data:image/jpeg;base64,${image.b64_json}` : image?.url;
  if (!imageUrl) throw new Error("images.edit refinement returned no image");
  return imageUrl;
}

// One look per call, same reasoning as /api/generate-image.
router.post("/refine-image", async (req, res) => {
  const parsed = RefineImageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { look, photoUrl, customization } = parsed.data;

  if (!look.imageUrl || look.imageUrl.startsWith("/replace-with-generated")) {
    res.status(400).json({ error: "This look has no generated image yet to refine." });
    return;
  }

  try {
    const openai = getOpenAIClient();
    const prompt = buildRefinementPrompt(look, customization, Boolean(photoUrl));

    let imageUrl: string;
    try {
      imageUrl = await refineViaResponsesApi(openai, prompt, look.imageUrl, photoUrl);
    } catch (responsesApiErr) {
      logger.warn(
        { err: responsesApiErr, lookId: look.id },
        "Responses API refinement failed, falling back to images.edit",
      );
      imageUrl = await refineViaImagesEdit(openai, prompt, look.imageUrl, photoUrl);
    }

    const data = RefineImageResponseSchema.parse({ look: { ...look, imageUrl } });
    res.json(data);
  } catch (err) {
    logger.error({ err, lookId: look.id }, "Failed to refine look image");
    res.status(502).json({
      error: "Failed to refine look image",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
