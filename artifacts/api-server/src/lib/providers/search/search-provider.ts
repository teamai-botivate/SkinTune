// Search provider abstraction — lets the actual web-search mechanism behind
// /api/search-dresses be swapped without touching the route or any caller.
//
// Two implementations exist:
//   - OpenAiWebSearchProvider (openai-web-search-provider.ts) — the default,
//     using the Responses API's real `web_search` tool (confirmed present
//     on the installed `openai` SDK's own type definitions — see that
//     file's doc comment for exactly how this was verified, not assumed).
//   - LegacyTavilySearchProvider (legacy-tavily-provider.ts) — wraps the
//     original real-dress-search branch's Tavily integration untouched,
//     kept only as a fallback/legacy option, not the default.
//
// Selected via SEARCH_PROVIDER env var ("openai" | "tavily"), defaulting to
// "openai" — see getSearchProvider() in index.ts.

/** One real candidate product/photo found by a search provider — a common shape both providers normalize into, independent of how each one's underlying API actually returns results. */
export type SearchProductCandidate = {
  /** A real, absolute image URL for this product's photo. Never fabricated — omit the candidate entirely if no real image URL was found. */
  imageUrl: string;
  /** The real page this product/photo was found on, if known. */
  pageUrl?: string;
  /** Whatever real title/caption text the source provided for this item. */
  title?: string;
  /** Whatever real descriptive/snippet text the source provided. */
  description?: string;
  /** The hostname the image or page actually came from (used for domain filtering/normalization downstream — see search-dresses.ts). */
  sourceDomain?: string;
  /** A price string, ONLY if one was actually found in real source text — never inferred or guessed. */
  price?: string;
};

/** One general (non-image-specific) real store page a provider found — mirrors this codebase's existing `ShopLink` concept. */
export type SearchPageResult = {
  url: string;
  title: string;
  content: string;
};

export type SearchProviderResult = {
  images: SearchProductCandidate[];
  pages: SearchPageResult[];
};

export interface SearchProvider {
  /** Human-readable name for logging (e.g. "openai-web-search", "tavily"). */
  readonly name: string;
  /**
   * Runs one real web search for the given free-text query and returns
   * real candidates only — implementations must never fabricate a
   * product, price, or URL that wasn't actually present in a real search
   * result. `includeDomains`, when given, is a ranking HINT only (neither
   * provider can guarantee results are restricted to these domains — this
   * was confirmed live for Tavily, see search-dresses.ts, and is assumed
   * equally true for OpenAI's web_search tool since no provider's search
   * API in this codebase has ever been confirmed to hard-filter by
   * domain).
   */
  search(query: string, maxResults: number, includeDomains?: string[]): Promise<SearchProviderResult>;
}
