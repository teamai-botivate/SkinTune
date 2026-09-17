import { OpenAiWebSearchProvider } from "./openai-web-search-provider";
import { LegacyTavilySearchProvider } from "./legacy-tavily-provider";
import type { SearchProvider } from "./search-provider";

export type { SearchProvider, SearchProviderResult, SearchProductCandidate, SearchPageResult } from "./search-provider";

let cached: SearchProvider | null = null;

/**
 * Returns the active SearchProvider, selected via SEARCH_PROVIDER env var
 * ("openai" | "tavily"), defaulting to "openai" per direct product
 * direction: GPT-based web search replaces Tavily as the default web
 * research mechanism for /api/search-dresses. Tavily remains available as
 * an explicit opt-in (SEARCH_PROVIDER=tavily) rather than being deleted —
 * see legacy-tavily-provider.ts's doc comment.
 */
export function getSearchProvider(): SearchProvider {
  if (cached) return cached;
  const configured = (process.env["SEARCH_PROVIDER"] ?? "openai").toLowerCase();
  cached = configured === "tavily" ? new LegacyTavilySearchProvider() : new OpenAiWebSearchProvider();
  return cached;
}
