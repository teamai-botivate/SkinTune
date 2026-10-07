import { Router, type IRouter } from "express";
import {
  ProductRecommendationsRequestSchema,
  ProductRecommendationsResponseSchema,
} from "../lib/skintune-schemas";
import { searchProductsForLook } from "../lib/product-search";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * POST /api/product-recommendations
 *
 * Dedicated endpoint for real product discovery and shopping recommendations.
 * Given a LookRecommendation and SkinTuneProfile, it:
 * 1. Derives structured product requirements (outfit, makeup shade matching, jewellery, accessories, footwear).
 * 2. Performs live real product search via OpenAI Responses API with web search.
 * 3. Enforces persona/age safety (e.g. Children never receive adult makeup; Men do not receive women's makeup).
 * 4. Verifies real product URLs from authentic e-commerce platforms (Myntra, Nykaa, Ajio, Amazon, etc.).
 * 5. Filters and ranks products according to occasion, budget, preferred colors, and avoided colors.
 * 6. Returns structured ProductResult items with real URLs, prices, and match reasons.
 */
router.post("/product-recommendations", async (req, res) => {
  const parsed = ProductRecommendationsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
    return;
  }

  const { look, profile, category } = parsed.data;

  try {
    const result = await searchProductsForLook(look, profile, category);
    const validated = ProductRecommendationsResponseSchema.parse(result);
    res.json(validated);
  } catch (err) {
    logger.error({ err, lookId: look.id }, "Failed to process product recommendations");
    // Even if an unexpected error occurs, fail gracefully so styling recommendation remains accessible
    res.status(200).json({
      lookId: look.id,
      persona: "neutral",
      applicableCategories: ["outfit", "footwear", "accessories"],
      products: [],
      status: "unavailable",
      disclaimer: "Real product discovery is currently taking longer than expected. Please try again shortly.",
      searchedAt: new Date().toISOString(),
      totalFound: 0,
    });
  }
});

export default router;
