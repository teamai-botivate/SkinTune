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
 * Major shopping sites to fan out per-site searches across, so results
 * aren't dominated by whichever single site happens to rank highest for
 * one query (confirmed live: a single unscoped query for "men's terracotta
 * wedding suit" returned almost entirely Etsy images). This list itself
 * isn't a styling decision — it's just where to look — so it's fine as a
 * fixed list of real, general-purpose marketplaces; it does not encode any
 * per-user preference or category logic.
 */
const SHOPPING_SITES = ["amazon.in", "flipkart.com", "myntra.com", "ajio.com", "meesho.com", "etsy.com"];

/**
 * Builds a genuine shopping search query from the user's own profile —
 * gender, style world, colour preference, occasion, and budget — rather
 * than a fixed "dresses for women" string. Every clause here is
 * conditional on what the user actually answered, so two different
 * profiles produce two different queries and therefore different results;
 * there is no hardcoded product category or brand list.
 *
 * `colour` and `style` are passed in explicitly (rather than always reading
 * profile.colorsLove[0]/style[0]) so callers can round-robin across the
 * user's full colour/style lists — see buildQueryPlan below. Reusing only
 * index 0 was the root cause of a real reported bug: every single result
 * came back the same colour because every query, on every site and every
 * page, asked for the same one colour.
 */
function buildSearchQuery(profile: SkinTuneProfile, colour: string, style: string): string {
  const normalizedPronouns = profile.pronouns.toLowerCase();
  const audience = normalizedPronouns.includes("women")
    ? "women's"
    : normalizedPronouns.includes("men")
      ? "men's"
      : "";
  const parts = [
    "buy",
    audience,
    style,
    colour,
    profile.occasion ? `${profile.occasion} outfit` : "outfit",
    "online",
    profile.budget ? `price ${profile.budget}` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

/**
 * One (site, colour, style) combination to search — see buildQueryPlan.
 */
type QueryTask = { site: string; colour: string; style: string };

/**
 * Builds the set of per-site, per-colour/style search tasks for one page of
 * results. Cycles through SHOPPING_SITES and the user's own colorsLove/
 * style lists (falling back to a single empty-string entry if the user
 * didn't provide any, so the query still forms without that clause) so
 * that across a page of results, both the SITE and the COLOUR/STYLE
 * genuinely vary instead of every task asking the same single-colour,
 * single-site question. `page` offsets which slice of the colour/style
 * lists this page starts from, so "More dresses" surfaces different
 * combinations rather than repeating page one's.
 */
function buildQueryPlan(profile: SkinTuneProfile, page: number, taskCount: number): QueryTask[] {
  const colours = profile.colorsLove.length ? profile.colorsLove : [""];
  const styles = profile.style.length ? profile.style : [""];
  const tasks: QueryTask[] = [];
  for (let i = 0; i < taskCount; i++) {
    const n = page * taskCount + i;
    tasks.push({
      site: SHOPPING_SITES[n % SHOPPING_SITES.length],
      colour: colours[n % colours.length],
      style: styles[n % styles.length],
    });
  }
  return tasks;
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
 * Builds dress photo cards from one site-scoped Tavily search's images[] —
 * see this file's module doc comment for why images[] and results[] are
 * NOT paired by hostname (they come from largely different sites and
 * rarely overlap). Each card's "visit store" link is that same photo's own
 * ACTUAL source domain (not necessarily the site this task was scoped to),
 * normalized from any CDN hostname to the real retailer.
 *
 * Deliberately does NOT filter out images whose real domain differs from
 * the site this task searched for. Confirmed live: Tavily's
 * `include_domains` does not reliably keep `images[]` on that one domain —
 * a search scoped to amazon.in/flipkart.com/myntra.com/ajio.com/meesho.com
 * mostly still returned other sites' images for real test queries (these
 * sites are often just less crawlable/indexed by Tavily for niche fashion
 * items than Etsy is). An earlier version of this function hard-filtered
 * to the expected domain, which correctly avoided ever mislabeling an
 * image's source, but also threw away almost every result for four of five
 * target sites, leaving too few dresses to show. Every card here still
 * shows its OWN real, correct source site (never a wrong label) — the
 * site-scoping is a ranking hint that shifts what Tavily returns, not a
 * guarantee of which real site a given card ends up from. If site coverage
 * for a query is ever reported as still too Etsy-heavy, that's a genuine
 * data-availability gap in what Tavily has indexed for that query, not a
 * pairing bug in this function — verify with a live query first.
 */
function buildDressCards(images: TavilyImage[], profile: SkinTuneProfile, limit: number, idOffset: number): DressResult[] {
  const cards: DressResult[] = [];
  for (const image of images) {
    if (cards.length >= limit) break;
    const host = hostnameOf(image.url);
    if (!host) continue;
    if (image.title && !isRelevantToProfile(image.title, image.description, profile)) continue;
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
 * Filters out results that are clearly off-topic for a clothing search,
 * even though they matched the colour/occasion keywords — a real,
 * live-reported problem: a men's-profile "terracotta wedding" query
 * surfaced a women's bridal lehenga colour guide and a terracotta
 * pottery/gifts listing in "Shop these online", because those pages
 * genuinely contain the words "terracotta" and "wedding" without being
 * clothing for this person at all. This checks BOTH title and content
 * snippet (title alone missed cases where the mismatch only showed up in
 * the description) for two things: (1) an explicit mention of the
 * opposite gender's clothing when the profile states a gender, and (2)
 * clearly non-clothing product categories (gifts, home decor, pottery,
 * accessories-only listings) that colour/theme keywords can accidentally
 * match. This is a relevance filter on real search results, not a
 * styling decision — it doesn't invent or prefer any specific product.
 */
function isRelevantToProfile(title: string, content: string | undefined, profile: SkinTuneProfile): boolean {
  const text = `${title} ${content ?? ""}`.toLowerCase();
  const normalizedPronouns = profile.pronouns.toLowerCase();

  const nonClothingCategories = [
    "pottery",
    "gift set",
    "wedding gift",
    "home decor",
    "home décor",
    "wall art",
    "showpiece",
    "figurine",
    "candle",
    "vase",
    "mug",
    "cup set",
    "dinnerware",
    "kitchenware",
  ];
  if (nonClothingCategories.some((term) => text.includes(term))) return false;

  if (normalizedPronouns.includes("men") && !normalizedPronouns.includes("women")) {
    const womenOnlyTerms = ["lehenga", "saree", "sari", "women's dress", "bridal makeup", "her wedding"];
    if (womenOnlyTerms.some((term) => text.includes(term))) return false;
  }
  if (normalizedPronouns.includes("women") && !normalizedPronouns.includes("men")) {
    const menOnlyTerms = ["men's suit", "men's blazer", "groom's sherwani", "his wedding"];
    if (menOnlyTerms.some((term) => text.includes(term))) return false;
  }
  return true;
}

/**
 * Builds the general "shop these online" links from Tavily's results[] —
 * real store category/search page URLs, each with a price when the page
 * snippet happened to contain one. Not tied to any specific dress photo
 * above; see this file's module doc comment.
 */
function buildShopLinks(results: TavilyResult[], profile: SkinTuneProfile, limit: number): ShopLink[] {
  const links: ShopLink[] = [];
  const seenHosts = new Set<string>();
  for (const result of results) {
    if (links.length >= limit) break;
    const host = hostnameOf(result.url);
    if (!host || seenHosts.has(host)) continue;
    if (!isRelevantToProfile(result.title, result.content, profile)) continue;
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

/** Interleaves several arrays round-robin (a,b,c, a,b,c, ...) instead of concatenating them, so the merged list alternates sites/colours instead of running all of one site's cards before the next. */
function interleave<T>(lists: T[][]): T[] {
  const merged: T[] = [];
  const maxLen = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) if (list[i] !== undefined) merged.push(list[i]);
  }
  return merged;
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
    // One task per site (see SHOPPING_SITES), each also varying colour and
    // style across the user's own lists — see buildQueryPlan's doc comment
    // for why this replaced a single unscoped query (it was the root cause
    // of both "only one site" and "only one colour" being reported live).
    const tasks = buildQueryPlan(profile, page, SHOPPING_SITES.length);
    const perTaskLimit = Math.max(2, Math.ceil((limit * 2) / tasks.length));

    const taskResults = await Promise.allSettled(
      tasks.map(async (task) => {
        const query = buildSearchQuery(profile, task.colour, task.style);
        const { images, results } = await tavilySearch(query, perTaskLimit * 2, [task.site]);
        return { task, images, results };
      }),
    );

    const perTaskCards: DressResult[][] = [];
    const allResults: TavilyResult[] = [];
    for (const outcome of taskResults) {
      if (outcome.status === "rejected") {
        logger.warn({ err: outcome.reason }, "One per-site dress search task failed; continuing with the others");
        continue;
      }
      const { images, results } = outcome.value;
      perTaskCards.push(buildDressCards(images, profile, perTaskLimit, 0));
      allResults.push(...results);
    }

    // Interleave so the grid alternates across tasks (site/colour/style
    // combinations) instead of running all of one task's cards before the
    // next, de-duplicate by image URL (different tasks can surface the
    // same photo, especially when several fall back to the same
    // well-indexed site), then re-number ids sequentially.
    const seenImageUrls = new Set<string>();
    const merged: DressResult[] = [];
    for (const dress of interleave(perTaskCards)) {
      if (merged.length >= limit) break;
      if (seenImageUrls.has(dress.imageUrl)) continue;
      seenImageUrls.add(dress.imageUrl);
      merged.push(dress);
    }
    const dresses: DressResult[] = merged.map((dress, i) => ({ ...dress, id: `dress-${offset + i + 1}` }));
    const shopLinks = buildShopLinks(allResults, profile, 8);

    if (dresses.length === 0) {
      throw new Error("No real dress results found across any site for this search — every per-site task returned nothing usable.");
    }

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
