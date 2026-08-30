import { Router, type IRouter } from "express";
import {
  SearchDressesRequestSchema,
  SearchDressesResponseSchema,
  type DressResult,
  type ShopLink,
  type SkinTuneProfile,
} from "../lib/skintune-schemas";
import { tavilySearch, type TavilyImage, type TavilyResult } from "../lib/tavily-client";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Builds a genuine shopping search query from the user's own profile —
 * gender, style world, colour preference, occasion, and budget — rather
 * than a fixed "dresses for women" string. Every clause here is
 * conditional on what the user actually answered, so two different
 * profiles produce two different queries and therefore different results;
 * there is no hardcoded product category or brand list.
 */
function buildSearchQuery(profile: SkinTuneProfile, page: number): string {
  const normalizedPronouns = profile.pronouns.toLowerCase();
  const audience = normalizedPronouns.includes("women")
    ? "women's"
    : normalizedPronouns.includes("men")
      ? "men's"
      : "";
  const parts = [
    "buy",
    audience,
    profile.style[0] || "",
    profile.colorsLove[0] || "",
    profile.occasion ? `${profile.occasion} outfit` : "outfit",
    "online",
    profile.budget ? `price ${profile.budget}` : "",
  ].filter(Boolean);
  // On later pages ("More"), nudge the query to surface a different slice
  // of results rather than re-fetching the same top results and
  // de-duplicating — Tavily has no native pagination for one query.
  if (page > 0 && profile.style[1]) parts.push(profile.style[1]);
  else if (page > 0 && profile.colorsLove[1]) parts.push(profile.colorsLove[1]);
  else if (page > 0) parts.push("more options");
  return parts.join(" ");
}

/** Extracts the hostname from a URL, or null if it isn't a valid absolute URL. */
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Well-known image-CDN hostname patterns mapped to the actual retailer
 * domain they serve. Tavily's images[] frequently come from a store's asset
 * CDN (e.g. i.etsystatic.com, i5.walmartimages.com) rather than the store's
 * own domain, which would otherwise make a perfectly good real photo point
 * to a useless CDN root as its "visit store" link. This list only
 * normalizes hostnames to their real, well-known parent retailer — it does
 * not invent a product-page URL or a price; the link is still just that
 * store's domain, not a proven product page.
 */
const CDN_HOST_TO_RETAILER: Record<string, string> = {
  "i.etsystatic.com": "etsy.com",
  "i5.walmartimages.com": "walmart.com",
  "i2.walmartimages.com": "walmart.com",
  "images-na.ssl-images-amazon.com": "amazon.com",
  "m.media-amazon.com": "amazon.com",
  "xcdn.next.co.uk": "next.co.uk",
  "cdn.shopify.com": "shopify.com",
  "assets.ajio.com": "ajio.com",
  "n.nordstrommedia.com": "nordstrom.com",
  "images.asos-media.com": "asos.com",
};

/** Maps a real (possibly CDN) hostname to the retailer domain used for both the "visit store" link and the display site name. */
function retailerDomainOf(hostname: string): string {
  if (CDN_HOST_TO_RETAILER[hostname]) return CDN_HOST_TO_RETAILER[hostname];
  // Generic CDN-subdomain heuristic: an "images."/"img."/"cdn."/"assets." /
  // "i<digit>." prefix on an otherwise-unknown host usually still belongs to
  // that same parent domain (e.g. img.zara.com -> zara.com already works
  // without this table), so strip one such leading label if present.
  const genericCdnPrefix = /^(images?|img|cdn|assets?|static|media|i\d*)\./;
  return hostname.replace(genericCdnPrefix, "");
}

/** Turns a domain into a human-readable store name, e.g. "utsavfashion.com" -> "Utsavfashion". */
function siteNameFrom(domain: string): string {
  const base = domain.split(".").slice(0, -1).join(".") || domain;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Best-effort price extraction from a result's text snippet — looks for a currency symbol followed by digits. Returns undefined if nothing matches. */
function extractPrice(content: string): string | undefined {
  const match = /(₹|Rs\.?|\$|€|£)\s?[\d,]+(?:\.\d{1,2})?/.exec(content);
  return match?.[0].trim();
}

/**
 * Builds dress photo cards directly from Tavily's images[] — see this
 * file's module doc comment for why images[] and results[] are NOT paired
 * by hostname (they come from largely different sites and rarely overlap).
 * Each card's "visit store" link is that same photo's own source domain,
 * normalized from any CDN hostname to the real retailer — a real, always-
 * present link, just not guaranteed to be the exact product page.
 */
function buildDressCards(images: TavilyImage[], limit: number, idOffset: number): DressResult[] {
  const cards: DressResult[] = [];
  for (const image of images) {
    if (cards.length >= limit) break;
    const host = hostnameOf(image.url);
    if (!host) continue;
    const domain = retailerDomainOf(host);
    cards.push({
      id: `dress-${idOffset + cards.length + 1}`,
      title: image.title || "Styled piece",
      imageUrl: image.url,
      siteName: siteNameFrom(domain),
      sourceUrl: `https://${domain}`,
    });
  }
  return cards;
}

/**
 * Builds the general "shop these online" links from Tavily's results[] —
 * real store category/search page URLs, each with a price when the page
 * snippet happened to contain one. Not tied to any specific dress photo
 * above; see this file's module doc comment.
 */
function buildShopLinks(results: TavilyResult[], limit: number): ShopLink[] {
  const links: ShopLink[] = [];
  const seenHosts = new Set<string>();
  for (const result of results) {
    if (links.length >= limit) break;
    const host = hostnameOf(result.url);
    if (!host || seenHosts.has(host)) continue;
    seenHosts.add(host);
    links.push({
      title: result.title,
      url: result.url,
      siteName: siteNameFrom(host),
      price: extractPrice(result.content),
    });
  }
  return links;
}

router.post("/search-dresses", async (req, res) => {
  const parsed = SearchDressesRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { profile, offset, limit } = parsed.data;
  const page = Math.floor(offset / limit);

  try {
    const query = buildSearchQuery(profile, page);
    // Ask Tavily for comfortably more than `limit` images since a few are
    // typically dropped for un-parseable URLs.
    const { images, results } = await tavilySearch(query, Math.max(limit * 2, 16));
    const dresses = buildDressCards(images, limit, offset);
    const shopLinks = buildShopLinks(results, 8);

    const data = SearchDressesResponseSchema.parse({
      results: dresses,
      shopLinks,
      // Best-effort signal for whether "More" is worth showing — Tavily
      // doesn't expose a total count, so this treats "we filled the page"
      // as "there's probably more" rather than tracking exact availability.
      hasMore: dresses.length >= limit,
    });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Failed to search for dresses");
    res.status(502).json({
      error: "Failed to search for dresses",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
