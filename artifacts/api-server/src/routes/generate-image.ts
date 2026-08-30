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
 *
 * Fit/drape is called out explicitly too: "preserve their build" alone
 * only prevents the model from altering body shape — it says nothing about
 * whether the generated garments actually fit that build correctly. The
 * dedicated fit instruction below asks for the outfit to look tailored to
 * this specific person's proportions (shoulder line, sleeve/hem length,
 * fabric fall), not merely worn.
 */
/**
 * Bare-minimum fallback pose/environment line, used ONLY when
 * writeStylingAddendum() (below) fails to return anything — e.g. no photo
 * was provided, or the vision call errored. This is deliberately generic;
 * the real per-look, per-person pose/expression decision belongs to
 * writeStylingAddendum(), which actually looks at the person's face and
 * this specific look's mood, rather than a fixed keyword-matched template
 * guessing from look category text. An earlier version of this function
 * tried to vary pose by keyword-matching the look's title/category, but in
 * practice the resulting instructions were too generic to visibly change
 * the output — expressions kept coming out the same regardless of which
 * "family" matched. Do not resurrect that approach; let the vision agent
 * decide instead.
 */
function buildFallbackPoseInstruction(occasion: string): string {
  const environment = occasion
    ? `Background/setting: somewhere genuinely fitting for "${occasion}", softly out of focus behind the subject so they stay the clear focal point.`
    : "Background/setting: a warm, softly out-of-focus real-world backdrop appropriate to an everyday moment.";
  return `Compose the new shot with the camera at the subject's eye level, waist-up editorial portrait framing, a natural confident expression true to their own face. ${environment}`;
}

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
  addendum: StylingAddendum | null,
): string {
  const parts = [
    `This is a photo of a real specific person. The ONLY thing that must never change is WHO this person is: their face, facial structure, facial features, and skin tone must stay recognizably this exact same person. Everything else — hairstyle, expression, pose, body language, clothing, makeup, background — is yours to change as much as needed to produce the best possible result. Preserving identity is not the same as preserving the original photo; you are re-styling this person for a new shoot, not lightly editing their selfie.`,
    // Anti "cut-paste face" instruction: the failure mode being guarded
    // against here is visibly distinct from ordinary identity drift — the
    // face reads as pasted onto a different pose/lighting/body rather than
    // photographed as one coherent scene. Naming it explicitly (not just
    // "keep the same face") gives the model something concrete to avoid.
    "The face must be seamlessly and naturally part of the new photo — matching the new lighting, angle, and skin tone rendering of the rest of the scene. It must never look like a face cut out and pasted onto a different body or pose; the neck, jaw, hairline, and shoulders must blend continuously into the body below with consistent lighting and perspective, as if this is one single photograph taken in one moment, not a composite.",
    `Re-dress and re-style this exact person for a ${context.occasion || "everyday"} setting.`,
    // Pose/expression/environment: primarily decided by writeStylingAddendum()
    // below, which actually looks at this person's face and this specific
    // look's mood — a fixed rule-based template here previously produced
    // near-identical expressions across all 5 looks regardless of intent.
    // The fallback line only fires when that agent call failed or no photo
    // was provided (nothing for it to analyze).
    addendum ? "" : buildFallbackPoseInstruction(context.occasion),
    buildFlatteringInstruction(profile.pronouns),
    `New outfit: ${look.outfit}`,
    `Colour direction: ${look.outfitColor}`,
    `New hairstyle: ${look.hairstyle}. This hairstyle MUST be visibly and clearly restyled to match this description — do not leave the hair looking like the input photo. A different look calls for a different hairstyle; rendering the same hair across every look is a failure. Changing hairstyle does NOT change who this person is, so restyle it with confidence.`,
    `Makeup: ${look.makeup}`,
    `Accessories: ${look.accessories}`,
    profile.bodyBuild ? `Preserve their natural build (${profile.bodyBuild}) — do not alter body shape.` : "",
    `The outfit must fit this exact person correctly: the garments should drape, sit, and follow their actual body shape and proportions as if properly tailored for them — correct shoulder line, sleeve and hem length, and natural fabric fall for their build. It should never look pasted on, stretched, floating away from the body, or cut for a different body shape. This should read as clothing that genuinely suits and flatters this specific person, not a generic outfit overlaid on them.`,
    context.details ? `Context: ${context.details}` : "",
    // This is the PRIMARY source of this look's pose, facial expression, and
    // body language — see writeStylingAddendum()'s doc comment. Everything
    // else in this prompt is a constraint or a styling fact; this is the
    // one part that's actually decided by looking at the person.
    addendum
      ? `Pose, expression, hairstyle rendering, and body language for this specific person and this specific look (decided by analyzing their actual photo, and deliberately different from this person's other looks in this same shoot): Facial expression: ${addendum.expression} Head and camera angle: ${addendum.headAndCameraAngle} Body language and pose: ${addendum.bodyLanguage} How the new hairstyle should actually render on this person's head/face shape: ${addendum.hairstyleRendering} ${addendum.fitNotes}`
      : "",
    "Natural lighting, tasteful and supportive, no beauty filter, no visible text or watermark. Professional editorial photo quality, the kind of natural, well-composed photo you'd see in a stylish social-media outfit post — not a stiff studio ID photo.",
    "Reminder: keep the same face and identity as the input photo, seamlessly integrated into the new scene (not pasted-looking) — but hairstyle, expression, pose, and clothing must all change as directed above, confidently and visibly, to give the best possible styled result for this specific look. This is a full re-styling, not a light touch-up.",
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
 * Structured output of writeStylingAddendum() — see its doc comment. Split
 * into discrete fields (rather than one free-text paragraph) specifically
 * to stop the 5 parallel per-look calls from converging on similarly-worded
 * "confident, natural expression" prose: forcing the model to commit to a
 * specific value per field (not just "a mood") produces more concretely
 * different results, and lets buildLookEditPrompt() weight each aspect
 * (hairstyle rendering in particular) as its own strong instruction instead
 * of one clause buried in a paragraph.
 */
type StylingAddendum = {
  expression: string;
  headAndCameraAngle: string;
  bodyLanguage: string;
  hairstyleRendering: string;
  fitNotes: string;
};

const STYLING_ADDENDUM_JSON_SCHEMA = {
  type: "object",
  properties: {
    expression: { type: "string", description: "The specific facial expression for this shot — concrete, not generic (e.g. 'a bright open laugh, eyes crinkled' not 'confident expression')." },
    headAndCameraAngle: { type: "string", description: "Camera height and head angle/tilt for this specific shot." },
    bodyLanguage: { type: "string", description: "How the body, shoulders, hands, and weight are positioned — concrete and specific to this look's mood." },
    hairstyleRendering: { type: "string", description: "How the new hairstyle should actually look on this person's real head/face shape, hair length, and texture as seen in the photo — must describe a hairstyle that is visibly different from what appears in the input photo, matching the look's requested hairstyle." },
    fitNotes: { type: "string", description: "1-2 sentences on how the outfit should fit this person's actual visible proportions/build/shoulder width from the photo." },
  },
  required: ["expression", "headAndCameraAngle", "bodyLanguage", "hairstyleRendering", "fitNotes"],
  additionalProperties: false,
} as const;

/**
 * Prompt-writing agent — the PRIMARY decision-maker for this look's pose,
 * facial expression, hairstyle rendering, and body language. A GPT-4o
 * vision call that actually looks at the user's real photo (their real face
 * shape, features, apparent build, framing) plus the look's styling data,
 * and decides what pose, expression, and hairstyle rendering would
 * genuinely look natural and flattering ON THIS SPECIFIC FACE for this
 * specific look — not a lookup from a fixed set of mood keywords.
 *
 * History of this function (do not regress to earlier approaches — both
 * were tried and failed in production):
 * 1. A keyword-matched template picking a pose "family" from the look's
 *    title/category text — too generic, expressions barely changed.
 * 2. This function as free-form prose (3-5 sentences) — an improvement,
 *    but real production batches still came back with near-identical
 *    expressions/poses across all 5 looks AND near-identical, barely-changed
 *    hairstyles across different users entirely. Two causes: (a) the 5
 *    parallel per-look calls have no visibility into each other, so they
 *    independently converge on the same "safe" photographer-cliché answer
 *    regardless of vibe; (b) free prose gives the model room to write
 *    something plausible-sounding without committing to a genuinely
 *    different value, and hairstyle specifically kept losing to the
 *    identity-preservation instructions in the final edit prompt.
 * 3. Current fix (this version): structured JSON output with discrete
 *    required fields (forces commitment to specific values instead of
 *    vague prose), explicit sibling-look vibe awareness (told what the
 *    OTHER looks in this batch already used, and instructed to actively
 *    avoid repeating them), and an explicit, forceful hairstyle-rendering
 *    field paired with a matching forceful instruction in
 *    buildLookEditPrompt() that clarifies changing hairstyle does NOT
 *    violate identity preservation.
 *
 * Deliberately does NOT get to decide identity/fit POLICY — the mandatory
 * rules (keep the same face, fit the outfit to the person's actual build,
 * avoid a pasted-look face) are always injected by buildLookEditPrompt()
 * regardless of what this agent returns, so a malformed or oddly-worded
 * agent response can only add nuance, never weaken or drop the
 * non-negotiable constraints. If this call fails for any reason, the
 * caller falls back to buildFallbackPoseInstruction() — a generic pose
 * line — rather than failing the whole request.
 */
async function writeStylingAddendum(
  openai: ReturnType<typeof getOpenAIClient>,
  look: LookRecommendation,
  profile: SkinTuneProfile,
  context: OccasionContext,
  photoUrl: string,
  siblingVibes: string[],
): Promise<StylingAddendum | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: RECOMMENDATION_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a fashion photographer and social-media stylist directing a photo edit — the kind of natural, well-composed \"outfit change\" edit popular on Instagram/Reels, where the same real person appears in a new outfit but the photo still looks like a genuine, spontaneously captured moment, never a stiff studio ID photo and never a face that looks pasted onto a different pose. You are shown a real person's actual photo and a complete-look recommendation for them. Your job is to genuinely study THIS person's face — their natural resting expression, face shape, features, and the vibe they already give off in the photo — and decide, like a photographer directing a real shoot, exactly what facial expression, head/camera angle, body language, and hairstyle rendering would look most natural and flattering on THIS specific face for THIS specific look and occasion. Do not pick from a generic list of moods; reason about this actual face and this actual look together, and commit to specific, concrete choices rather than safe generic ones — 'a bright open laugh with eyes crinkled' is useful, 'a confident expression' is not. The ONLY thing that must stay the same as the input photo is who this person is (face/identity) — hairstyle, expression, and pose are all expected and encouraged to change as much as suits the look; changing hair does not break identity. If you're told what expressions/vibes other looks in this same shoot already used, you MUST pick something genuinely different from all of them — repeating a similar expression across looks is a failure. Never comment on attractiveness, body flaws, or anything that could read as a judgment — this is purely practical photography/styling direction. Output must be valid JSON matching the given schema exactly.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Look to render on this person: "${look.title}" — ${look.note} Outfit "${look.outfit}" (${look.outfitColor}), jewellery "${look.jewellery}", hairstyle "${look.hairstyle}", makeup "${look.makeup}", accessories "${look.accessories}". Why this look was chosen: ${look.reasoning.join(" ")}${look.vibe ? ` This look's intended vibe: "${look.vibe}".` : ""}${look.personaEnergy ? ` Photographer's energy brief for this look: ${look.personaEnergy}` : ""} Occasion: ${context.occasion || "everyday"}. Person's stated build: ${profile.bodyBuild || "not specified"}, fit preference: ${profile.fit || "not specified"}.${siblingVibes.length ? ` This person is getting ${siblingVibes.length + 1} looks generated in this same shoot. The OTHER looks' vibes are: ${siblingVibes.join(", ")}. Your expression, pose, and body language for THIS look must be clearly and obviously different from all of those — do not converge on a similar "safe" default.` : ""} Study their actual face in the photo and direct this exact shoot, honoring the vibe/energy brief above but translated onto this specific real face — do not just restate the brief, show how it looks on THIS person, and describe exactly how the new hairstyle ("${look.hairstyle}") should render on their actual head shape and hair as seen in the photo.`,
            },
            { type: "image_url", image_url: { url: photoUrl } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "styling_addendum",
          strict: true,
          schema: STYLING_ADDENDUM_JSON_SCHEMA,
        },
      },
      temperature: 0.9,
      max_tokens: 400,
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return null;
    const addendum = JSON.parse(raw) as StylingAddendum;
    logger.debug({ lookId: look.id, stylingAddendum: addendum }, "Styling addendum generated");
    return addendum;
  } catch (err) {
    logger.warn({ err, lookId: look.id }, "Styling addendum agent failed; continuing without it");
    return null;
  }
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
    quality: "high",
    output_format: "jpeg",
    output_compression: 90,
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

  const { look, profile, context, photoUrl, siblingVibes } = parsed.data;

  try {
    const openai = getOpenAIClient();
    // The addendum agent needs the actual photo to say anything useful, so
    // it only runs when one was provided — see writeStylingAddendum()'s doc
    // comment for what it does and doesn't control.
    const stylingAddendum = photoUrl
      ? await writeStylingAddendum(openai, look, profile, context, photoUrl, siblingVibes ?? [])
      : null;
    const prompt = buildLookEditPrompt(look, profile, context, stylingAddendum);

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
        quality: "high",
        moderation: "low",
        output_format: "jpeg",
        output_compression: 90,
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
