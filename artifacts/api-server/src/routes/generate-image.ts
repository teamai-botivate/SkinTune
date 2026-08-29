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
  stylingAddendum?: string | null,
): string {
  const parts = [
    `This is a photo of a real specific person. Edit ONLY their clothing, hairstyle, makeup, and background — you must NOT change their face, facial structure, facial features, skin tone, or identity in any way. The exact same face from the input photo must appear in the output, just re-dressed.`,
    // Anti "cut-paste face" instruction: the failure mode being guarded
    // against here is visibly distinct from ordinary identity drift — the
    // face reads as pasted onto a different pose/lighting/body rather than
    // photographed as one coherent scene. Naming it explicitly (not just
    // "keep the same face") gives the model something concrete to avoid.
    "The face must be seamlessly and naturally part of the new photo — matching the new lighting, angle, and skin tone rendering of the rest of the scene. It must never look like a face cut out and pasted onto a different body or pose; the neck, jaw, hairline, and shoulders must blend continuously into the body below with consistent lighting and perspective, as if this is one single photograph taken in one moment, not a composite.",
    `Re-dress this exact person for a ${context.occasion || "everyday"} setting.`,
    // Pose/expression/environment: primarily decided by writeStylingAddendum()
    // below, which actually looks at this person's face and this specific
    // look's mood — a fixed rule-based template here previously produced
    // near-identical expressions across all 5 looks regardless of intent.
    // The fallback line only fires when that agent call failed or no photo
    // was provided (nothing for it to analyze).
    stylingAddendum ? "" : buildFallbackPoseInstruction(context.occasion),
    buildFlatteringInstruction(profile.pronouns),
    `New outfit: ${look.outfit}`,
    `Colour direction: ${look.outfitColor}`,
    `Jewellery: ${look.jewellery}`,
    `Hairstyle: ${look.hairstyle}`,
    `Makeup: ${look.makeup}`,
    `Accessories: ${look.accessories}`,
    profile.bodyBuild ? `Preserve their natural build (${profile.bodyBuild}) — do not alter body shape.` : "",
    `The outfit must fit this exact person correctly: the garments should drape, sit, and follow their actual body shape and proportions as if properly tailored for them — correct shoulder line, sleeve and hem length, and natural fabric fall for their build. It should never look pasted on, stretched, floating away from the body, or cut for a different body shape. This should read as clothing that genuinely suits and flatters this specific person, not a generic outfit overlaid on them.`,
    context.details ? `Context: ${context.details}` : "",
    // This is the PRIMARY source of this look's pose, facial expression, and
    // body language — see writeStylingAddendum()'s doc comment. Everything
    // else in this prompt is a constraint or a styling fact; this is the
    // one part that's actually decided by looking at the person.
    stylingAddendum ? `Pose, expression, and styling direction for this specific person and this specific look (decided by analyzing their actual photo): ${stylingAddendum}` : "",
    "Natural lighting, tasteful and supportive, no beauty filter, no visible text or watermark. Professional editorial photo quality, the kind of natural, well-composed photo you'd see in a stylish social-media outfit post — not a stiff studio ID photo.",
    "Reminder: keep the same face and identity as the input photo, seamlessly integrated into the new scene (not pasted-looking), with an outfit that fits and suits their actual body correctly — this is a clothing, pose, and styling edit, not a new person and not a literal copy of the original snapshot's camera angle.",
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
 * Prompt-writing agent — the PRIMARY decision-maker for this look's pose,
 * facial expression, and body language. A GPT-4o vision call that actually
 * looks at the user's real photo (their real face shape, features,
 * apparent build, framing) plus the look's styling data, and decides what
 * pose and expression would genuinely look natural and flattering ON THIS
 * SPECIFIC FACE for this specific look — not a lookup from a fixed set of
 * mood keywords. An earlier version of this prompt asked for "a pose
 * distinct to this look's mood" as one bullet among several fit-related
 * ones, and results kept coming out with near-identical expressions across
 * all 5 looks; the fix is asking the model to genuinely study the face
 * (its natural resting expression, features, apparent personality cues)
 * and reason about what suits THAT face and THIS look's occasion, framed
 * the way a real photographer or social-media stylist would approach a
 * shoot — not filling in a template slot.
 *
 * Also writes fit/rendering detail (apparent proportions, shoulder width,
 * framing, visible build, hair length/texture) that a static text template
 * can't know without seeing the photo.
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
): Promise<string | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: RECOMMENDATION_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a fashion photographer and social-media stylist directing a photo edit — the kind of natural, well-composed \"outfit change\" edit popular on Instagram/Reels, where the same real person appears in a new outfit but the photo still looks like a genuine, spontaneously captured moment, never a stiff studio ID photo and never a face that looks pasted onto a different pose. You are shown a real person's actual photo and a complete-look recommendation for them. Your job is to genuinely study THIS person's face — their natural resting expression, face shape, features, and the vibe they already give off in the photo — and decide, like a photographer directing a real shoot, exactly what pose, facial expression, and body language would look most natural and flattering on THIS specific face for THIS specific look and occasion. Do not pick from a generic list of moods; reason about this actual face and this actual look together. Vary this meaningfully from what you'd choose for a different look on the same person — a look described as playful/casual calls for something different from one described as elegant/formal, but the expression must still feel like something this person's own face would naturally do, not a borrowed expression. Also write 1-2 sentences of fit/rendering detail you can only know from the photo (apparent proportions, shoulder width, framing, visible build, hair length/texture) to help the outfit and hairstyle render correctly on this build. Do not repeat generic instructions like 'keep the same face' or 'avoid a pasted look' — those are handled separately. Do not invent a different outfit, colour, or accessory than the one described. Never comment on attractiveness, body flaws, or anything that could read as a judgment — this is purely practical photography/styling direction. Write 3-5 short, concrete sentences total. Output only the sentences, no preamble, no markdown.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Look to render on this person: "${look.title}" — ${look.note} Outfit "${look.outfit}" (${look.outfitColor}), jewellery "${look.jewellery}", hairstyle "${look.hairstyle}", makeup "${look.makeup}", accessories "${look.accessories}". Why this look was chosen: ${look.reasoning.join(" ")}${look.vibe ? ` This look's intended vibe: "${look.vibe}".` : ""}${look.personaEnergy ? ` Photographer's energy brief for this look: ${look.personaEnergy}` : ""} Occasion: ${context.occasion || "everyday"}. Person's stated build: ${profile.bodyBuild || "not specified"}, fit preference: ${profile.fit || "not specified"}. Study their actual face in the photo and direct the pose and expression for this exact shoot, honoring the vibe/energy brief above but translated onto this specific real face — do not just restate the brief, show how it looks on THIS person.`,
            },
            { type: "image_url", image_url: { url: photoUrl } },
          ],
        },
      ],
      temperature: 0.8,
      max_tokens: 250,
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (text) logger.debug({ lookId: look.id, stylingAddendum: text }, "Styling addendum generated");
    return text || null;
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

  const { look, profile, context, photoUrl } = parsed.data;

  try {
    const openai = getOpenAIClient();
    // The addendum agent needs the actual photo to say anything useful, so
    // it only runs when one was provided — see writeStylingAddendum()'s doc
    // comment for what it does and doesn't control.
    const stylingAddendum = photoUrl
      ? await writeStylingAddendum(openai, look, profile, context, photoUrl)
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
