import { Router, type IRouter } from "express";
import {
  AnalyzePhotoRequestSchema,
  AnalyzePhotoResponseSchema,
} from "../lib/skintune-schemas";
import { getOpenAIClient, RECOMMENDATION_MODEL } from "../lib/openai-client";
import { logger } from "../lib/logger";
import { z } from "zod";

const router: IRouter = Router();

const SYSTEM_PROMPT = `You are SkinTune's photo-quality and appearance analysis assistant. You are given one photo a user uploaded for styling purposes.

Your job:
1. First, judge whether the photo is usable for styling colour analysis. If not, pick the single most applicable problem from this exact set: "low-light" (too dark), "warm-light" (indoor yellow-tinted lighting skewing colour), "blurry" (out of focus / motion blur), "angle" (face not facing camera / too far away), "filter" (a beauty/filter effect is visibly smoothing skin or altering colour), "occluded" (face is significantly covered — sunglasses, hat, hair, hand). Use "good" if none of these apply and the photo is usable.
2. If the photo is usable (status "good"), estimate:
   - skinTone: a short, respectful descriptive word (e.g. "Fair", "Light", "Medium", "Tan", "Deep", "Rich").
   - undertone: "Warm", "Cool", or "Neutral".
   - contrast: "Low", "Medium", or "High" — the contrast between the person's hair/eyes and their skin tone.
   - confidence: an integer 0-100 for how confident you are in this read given the photo quality.
3. If the photo has a problem (status is not "good"), still provide your best-guess skinTone/undertone/contrast (they'll be shown as provisional) but set confidence low (under 60) to reflect the uncertainty.

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
