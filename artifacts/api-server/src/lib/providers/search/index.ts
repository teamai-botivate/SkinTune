import { OpenAiWebSearchProvider } from "./openai-web-search-provider";
import { LegacyTavilySearchProvider } from "./legacy-tavily-provider";
import type { SearchProvider } from "./search-provider";

export type { SearchProvider, SearchProviderResult, SearchProductCandidate, SearchPageResult } from "./search-provider";

let cached: SearchProvider | null = null;

/**
 * Returns the active SearchProvider, selected via SEARCH_PROVIDER env var
 * ("openai" | "tavily"), defaulting to "tavily".
 *
 * This default was FLIPPED back to "tavily" per direct, explicit cost-based
 * product direction — the OpenAI web_search-based provider was tried as the
 * default (see this file's original doc comment history in CLAUDE.md for
 * why it was tried), but each search action fans out into several real
 * OpenAI Responses API calls that each have to actually run the web_search
 * tool (real multi-page browsing) before returning anything, which turned
 * out to be both meaningfully slower AND meaningfully more expensive per
 * search than Tavily's direct search API ever was — confirmed live via
 * Render logs (search times of 3-5+ minutes) and via a real cost analysis
 * once actual token/tool-call pricing was worked out. The user's explicit
 * instruction: "AI web search nhi chahaiye ye bahut Rs lag raha h, tavily
 * hi use karo" (don't want AI web search, it costs too much, use Tavily).
 * `OpenAiWebSearchProvider` is NOT deleted — it's kept as an explicit
 * opt-in (SEARCH_PROVIDER=openai) for anyone who wants GPT-based search
 * again later, the same way Tavily was kept as an opt-in during the
 * previous default. Do not flip this default back to "openai" without
 * discussing the cost tradeoff again first — that's exactly what
 * triggered this revert.
 */
export function getSearchProvider(): SearchProvider {
  if (cached) return cached;
  const configured = (process.env["SEARCH_PROVIDER"] ?? "tavily").toLowerCase();
  cached = configured === "openai" ? new OpenAiWebSearchProvider() : new LegacyTavilySearchProvider();
  return cached;
}
