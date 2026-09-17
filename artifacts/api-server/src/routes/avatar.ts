import { Router, type IRouter } from "express";
import { AvatarCreateRequestSchema, AvatarCreateResponseSchema, type Avatar } from "../lib/skintune-schemas";
import { getVtoProvider } from "../lib/providers/vto";
import { logger } from "../lib/logger";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

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
//
// The actual image-generation mechanism now lives behind the VtoProvider
// abstraction (lib/providers/vto/) — see that module's doc comment. This
// route no longer knows or cares whether that's OpenAI's image-editing
// pipeline or FASHN's Face to Model endpoint; VTO_PROVIDER selects it.
router.post("/avatar/create", async (req, res) => {
  const parsed = AvatarCreateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { photoUrl, profile } = parsed.data;

  try {
    const provider = getVtoProvider();
    const imageUrl = await provider.generateAvatar({ photoUrl, bodyBuild: profile.bodyBuild });

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
