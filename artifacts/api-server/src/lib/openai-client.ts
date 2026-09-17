import OpenAI from "openai";

let client: OpenAI | null = null;

/**
 * Lazily-constructed singleton OpenAI client. Throws only when a route
 * actually needs it and OPENAI_API_KEY is missing — the server can still
 * boot and serve everything else (health check, static frontend) without
 * the key configured.
 */
export function getOpenAIClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Configure it as an environment variable " +
        "(e.g. in the Render dashboard) to enable AI recommendations and " +
        "image generation.",
    );
  }
  client = new OpenAI({ apiKey });
  return client;
}

// gpt-4o specifically requires OpenAI organization verification when used
// via the Responses API's image_generation tool (see try-on.ts/
// generate-image.ts) — confirmed live: a direct API call with model:
// "gpt-4o" returned a 403 "organization must be verified" error on this
// exact account, while the identical call with model: "gpt-5.5" succeeded
// immediately, no verification needed. gpt-5.5 supports everything this
// codebase needs from a text/vision model (image input, structured JSON
// outputs, function calling), so it's the default here instead of gpt-4o.
// If this is ever changed back to gpt-4o (or another model), re-verify
// against the live API first — this exact model-specific gap was the root
// cause of a real, repeated production issue, not a hypothetical.
//
// OPENAI_REASONING_MODEL is the preferred env var name going forward (the
// "reasoning/orchestration brain" role described in this branch's avatar+
// search+try-on product spec — search-intent generation, web search
// orchestration, styling decisions) — OPENAI_TEXT_MODEL is kept as a
// fallback alias so existing deployments that already set it don't need
// to change anything. Whatever model name is put here (e.g. a future
// "gpt-5.6-terra" or similar) MUST be verified against the live OpenAI API
// first, the same way gpt-5.5 vs gpt-4o was verified above — do not assume
// a model name from a spec or prompt is real or available on this account
// without checking; an unverified model id was deliberately NOT hardcoded
// here for that reason. gpt-5.5 stays the default until a replacement is
// actually confirmed to work.
export const RECOMMENDATION_MODEL =
  process.env["OPENAI_REASONING_MODEL"] ?? process.env["OPENAI_TEXT_MODEL"] ?? "gpt-5.5";
// Optional fallback model — if set, callers that implement a fallback path
// (none do yet; this is scaffolding for when one is needed) can retry with
// this model after a primary-model failure. Not required for this branch's
// current feature set; see openai-client.ts's module doc comment history
// in CLAUDE.md for why a speculative fallback wasn't force-wired in yet.
export const RECOMMENDATION_FALLBACK_MODEL = process.env["OPENAI_REASONING_FALLBACK_MODEL"] || undefined;
export const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL"] ?? "gpt-image-2";
