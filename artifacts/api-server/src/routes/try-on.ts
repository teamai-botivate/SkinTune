import { Router, type IRouter } from "express";
import { TryOnRequestSchema, TryOnResponseSchema } from "../lib/skintune-schemas";
import { getVtoProvider } from "../lib/providers/vto";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Try-on: takes the user's ACTIVE AVATAR (see routes/avatar.ts and
 * services/avatar.ts's doc comments — the frontend now sends its avatar
 * image here as `photoUrl`, not the raw selfie) plus one real dress the
 * user picked, and generates one image of that avatar wearing that exact
 * garment.
 *
 * The actual image-generation mechanism now lives behind the VtoProvider
 * abstraction (lib/providers/vto/) — see that module's doc comment for
 * why: this branch's product spec asked for a specialized VTO provider
 * (FASHN) alongside the option to keep using this branch's original,
 * already-verified OpenAI-based mechanism. VTO_PROVIDER env var selects
 * which one actually runs; this route itself no longer knows or cares
 * which provider is active.
 */
router.post("/try-on", async (req, res) => {
  const parsed = TryOnRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { dress, profile, photoUrl } = parsed.data;

  try {
    const provider = getVtoProvider();
    const imageUrl = await provider.generateTryOn({
      avatarImageUrl: photoUrl,
      garmentImageUrl: dress.imageUrl,
      context: {
        occasion: profile.occasion,
        bodyBuild: profile.bodyBuild,
        fit: profile.fit,
        pronouns: profile.pronouns,
        garmentTitle: dress.title,
        garmentSiteName: dress.siteName,
      },
    });

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
