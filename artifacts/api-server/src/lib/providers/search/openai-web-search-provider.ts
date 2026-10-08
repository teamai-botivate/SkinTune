// Default SearchProvider implementation — OpenAI's Responses API `web_search`
// tool, per explicit product direction to move off Tavily as the default.
//
// The `web_search` tool type is REAL and confirmed present on the currently
// installed `openai` SDK (v6.49.0 at the time this was written) — verified
// directly against that package's own shipped type definitions
// (node_modules/openai/resources/responses/responses.d.ts: `WebSearchTool`,
// `type: 'web_search' | 'web_search_2025_08_26'`, part of the `Tool` union
// accepted by `openai.responses.create`'s `tools` array), NOT assumed from
// memory or copied from a possibly-outdated example. If this SDK is ever
// upgraded and this type disappears or changes shape, re-verify against the
// new version's own `.d.ts` file the same way before changing this code.
//
// Unlike Tavily's /search endpoint (one HTTP call, gets back images[] AND
// results[] together), the Responses API's web_search tool runs INSIDE a
// model turn: the model decides what to search, the tool returns pages, and
// the model's own message narrates/cites them via annotations. There is no
// direct "give me raw image URLs" mode — so this provider asks the model to
// browse and then report back a strict-JSON list of the real candidates it
// found (page URL, title, image URL if visible on the page, price if
// visible), rather than trying to intercept the tool's raw results. This
// keeps the contract "real data only, never fabricated" enforceable via the
// same structured-output + prompt discipline already used elsewhere in this
// codebase (see analyze-photo.ts, try-on.ts) — the model is explicitly
// instructed never to invent a field it didn't actually see on a real page.

import { getOpenAIClient, RECOMMENDATION_MODEL } from "../../openai-client";
import { logger } from "../../logger";
import type { SearchProvider, SearchProviderResult, SearchProductCandidate, SearchPageResult } from "./search-provider";

const RESULT_JSON_SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pageUrl: { type: "string", description: "The real, actual URL of the page this product was found on. Never invent or guess a URL." },
          imageUrl: { type: ["string", "null"], description: "A real, actual product image URL visible on/via that page, if one was genuinely found. Null if none was found — never invent one." },
          title: { type: ["string", "null"], description: "The real product title/name as it actually appears, or null if not clearly known." },
          description: { type: ["string", "null"], description: "A short real description/snippet actually seen on the page, or null." },
          price: { type: ["string", "null"], description: "The real price exactly as seen on the page (with currency symbol), or null if no price was actually visible. Never estimate or guess a price." },
        },
        required: ["pageUrl", "imageUrl", "title", "description", "price"],
        additionalProperties: false,
      },
    },
  },
  required: ["products"],
  additionalProperties: false,
} as const;

/** Extracts the hostname from a URL, or undefined if it isn't a valid absolute URL. */
function hostnameOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export class OpenAiWebSearchProvider implements SearchProvider {
  readonly name = "openai-web-search";

  async search(query: string, maxResults: number, includeDomains?: string[]): Promise<SearchProviderResult> {
    const openai = getOpenAIClient();

    const domainHint = includeDomains?.length
      ? ` Prefer results from these sites when relevant, but you may include other genuinely relevant real shopping sites too if you find them: ${includeDomains.join(", ")}.`
      : "";

    const response = await openai.responses.create({
      model: RECOMMENDATION_MODEL,
      tools: [{ type: "web_search" }],
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `Search the real web for: ${query}.${domainHint} ` +
                `Find up to ${maxResults} REAL, currently-listed products (not discontinued/unavailable pages, not blog posts, not guides) — actual product pages on actual online stores. ` +
                `After searching, report back ONLY what you actually found on real pages: for each product, its real page URL, a real product image URL if one is visible, its real title, a short real description, and its real price if one was actually visible on the page. ` +
                `Do NOT invent, estimate, or guess ANY of these fields — if you didn't actually see a price, image, or exact title on a real page, use null for that field rather than making something up. ` +
                `Do not include duplicate pages for the same product.`,
            },
          ],
        },
      ],
      // Structured output on the FINAL message, after the model has already
      // used the web_search tool internally — this is the Responses API's
      // standard pattern for "use a tool, then report structured results",
      // not a special search-specific mechanism.
      text: {
        format: {
          type: "json_schema",
          name: "web_search_products",
          strict: true,
          schema: RESULT_JSON_SCHEMA,
        },
      },
      // Raised from 4000 to 10000 — confirmed live (Render logs, first
      // production deploy of this provider) that 4000 was too low:
      // real requests came back with `SyntaxError: Unterminated string in
      // JSON`, meaning the model's visible JSON output was cut off
      // mid-string by hitting this token ceiling. This is the SAME root
      // cause pattern documented repeatedly elsewhere in this codebase
      // (analyze-photo.ts, try-on.ts, search-dresses.ts's
      // filterByImageContent) — gpt-5.5 is a reasoning-model-family model
      // whose internal reasoning tokens count against this same budget,
      // and this call is a genuinely heavier one than any of those: it
      // has to actually RUN the web_search tool (real HTTP calls to real
      // pages, each one consuming reasoning/tool-call tokens) potentially
      // several times before it can even start writing the final JSON
      // list of products. 10000 is a generous first correction, not a
      // proven-sufficient value — if truncated-JSON warnings still appear
      // after this ships, raise it further (the log now includes
      // finish_reason specifically to confirm this is still the cause
      // before assuming something else broke).
      max_output_tokens: 10000,
    });

    const raw = response.output_text?.trim();
    if (!raw) {
      logger.warn(
        { query, incompleteReason: response.incomplete_details?.reason, status: response.status },
        "OpenAI web search returned no structured output; treating as zero results",
      );
      return { images: [], pages: [] };
    }

    let parsed: { products: Array<{ pageUrl: string; imageUrl: string | null; title: string | null; description: string | null; price: string | null }> };
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // Logging the raw output's length and last 200 chars (not the whole
      // thing — could be large) specifically so a truncation can be
      // visually confirmed from the log (a string cut off mid-value, no
      // closing braces) without needing to reproduce the request.
      logger.warn(
        {
          err,
          query,
          rawLength: raw.length,
          rawTail: raw.slice(-200),
          incompleteReason: response.incomplete_details?.reason,
          status: response.status,
        },
        "OpenAI web search returned unparseable JSON; treating as zero results",
      );
      return { images: [], pages: [] };
    }

    const images: SearchProductCandidate[] = [];
    const pages: SearchPageResult[] = [];
    for (const product of parsed.products ?? []) {
      const domain = hostnameOf(product.imageUrl ?? undefined) ?? hostnameOf(product.pageUrl);
      if (product.imageUrl) {
        images.push({
          imageUrl: product.imageUrl,
          pageUrl: product.pageUrl,
          title: product.title ?? undefined,
          description: product.description ?? undefined,
          sourceDomain: domain,
          price: product.price ?? undefined,
        });
      }
      // Every product with a real page URL also becomes a page-level
      // result (mirrors Tavily's separate results[] array) even if it had
      // no product image, so buildShopLinks-equivalent logic downstream
      // still has something to show.
      if (product.pageUrl) {
        pages.push({
          url: product.pageUrl,
          title: product.title ?? product.pageUrl,
          content: product.description ?? "",
        });
      }
    }

    logger.debug({ query, imageCount: images.length, pageCount: pages.length }, "OpenAI web search complete");
    return { images, pages };
  }
}
