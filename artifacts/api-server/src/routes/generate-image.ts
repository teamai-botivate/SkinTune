import { Router, type IRouter } from "express";
import { toFile } from "openai";
import {
  GenerateImageRequestSchema,
  GenerateImageResponseSchema,
  type LookRecommendation,
  type SkinTuneProfile,
} from "../lib/skintune-schemas";
import { getOpenAIClient, IMAGE_MODEL, RECOMMENDATION_MODEL } from "../lib/openai-client";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type OccasionContext = { occasion: string; details: string };

/**
 * Converts one recommendation's structured styling data into an edit
 * instruction. The image model only ever visualizes a styling decision made
 * by the recommendation engine (see routes/recommendations.ts) — it never
 * invents its own outfit, colour, or styling strategy.
 *
 * Identity preservation is a real, documented weak point of image editing:
 * the further the requested composition is from the input photo (e.g. a
 * tight face-crop selfie -> a full-length editorial shot), the more room
 * the model has to "reinterpret" the face rather than preserve it. Two
 * prompt-level things mitigate this regardless of which API path is used
 * (see the route handler below for the API-level mitigation):
 * (1) very explicit, repeated identity instructions up front and again at
 * the end (models weight both ends of a prompt more heavily), and
 * (2) requesting waist-up/portrait framing instead of full-length, which is
 * a much smaller transformation from a typical selfie and empirically
 * preserves the face far better.
 *
 * Pose and head angle are re-composed regardless of the input photo's
 * angle: many real uploads are casual low-angle selfies (phone held below
 * eye level, chin tucked, eyes cast down/sideways), and preserving that
 * literal head angle would carry the "bad selfie" framing into a supposedly
 * polished result. The instructions below explicitly ask for eye-level
 * camera and a confident straight-on gaze regardless of how the input
 * photo was angled — only the FACE is preserved, not the camera angle or
 * head tilt it happened to be photographed at.
 */
function buildFlatteringInstruction(pronouns: string): string {
  const normalized = pronouns.toLowerCase();
  if (normalized.includes("women")) {
    return "Present her looking genuinely beautiful and radiant: soft flattering light on the face, a confident and warm expression, polished hair and makeup exactly as specified, elegant relaxed posture, chin level and gently lifted.";
  }
  if (normalized.includes("men")) {
    return "Present him looking genuinely handsome and sharp: strong flattering light, a confident and grounded expression, well-groomed styling exactly as specified, sharp posture and fit, chin level and shoulders squared.";
  }
  return "Present them looking genuinely confident and their best self: flattering light on the face, a warm self-assured expression, polished styling exactly as specified, relaxed strong posture, chin level and shoulders squared.";
}

function buildLookEditPrompt(
  look: LookRecommendation,
  profile: SkinTuneProfile,
  context: OccasionContext,
): string {
  const parts = [
    `This is a photo of a real specific person. Edit ONLY their clothing, hairstyle, makeup, and background — you must NOT change their face, facial structure, facial features, skin tone, or identity in any way. The exact same face from the input photo must appear in the output, just re-dressed.`,
    `Re-dress and re-pose this exact person for a ${context.occasion || "everyday"} setting: waist-up editorial portrait. Regardless of the angle or head position in the original photo, compose the new shot with the camera held at the subject's eye level, their head facing forward toward the camera, chin level (not tilted down or to the side), shoulders relaxed and squared, and a natural confident expression — this is a flattering studio-style repose, not a copy of the original snapshot's angle.`,
    buildFlatteringInstruction(profile.pronouns),
    `New outfit: ${look.outfit}`,
    `Colour direction: ${look.outfitColor}`,
    `Jewellery: ${look.jewellery}`,
    `Hairstyle: ${look.hairstyle}`,
    `Makeup: ${look.makeup}`,
    `Accessories: ${look.accessories}`,
    profile.bodyBuild ? `Preserve their natural build (${profile.bodyBuild}) — do not alter body shape.` : "",
    context.details ? `Context: ${context.details}` : "",
    "Natural lighting, tasteful and supportive, no beauty filter, no visible text or watermark. Professional editorial photo quality, magazine-worthy composition, flattering pose and head angle — this should look like a genuinely great photo of this person.",
    "Reminder: keep the same face and identity as the input photo, but with a confident eye-level pose and head angle — this is a clothing, pose, and styling edit, not a new person and not a literal copy of the original snapshot's camera angle.",
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

/**
 * Primary path: edit the user's own uploaded photo via the Responses API's
 * image_generation tool. Verified (against a real selfie) to preserve
 * identity — face, hairline, facial hair pattern, even a facial mole — far
 * better than the classic images.edit endpoint below. detail: 'original' on
 * the input image skips any downscaling before the model sees the photo;
 * quality: 'high' on the output tool improves fidelity further.
 *
 * Requires the OpenAI organization to be "Verified" (platform.openai.com ->
 * Settings -> Organization) to call gpt-4o (or similar) via the Responses
 * API with the image_generation tool — an unverified org gets a 403. If
 * that happens (or any other failure), the caller falls back to
 * editViaImagesEdit below rather than failing the whole request.
 */
async function editViaResponsesApi(
  openai: ReturnType<typeof getOpenAIClient>,
  prompt: string,
  photoUrl: string,
): Promise<string> {
  const response = await openai.responses.create({
    model: RECOMMENDATION_MODEL,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: photoUrl, detail: "original" },
        ],
      },
    ],
    tools: [
      {
        type: "image_generation",
        model: IMAGE_MODEL,
        quality: "high",
        size: "1024x1536",
        output_format: "jpeg",
        output_compression: 85,
      },
    ],
  });

  const imageCall = response.output.find(
    (item): item is Extract<typeof item, { type: "image_generation_call" }> =>
      item.type === "image_generation_call",
  );
  if (!imageCall?.result) {
    throw new Error(
      `Responses API image generation returned no result (status: ${imageCall?.status ?? "no call found"})`,
    );
  }
  return `data:image/jpeg;base64,${imageCall.result}`;
}

/**
 * Fallback path: the classic images.edit endpoint. Weaker identity
 * preservation than the Responses API path above (confirmed against a real
 * selfie — this alone lost the user's face in production before the
 * Responses API migration), but doesn't require org verification, so it
 * keeps the feature working while that's pending. input_fidelity is
 * intentionally NOT set here either: gpt-image-2 rejects it with a 400
 * ("does not support the 'input_fidelity' parameter") on both this and the
 * Responses API path — confirmed against the live API.
 */
async function editViaImagesEdit(
  openai: ReturnType<typeof getOpenAIClient>,
  prompt: string,
  photoUrl: string,
): Promise<string> {
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
  const imageUrl = image?.b64_json ? `data:image/jpeg;base64,${image.b64_json}` : image?.url;
  if (!imageUrl) throw new Error("images.edit returned no image");
  return imageUrl;
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
      try {
        imageUrl = await editViaResponsesApi(openai, prompt, photoUrl);
      } catch (responsesApiErr) {
        logger.warn(
          { err: responsesApiErr, lookId: look.id },
          "Responses API image edit failed, falling back to images.edit",
        );
        imageUrl = await editViaImagesEdit(openai, prompt, photoUrl);
      }
    } else {
      // No photo was provided (e.g. user skipped the photo step) — fall
      // back to plain text-to-image generation. The result won't resemble
      // the user (there's nothing to preserve), but it's still a usable
      // style visualisation.
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
