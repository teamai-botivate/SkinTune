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
  hairstyleRendering: string;
};

const TRY_ON_ADDENDUM_JSON_SCHEMA = {
  type: "object",
  properties: {
    expression: { type: "string", description: "A specific, concrete, genuinely confident and flattering facial expression for this shot, matching this dress's mood — not generic, and NOT simply whatever expression the person happened to have in their own casual reference photo (which may be flat, tired, or off-guard). Direct them the way a real photographer would coach a subject to look their best for this specific shot." },
    headAndCameraAngle: { type: "string", description: "Camera height and head angle/tilt for this specific shot — must differ from a plain straight-on head-level shot unless that genuinely suits this dress and occasion." },
    bodyLanguage: { type: "string", description: "How the body, shoulders, hands, and weight are positioned — concrete and specific to this dress's mood, not a stiff standing-still default." },
    environmentAndSetting: { type: "string", description: "A specific background/setting/lighting that genuinely fits this exact dress and the person's stated occasion — reasoned fresh, not a stock choice." },
    fitNotes: { type: "string", description: "How this exact dress (as seen in its real product photo) should drape and fit this specific person's actual visible build/proportions from their photo." },
    hairstyleRendering: { type: "string", description: "How the hair should actually look in this shot given the dress's style and occasion — restyled if that suits the look better, described concretely on this person's real head shape/hair as seen in their photo." },
  },
  required: ["expression", "headAndCameraAngle", "bodyLanguage", "environmentAndSetting", "fitNotes", "hairstyleRendering"],
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
            "You are a fashion photographer directing a virtual try-on shoot — the kind of natural, well-composed \"outfit change\" edit popular on Instagram/Reels, where the same real person appears in a new outfit but the photo looks like a genuine, freshly-taken, professionally shot photograph, never a lightly-touched-up copy of their original selfie. You are shown two images: a real person's own photo (very often a casual, off-guard phone selfie — flat lighting, a neutral or tired expression, an awkward low angle, not their best moment) and a real product photo of a specific dress/outfit they want to try on. Your job is to genuinely study both — this person's underlying face shape and features, their build, and this exact garment's cut, colour, and mood — and decide, like a photographer directing a real shoot, the facial expression, head/camera angle, body language, background/setting, hairstyle, and how this specific garment should drape on this specific body. This is a full re-styling for a new shoot, not a light touch-up on the input photo — the pose, expression, hair, and setting should all genuinely change from whatever they were in the original photo. Explicitly do NOT carry over the input selfie's expression or mood as-is — even if the person looked flat, tired, serious, or camera-shy in their own casual photo, direct a genuinely confident, warm, camera-ready expression for this shot instead, the way a good photographer coaches a subject to look their best, never a copy of however they happened to look when they snapped a quick selfie alone. Nothing should be a generic, reusable default: reason freshly about this exact person and this exact garment together, and commit to specific, concrete choices rather than safe generic ones. The ONLY thing that must stay the same as the input photo is who this person is — their underlying facial structure, features, and build — not their literal expression, mood, or however flattering (or not) that one casual photo happened to be. Never comment on attractiveness or body shape judgmentally — this is purely practical photography direction. Output must be valid JSON matching the given schema exactly.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Dress/outfit to try on this person: "${dress.title}" (from ${dress.siteName}). Person's stated occasion: ${profile.occasion || "everyday"}, build: ${profile.bodyBuild || "not specified"}, fit preference: ${profile.fit || "not specified"}, pronouns: ${profile.pronouns || "not specified"} (context only, not a template lookup). Study their actual face/build/hair in the first photo and this exact garment in the second photo, then direct this shoot as a genuinely new photograph — a different pose, expression, and hairstyle from whatever the input photo happens to show, whatever combination actually suits this garment and occasion best on this real person.`,
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
      // No `temperature` override — see analyze-photo.ts's comment on the
      // same param; gpt-5.5 only supports the default value.
      // max_completion_tokens, not max_tokens — see analyze-photo.ts's
      // comment on the same param; gpt-5.5 rejects the older name.
      max_completion_tokens: 400,
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

function buildTryOnPrompt(dress: DressResult, profile: SkinTuneProfile, addendum: TryOnAddendum | null): string {
  const parts = [
    `This is a photo of a real specific person, shown alongside a real product photo of a dress/outfit ("${dress.title}"). The single most important rule: the output must show the SAME PERSON as the first reference photo — the same underlying face, features, and body build, genuinely recognizable as this individual. This is a hard, non-negotiable constraint that overrides every other instruction in this prompt if they ever conflict. But matching identity means matching WHO they are, not literally copying pixels from their photo: this must be a brand new, freshly-composed photograph — a different expression, a different pose, different lighting, a different setting — never a crop or copy-paste of the input photo's face pasted onto a new body or background. Think of this the way a skilled portrait photographer would: they'd recognize the person on sight, but every photograph they take of that person looks like a real, distinct moment, not a repeated copy of one snapshot. Everything else — hairstyle, expression, pose, body language, background — is yours to change as much as needed for the best result. Preserving identity is not the same as preserving the original photo; you are re-styling this person for a new shoot, not lightly editing their existing photo.`,
    // Explicit, itemized face-feature preservation — full-length framing
    // (required here, see below, so the whole garment stays visible) is a
    // BIGGER transformation from a typical selfie than a waist-up crop
    // would be, which empirically makes the model more likely to
    // "reinterpret" the face. Since framing can't be pulled in to
    // compensate (the product needs the full outfit visible), the
    // mitigation instead is to be maximally explicit about which exact
    // facial features must transfer, rather than relying on a vaguer
    // "keep the same face" instruction alone.
    //
    // IMPORTANT: this list names structural features to preserve (shape,
    // proportions, markings) specifically so the model has concrete things
    // to hold onto WITHOUT resorting to literally copy-pasting the face
    // region — a real, reported failure mode where an overly literal
    // "keep the exact face" instruction caused the model to paste the
    // input photo's face (expression and all) directly onto the new body,
    // producing a visible seam and a frozen, mismatched expression that
    // never fit the new pose/scene. The fix is this explicit framing:
    // match the structural identity, but render it fresh, feeling free to
    // vary micro-expression, eye direction, and skin lighting naturally.
    "Study the person's underlying facial structure in the first reference photo — face shape and jawline, eyebrow shape and thickness, eye shape and spacing, nose shape, mouth/lip shape, any facial hair (style, density, and pattern), skin tone, and hairline — and reproduce THAT structure faithfully in the new photo, rendered naturally under the new photo's own lighting and expression. This is about matching their real bone structure and features, not about literally transplanting the face pixels from the input photo — the output should look like a new photograph of this same person, with their face lit and rendered as part of the new scene, not a cutout. Do not generate a generic or idealized face that merely resembles this person. Do not slim, narrow, or otherwise idealize the face shape — reproduce it as it actually is, fuller or rounder faces included — but do let them look genuinely well-lit, well-groomed, and at their best, the way a good photographer would present anyone: flattering light and a confident, polished expression, never a copy of however they happened to look in a casual, off-guard selfie.",
    // Body build preservation was a real, live-reported gap: profile.
    // bodyBuild was only ever passed to writeTryOnAddendum() as loose
    // context, never turned into an explicit instruction in the actual
    // image-edit prompt (unlike generate-image.ts's buildLookEditPrompt,
    // which has always had this line). Result: real try-on outputs came
    // back visibly slimmer/more athletic than the person's actual photo,
    // alongside the face-shape drift — the model was filling in a "generic
    // fit model" build by default with nothing telling it not to.
    profile.bodyBuild
      ? `Preserve their exact natural body build as seen in the first reference photo (${profile.bodyBuild}) — do not slim them down, do not make them more athletic or toned than they actually appear, do not alter their body shape, proportions, height, or weight in any way. The garment should be shown fitting THIS person's real build, not a slimmer or more idealized version of them.`
      : "Preserve their exact natural body build, proportions, and weight as seen in the first reference photo — do not slim them down or otherwise alter their body shape.",
    // Anti "cut-paste face" instruction, ported from generate-image.ts —
    // the failure mode this guards against is visibly distinct from
    // ordinary identity drift: the face reads as pasted onto a different
    // pose/lighting/body rather than photographed as one coherent scene.
    "The face must be seamlessly and naturally part of the new photo — matching the new lighting, angle, and skin tone rendering of the rest of the scene. It must never look like a face cut out and pasted onto a different body or pose; the neck, jaw, hairline, and shoulders must blend continuously into the body below with consistent lighting and perspective, as if this is one single photograph taken in one moment, not a composite of the original photo with a new outfit glued on.",
    // Full-length framing is required (not waist-up) because the product
    // needs the complete garment visible, including bottoms/footwear —
    // cropping to waist-up would hide most of the outfit and defeat the
    // point of a try-on. This is a deliberate trade-off: full-length is a
    // bigger transformation from a typical selfie and empirically carries
    // more identity-drift risk than a tighter crop would, which is why the
    // face-feature instructions above are unusually explicit to compensate.
    "Frame this as a full-length shot showing the complete outfit from head to shoes — the whole garment, including any bottoms and footwear, must be visible in the frame. Do not crop to a waist-up or close-up portrait; the point of this photo is to show the full look.",
    "Dress this exact person in the exact garment shown in the second reference image — match its actual cut, colour, pattern, and details faithfully, not a generic approximation.",
    "The garment must fit this exact person's actual body correctly: drape, sit, and follow their REAL proportions and build (not a slimmer or idealized version) as if properly worn, not pasted on or floating away from the body.",
    addendum
      ? `New hairstyle rendering for this shot: ${addendum.hairstyleRendering} This hair MUST be visibly restyled to match that description if it calls for a change from the input photo — do not simply leave the hair exactly as it appears in the original photo. Changing hairstyle does NOT change who this person is, so restyle it with confidence.`
      : "",
    addendum
      ? `Pose, expression, and setting for this shot (decided by studying this exact person and this exact garment together, and deliberately different from a plain reproduction of the input photo's own pose/expression): Facial expression: ${addendum.expression} Head and camera angle: ${addendum.headAndCameraAngle} Body language and pose: ${addendum.bodyLanguage} Background/setting: ${addendum.environmentAndSetting} Fit: ${addendum.fitNotes}`
      : "Compose this as one natural, well-lit, coherent photograph with a pose, expression, and setting genuinely different from the input photo's own — a new shoot, not a copy of the original.",
    "Natural lighting, tasteful and supportive, no beauty filter, no visible text or watermark. Professional editorial photo quality, the kind of natural, well-composed photo you'd see in a stylish social-media outfit post — not a stiff studio ID photo, and not a barely-modified copy of the input selfie.",
    "Final reminder, the most important rule in this entire prompt: the output face AND body build must be unmistakably the SAME PERSON as the first reference photo — same face shape, same features, same facial hair, same skin tone, same body build and proportions (not slimmer, not more toned, not idealized). Look at the first reference photo again before finishing and check the output genuinely matches it. Seamlessly integrated into the new scene (not pasted-looking), full-length framing with the complete outfit visible — but hairstyle, expression, pose, and background must all change as directed above, confidently and visibly, to give the best possible result showing this exact garment on this exact person. This is a full re-styling for a new photograph, not a light touch-up of the original.",
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
    const prompt = buildTryOnPrompt(dress, profile, addendum);

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
