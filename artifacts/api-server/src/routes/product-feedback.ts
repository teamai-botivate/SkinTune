import { Router, type IRouter } from "express";
import { ProductFeedbackRequestSchema } from "../lib/skintune-schemas";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Interested / Not Interested feedback (this branch's product spec,
 * sections 21-23). This route is intentionally thin — there is no
 * server-side database on this branch (see CLAUDE.md's "no auth now"
 * note), so feedback isn't persisted here at all; the FRONTEND is the
 * actual source of truth, appending to its session-memory state
 * (services/shopping-session.ts) and persisting via localStorage the same
 * way every other piece of state in this app already works.
 *
 * This endpoint still exists as a real request (not a no-op) for two
 * reasons: (1) it's the natural extension point for real persistence once
 * accounts/a database exist — the frontend contract (dress + feedbackType
 * + optional reason) doesn't need to change when that happens, only this
 * handler's body does; (2) server-side logging of feedback is genuinely
 * useful signal now, even without a database, for understanding real
 * usage while iterating on search quality.
 */
router.post("/products/feedback", (req, res) => {
  const parsed = ProductFeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { dress, feedbackType, reason, sessionId } = parsed.data;
  logger.info(
    { dressId: dress.id, dressTitle: dress.title, feedbackType, reason, sessionId },
    "Product feedback recorded",
  );

  res.json({ ok: true });
});

export default router;
