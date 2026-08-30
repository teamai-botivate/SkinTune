import { Router, type IRouter } from "express";
import { toFile } from "openai";
import {
  TryOnRequestSchema,
  TryOnResponseSchema,
  type DressResult,
  type SkinTuneProfile,
} from "../lib/skintune-schemas";
import { getOpenAIClient, IMAGE_MODEL, RECOMMENDATION_MODEL } from "../lib/openai-client";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Structured output of writeTryOnAddendum() below — mirrors
 * generate-image.ts's StylingAddendum pattern (see that file's extensive
 * doc comments for why this is structured JSON rather than free prose, and
 * why nothing here is a fixed template). Every field is a fresh decision
 * from actually looking at the person's photo AND the real dress photo
 * together — there is no fallback template with real content; if this
 * agent fails, buildTryOnPrompt() only gets one neutral placeholder
 * sentence, never a hardcoded styling decision.
 */
type TryOnAddendum = {
  expression: string;
  headAndCameraAngle: string;
  bodyLanguage: string;
  environmentAndSetting: string;
  fitNotes: string;
};

const TRY_ON_ADDENDUM_JSON_SCHEMA = {
  type: "object",
  properties: {
    expression: { type: "string", description: "A specific, concrete facial expression for this shot, reasoned from this person's actual resting expression in their photo and this dress's mood — not generic." },
    headAndCameraAngle: { type: "string", description: "Camera height and head angle/tilt for this specific shot." },
    bodyLanguage: { type: "string", description: "How the body, shoulders, hands, and weight are positioned — concrete and specific to this dress's mood." },
    environmentAndSetting: { type: "string", description: "A specific background/setting/lighting that genuinely fits this exact dress and the person's stated occasion — reasoned fresh, not a stock choice." },
    fitNotes: { type: "string", description: "How this exact dress (as seen in its real product photo) should drape and fit this specific person's actual visible build/proportions from their photo." },
  },
  required: ["expression", "headAndCameraAngle", "bodyLanguage", "environmentAndSetting", "fitNotes"],
  additionalProperties: false,
} as const;

/**
 * Vision agent that looks at BOTH the user's own photo and the real dress's
 * product photo together, and decides pose/expression/setting/fit — same
 * "let the AI genuinely decide, nothing hardcoded" principle as
 * generate-image.ts's writeStylingAddendum. This is the only source of
 * styling direction in this route; there is no keyword-matched or
 * gender-branched template anywhere in this file.
 */
async function writeTryOnAddendum(
  openai: ReturnType<typeof getOpenAIClient>,
  dress: DressResult,
  profile: SkinTuneProfile,
  photoUrl: string,
): Promise<TryOnAddendum | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: RECOMMENDATION_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a fashion photographer directing a virtual try-on shoot. You are shown two images: a real person's own photo, and a real product photo of a specific dress/outfit they want to try on. Your job is to genuinely study both — this person's face, build, and vibe, and this exact garment's cut, colour, and mood — and decide, like a photographer directing a real shoot, the facial expression, head/camera angle, body language, background/setting, and how this specific garment should drape on this specific body. Nothing should be a generic, reusable default: reason freshly about this exact person and this exact garment together. The ONLY thing that must stay the same as the input photo is who this person is (face/identity) — everything else about pose, expression, and setting is yours to decide for the best result. Never comment on attractiveness or body shape judgmentally — this is purely practical photography direction. Output must be valid JSON matching the given schema exactly.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Dress/outfit to try on this person: "${dress.title}" (from ${dress.siteName}). Person's stated occasion: ${profile.occasion || "everyday"}, build: ${profile.bodyBuild || "not specified"}, fit preference: ${profile.fit || "not specified"}, pronouns: ${profile.pronouns || "not specified"} (context only, not a template lookup). Study their actual face/build in the first photo and this exact garment in the second photo, then direct this shoot.`,
            },
            { type: "image_url", image_url: { url: photoUrl } },
            { type: "image_url", image_url: { url: dress.imageUrl } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "try_on_addendum",
          strict: true,
          schema: TRY_ON_ADDENDUM_JSON_SCHEMA,
        },
      },
      temperature: 0.9,
      max_tokens: 400,
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return null;
    const addendum = JSON.parse(raw) as TryOnAddendum;
    logger.debug({ dressId: dress.id, tryOnAddendum: addendum }, "Try-on addendum generated");
    return addendum;
  } catch (err) {
    logger.warn({ err, dressId: dress.id }, "Try-on addendum agent failed; continuing without it");
    return null;
  }
}

function buildTryOnPrompt(dress: DressResult, addendum: TryOnAddendum | null): string {
  const parts = [
    `This is a photo of a real specific person, shown alongside a real product photo of a dress/outfit ("${dress.title}"). The ONLY thing that must never change is WHO this person is: their face, facial structure, and skin tone must stay recognizably this exact same person. Everything else — hairstyle, expression, pose, body language, background — is yours to change as needed for the best result.`,
    "Dress this exact person in the exact garment shown in the second reference image — match its actual cut, colour, pattern, and details faithfully, not a generic approximation.",
    "The face must be seamlessly and naturally part of the new photo — matching the new lighting, angle, and skin tone rendering of the rest of the scene. It must never look like a face cut out and pasted onto a different body; the neck, jaw, and shoulders must blend continuously into the body below with consistent lighting and perspective, as one single photograph.",
    "The garment must fit this exact person's actual body correctly: drape, sit, and follow their real proportions as if properly worn, not pasted on or floating away from the body.",
    addendum
      ? `Pose, expression, and setting for this shot (decided by studying this exact person and this exact garment together): Facial expression: ${addendum.expression} Head and camera angle: ${addendum.headAndCameraAngle} Body language and pose: ${addendum.bodyLanguage} Background/setting: ${addendum.environmentAndSetting} Fit: ${addendum.fitNotes}`
      : "Compose this as one natural, well-lit, coherent photograph.",
    "Natural lighting, tasteful and supportive, no beauty filter, no visible text or watermark. Professional editorial photo quality, the kind of natural, well-composed photo you'd see in a stylish social-media outfit post.",
    "Reminder: keep the same face and identity as the input photo, seamlessly integrated into the new scene — but hairstyle, expression, pose, and background must change as directed above to give the best possible result showing this exact garment on this exact person.",
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
 * Primary path: Responses API's image_generation tool, given the user's own
 * photo AND the dress's real product photo as two reference images — same
 * mechanism and org-verification caveat as generate-image.ts.
 */
async function tryOnViaResponsesApi(
  openai: ReturnType<typeof getOpenAIClient>,
  prompt: string,
  photoUrl: string,
  dressImageUrl: string,
): Promise<string> {
  const response = await openai.responses.create({
    model: RECOMMENDATION_MODEL,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: photoUrl, detail: "original" },
          { type: "input_image", image_url: dressImageUrl, detail: "original" },
        ],
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
      `Responses API try-on returned no result (status: ${imageCall?.status ?? "no call found"})`,
    );
  }
  return `data:image/jpeg;base64,${imageCall.result}`;
}

/**
 * Fallback path: classic images.edit with both images passed as an array
 * (the user's photo first, the dress photo second) — doesn't require org
 * verification, weaker identity preservation, same caveat as
 * generate-image.ts's editViaImagesEdit. The dress photo may be a remote
 * https URL (from Tavily) rather than a data URL, so it's fetched first.
 */
async function tryOnViaImagesEdit(
  openai: ReturnType<typeof getOpenAIClient>,
  prompt: string,
  photoUrl: string,
  dressImageUrl: string,
): Promise<string> {
  const person = decodeDataUrl(photoUrl);
  const personFile = await toFile(person.buffer, `photo.${person.mime.split("/")[1] ?? "jpg"}`, {
    type: person.mime,
  });

  const dressRes = await fetch(dressImageUrl);
  if (!dressRes.ok) throw new Error(`Failed to fetch dress image: ${dressRes.status}`);
  const dressBuffer = Buffer.from(await dressRes.arrayBuffer());
  const dressMime = dressRes.headers.get("content-type") || "image/jpeg";
  const dressFile = await toFile(dressBuffer, `dress.${dressMime.split("/")[1] ?? "jpg"}`, { type: dressMime });

  const result = await openai.images.edit({
    model: IMAGE_MODEL,
    image: [personFile, dressFile],
    prompt,
    size: "1024x1536",
    quality: "high",
    output_format: "jpeg",
    output_compression: 90,
    n: 1,
  });
  const image = result.data?.[0];
  const imageUrl = image?.b64_json ? `data:image/jpeg;base64,${image.b64_json}` : image?.url;
  if (!imageUrl) throw new Error("images.edit try-on returned no image");
  return imageUrl;
}

router.post("/try-on", async (req, res) => {
  const parsed = TryOnRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { dress, profile, photoUrl } = parsed.data;

  try {
    const openai = getOpenAIClient();
    const addendum = await writeTryOnAddendum(openai, dress, profile, photoUrl);
    const prompt = buildTryOnPrompt(dress, addendum);

    let imageUrl: string;
    try {
      imageUrl = await tryOnViaResponsesApi(openai, prompt, photoUrl, dress.imageUrl);
    } catch (responsesApiErr) {
      logger.warn(
        { err: responsesApiErr, dressId: dress.id },
        "Responses API try-on failed, falling back to images.edit",
      );
      imageUrl = await tryOnViaImagesEdit(openai, prompt, photoUrl, dress.imageUrl);
    }

    const data = TryOnResponseSchema.parse({ imageUrl });
    res.json(data);
  } catch (err) {
    logger.error({ err, dressId: dress.id }, "Failed to generate try-on image");
    res.status(502).json({
      error: "Failed to generate try-on image",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
