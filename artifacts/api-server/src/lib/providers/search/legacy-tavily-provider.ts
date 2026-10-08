// Legacy SearchProvider implementation — wraps the original real-dress-search
// branch's Tavily integration (lib/tavily-client.ts) UNCHANGED, just adapted
// to this provider interface. Kept as an explicit opt-in fallback
// (SEARCH_PROVIDER=tavily) rather than deleted, per direct product
// direction: OpenAI web_search is now the default, but Tavily's existing,
// already-verified behavior (see search-dresses.ts's extensive doc comments
// on what's been confirmed live about it) should stay available and
// switchable, not lost.

import { tavilySearch } from "../../tavily-client";
import type { SearchProvider, SearchProviderResult, SearchProductCandidate, SearchPageResult } from "./search-provider";

export class LegacyTavilySearchProvider implements SearchProvider {
  readonly name = "tavily";

  async search(query: string, maxResults: number, includeDomains?: string[]): Promise<SearchProviderResult> {
    const { images, results } = await tavilySearch(query, maxResults, includeDomains);

    const mappedImages: SearchProductCandidate[] = images.map((img) => ({
      imageUrl: img.url,
      title: img.title,
      description: img.description,
    }));
    const pages: SearchPageResult[] = results.map((r) => ({
      url: r.url,
      title: r.title,
      content: r.content,
    }));

    return { images: mappedImages, pages };
  }
}
