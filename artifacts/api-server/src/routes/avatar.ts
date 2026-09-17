import { Router, type IRouter } from "express";
import { toFile } from "openai";
import {
  AvatarCreateRequestSchema,
  AvatarCreateResponseSchema,
  type Avatar,
  type SkinTuneProfile,
} from "../lib/skintune-schemas";
import { getOpenAIClient, IMAGE_MODEL, RECOMMENDATION_MODEL } from "../lib/openai-client";
import { logger } from "../lib/logger";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

/**
 * The whole point of an avatar, per this branch's product spec: the user
 * uploads a selfie ONCE, and every subsequent try-on reuses this one
 * generated photo instead of re-deriving identity/build/framing from the
 * raw selfie every single time. This route is genuinely a special case of
 * try-on.ts's own machinery — same identity-preservation problem, same
 * "full-length framing needed" tradeoff, same fix (explicit itemized face
 * features + explicit build preservation + anti-cut-paste instruction) —
 * just with NO garment reference image, because the avatar isn't wearing
 * anything specific yet; it's a clean, well-lit, full-length reference
 * photo of this exact person that later try-on calls treat as "the photo",
 * not the user's own often-messier raw selfie.
 *
 * Deliberately does NOT duplicate try-on.ts's prompt-writing agent
 * (writeTryOnAddendum) — there's no garment to reason about pose/fit
 * against yet, so the styling decision here is much simpler: a clean,
 * neutral, flattering full-length studio-style presentation shot, still
 * genuinely decided per-person (build/coloring), not templated per the
 * "nothing hardcoded" product rule — see buildAvatarPrompt below for what
 * IS and isn't fixed here.
 */
function buildAvatarPrompt(profile: SkinTuneProfile): string {
  const parts = [
    `This is a photo of a real specific person. The task is to create their PERSONAL FASHION AVATAR — a single clean, well-lit, full-length reference photograph of this exact person that will be reused later as the base photo for trying on many different outfits. The single most important rule: the output must show the SAME PERSON as the reference photo — the same underlying face, features, and body build, genuinely recognizable as this individual. This is a hard, non-negotiable constraint that overrides every other instruction in this prompt if they ever conflict. But matching identity means matching WHO they are, not literally copying pixels from their photo: this must be a brand new, freshly-composed photograph — never a crop or copy-paste of the input photo's face pasted onto a new body or background.`,
    "Study the person's underlying facial structure in the reference photo — face shape and jawline, eyebrow shape and thickness, eye shape and spacing, nose shape, mouth/lip shape, any facial hair (style, density, and pattern), skin tone, and hairline — and reproduce THAT structure faithfully in the new photo, rendered naturally under the new photo's own lighting and expression. This is about matching their real bone structure and features, not about literally transplanting the face pixels from the input photo. Do not generate a generic or idealized face that merely resembles this person. Do not slim, narrow, or otherwise idealize the face shape — reproduce it as it actually is, fuller or rounder faces included.",
    profile.bodyBuild
      ? `Preserve their exact natural body build as seen in the reference photo (${profile.bodyBuild}) — do not slim them down, do not make them more athletic or toned than they actually appear, do not alter their body shape, proportions, height, or weight in any way.`
      : "Preserve their exact natural body build, proportions, and weight as seen in the reference photo — do not slim them down or otherwise alter their body shape.",
    "The face must be seamlessly and naturally part of the new photo — matching the new lighting, angle, and skin tone rendering of the rest of the scene. It must never look like a face cut out and pasted onto a different body or pose; the neck, jaw, hairline, and shoulders must blend continuously into the body below with consistent lighting and perspective, as if this is one single photograph taken in one moment.",
    "Frame this as a full-length shot from head to feet, standing in a simple, natural, relaxed pose suited to a personal fashion reference photo — not a stiff mugshot, not an overly dramatic editorial pose either, since this base photo will be re-styled into many different specific looks later. Wear simple, neutral, well-fitted everyday clothing (plain top and bottom in a neutral colour) rather than anything elaborate, since this is a base reference photo, not a finished styled look.",
    "The head and face must be sized correctly and naturally for a full-length photograph — proportional to the rest of the body the way a real full-body photo actually looks, not enlarged or close-up-sized the way it would appear cropped tightly in a selfie. Get the head-to-body size ratio right for someone standing at a normal distance from the camera.",
    "A neutral, softly-lit plain background (a simple studio-style backdrop or softly blurred neutral setting) so this photo works as a reusable reference for many different future outfits, not tied to one specific occasion or environment.",
    "A natural, warm, confident expression and relaxed, open body language — genuinely photographed under good even lighting, not a copy of however this person happened to look in a casual, off-guard selfie, but also not an exaggerated pose.",
    "Natural lighting, no beauty filter, no visible text or watermark. Professional, clean photo quality — the kind of well-lit, natural full-length photo a good photographer would take, not a stiff studio ID photo.",
    "Final reminder, the most important rule in this entire prompt: the output face AND body build must be unmistakably the SAME PERSON as the reference photo — same face shape, same features, same facial hair, same skin tone, same body build and proportions (not slimmer, not more toned, not idealized). Look at the reference photo again before finishing and check the output genuinely matches it on identity. This is a full-length, well-lit reference photo of this real person, not a generic fashion model.",
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

/** Primary path: Responses API's image_generation tool — same mechanism and org-verification caveat as try-on.ts/generate-image.ts. */
async function createAvatarViaResponsesApi(
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
    throw new Error(`Responses API avatar creation returned no result (status: ${imageCall?.status ?? "no call found"})`);
  }
  return `data:image/jpeg;base64,${imageCall.result}`;
}

/** Fallback path: classic images.edit — same caveat as try-on.ts's tryOnViaImagesEdit (weaker identity preservation, no org verification needed). */
async function createAvatarViaImagesEdit(
  openai: ReturnType<typeof getOpenAIClient>,
  prompt: string,
  photoUrl: string,
): Promise<string> {
  const { mime, buffer } = decodeDataUrl(photoUrl);
  const file = await toFile(buffer, `photo.${mime.split("/")[1] ?? "jpg"}`, { type: mime });
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
  if (!imageUrl) throw new Error("images.edit avatar creation returned no image");
  return imageUrl;
}

// POST /api/avatar/create — used both for first-time avatar creation AND
// explicit "Update/Recreate Avatar" (see this branch's product spec,
// section 7) — this route itself doesn't distinguish the two; the FRONTEND
// decides whether a new avatar becomes the only one (first-time) or a new
// version alongside the existing one (recreate), since there's no
// server-side user/avatar-versions store on this branch (no database — see
// CLAUDE.md's "no auth now" note). The frontend is responsible for
// persisting the returned Avatar as its "active avatar" via
// localStorage/services/avatar.ts, and for keeping prior versions if it
// wants version history — this route is stateless per-request, matching
// every other route in this codebase.
router.post("/avatar/create", async (req, res) => {
  const parsed = AvatarCreateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { photoUrl, profile } = parsed.data;

  try {
    const openai = getOpenAIClient();
    const prompt = buildAvatarPrompt(profile);

    let imageUrl: string;
    try {
      imageUrl = await createAvatarViaResponsesApi(openai, prompt, photoUrl);
    } catch (responsesApiErr) {
      logger.warn({ err: responsesApiErr }, "Responses API avatar creation failed, falling back to images.edit");
      imageUrl = await createAvatarViaImagesEdit(openai, prompt, photoUrl);
    }

    const avatar: Avatar = {
      id: randomUUID(),
      imageUrl,
      createdAt: new Date().toISOString(),
      active: true,
    };

    const data = AvatarCreateResponseSchema.parse({ avatar });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Failed to create avatar");
    res.status(502).json({
      error: "Failed to create avatar",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
