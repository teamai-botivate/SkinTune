import { Router, type IRouter } from "express";
import {
  AnalyzePhotoRequestSchema,
  AnalyzePhotoResponseSchema,
} from "../lib/skintune-schemas";
import { getOpenAIClient, RECOMMENDATION_MODEL } from "../lib/openai-client";
import { logger } from "../lib/logger";
import { z } from "zod";

const router: IRouter = Router();

const SYSTEM_PROMPT = `You are SkinTune's photo-quality and appearance analysis assistant. You are given one photo a user uploaded for styling purposes — most commonly an ordinary phone selfie, not a studio photo.

Be lenient by default. A normal phone selfie — held at arm's length, slightly low or off-centre angle, indoor room lighting, a bit of shadow, everyday framing — is completely normal and should be marked "good". Only flag a real problem when it would genuinely prevent reading the person's coloring: the photo is so dark you can barely make out facial features, so blurred the face is not recognisable, the face is mostly covered or out of frame, or there's an obvious strong beauty filter smoothing/distorting the skin. When in doubt between "good" and a problem, choose "good" — the cost of being too strict (making someone retake a perfectly usable photo) is worse than a slightly imperfect read.

Your job:
1. First, judge whether the photo is usable for styling colour analysis using the lenient standard above. If there's a genuine problem, pick the single most applicable one from this exact set: "low-light" (too dark to make out features, not just dim), "warm-light" (strong yellow/orange indoor tint clearly skewing colour, not just normal warm indoor light), "blurry" (face is not recognisably in focus), "angle" (face is not visible at all, e.g. turned fully away or looking down out of frame — a slightly tilted or low-angle selfie is fine), "filter" (an obvious strong beauty filter is visibly smoothing or altering the face), "occluded" (face is mostly covered by sunglasses, a hand, hair, or is out of frame). Use "good" for everything else, including typical imperfect but usable phone selfies.
2. If the photo is usable (status "good"), estimate:
   - skinTone: a short, respectful descriptive word (e.g. "Fair", "Light", "Medium", "Tan", "Deep", "Rich").
   - undertone: "Warm", "Cool", or "Neutral".
   - contrast: "Low", "Medium", or "High" — the contrast between the person's hair/eyes and their skin tone.
   - confidence: an integer 0-100 for how confident you are in this read given the photo quality. A normal selfie in typical indoor lighting should usually score 75-95, not low — reserve low confidence for genuinely borderline cases, not just "not a studio photo".
3. If the photo has a genuine problem (status is not "good"), still provide your best-guess skinTone/undertone/contrast (they'll be shown as provisional) but set confidence low (under 60) to reflect the uncertainty.

Never make medical, health, or diagnostic claims. Never comment on attractiveness, body shape, or perceived flaws — this is styling context only, not a judgment. Be supportive and neutral in tone; your only output is the structured fields below, no extra commentary.

Respond with JSON matching exactly this shape:
{"status": "good" | "low-light" | "warm-light" | "blurry" | "angle" | "filter" | "occluded", "skinTone": string, "undertone": string, "contrast": string, "confidence": number}`;

const ModelOutputSchema = z.object({
  status: z.enum(["good", "low-light", "warm-light", "blurry", "angle", "filter", "occluded"]),
  skinTone: z.string(),
  undertone: z.string(),
  contrast: z.string(),
  confidence: z.number(),
});

router.post("/analyze-photo", async (req, res) => {
  const parsed = AnalyzePhotoRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  try {
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: RECOMMENDATION_MODEL, // gpt-4o supports vision input
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this photo for styling purposes." },
            { type: "image_url", image_url: { url: parsed.data.photoUrl } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "skintune_photo_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["good", "low-light", "warm-light", "blurry", "angle", "filter", "occluded"],
              },
              skinTone: { type: "string" },
              undertone: { type: "string" },
              contrast: { type: "string" },
              confidence: { type: "integer" },
            },
            required: ["status", "skinTone", "undertone", "contrast", "confidence"],
            additionalProperties: false,
          },
        },
      },
      temperature: 0.3,
      max_tokens: 300,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Model returned no content");

    const modelResult = ModelOutputSchema.parse(JSON.parse(raw));
    const data = AnalyzePhotoResponseSchema.parse(modelResult);
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Failed to analyze photo");
    res.status(502).json({
      error: "Failed to analyze photo",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
