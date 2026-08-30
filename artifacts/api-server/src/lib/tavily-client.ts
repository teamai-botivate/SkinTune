// Tavily web-search client for the real-dress-search feature.
// -------------------------------------------------------------
// Tavily's /search endpoint returns two loosely-related arrays, not one
// clean "product" shape: `images[]` (each a real image URL + a descriptive
// title/caption Tavily itself generated from the page) and `results[]`
// (page-level: URL, title, a short text snippet that often contains price).
// There's no per-image price/link field, so this module pairs them up by
// matching each image's hostname against the results from the same domain
// — a heuristic, not a guaranteed-accurate structured API, but it produces
// real, clickable, real-store results without needing a dedicated shopping
// API. See routes/search-dresses.ts for how this is turned into DressResult
// cards.

import { logger } from "./logger";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export type TavilyImage = {
  url: string;
  title?: string;
  description?: string;
};

export type TavilyResult = {
  url: string;
  title: string;
  content: string;
};

export type TavilySearchResponse = {
  images: TavilyImage[];
  results: TavilyResult[];
};

function getTavilyApiKey(): string {
  const key = process.env["TAVILY_API_KEY"];
  if (!key) {
    throw new Error(
      "TAVILY_API_KEY is not set. Configure it as an environment variable " +
        "(e.g. in the Render dashboard) to enable real-dress web search.",
    );
  }
  return key;
}

/**
 * Runs one Tavily web search for shopping results. Requests both images
 * (for real product photos) and page results (for price/link context) in a
 * single call — Tavily bills per search call, not per returned item, so
 * asking for more of both in one call is strictly cheaper than two calls.
 */
export async function tavilySearch(
  query: string,
  maxResults: number,
): Promise<TavilySearchResponse> {
  const apiKey = getTavilyApiKey();
  const res = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "advanced",
      include_images: true,
      include_image_descriptions: true,
      max_results: maxResults,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tavily search failed: ${res.status} ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    images?: Array<{ url: string; title?: string; description?: string } | string>;
    results?: Array<{ url: string; title: string; content: string }>;
  };

  // Tavily returns images as plain strings unless include_images (and the
  // account tier) supports the richer {url, title, description} shape —
  // normalize both forms so callers never have to check.
  const images: TavilyImage[] = (data.images ?? []).map((img) =>
    typeof img === "string" ? { url: img } : img,
  );
  const results: TavilyResult[] = (data.results ?? []).map((r) => ({
    url: r.url,
    title: r.title,
    content: r.content,
  }));

  logger.debug({ query, imageCount: images.length, resultCount: results.length }, "Tavily search complete");
  return { images, results };
}
