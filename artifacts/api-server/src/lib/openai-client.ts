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
export const RECOMMENDATION_MODEL = process.env["OPENAI_TEXT_MODEL"] ?? "gpt-5.5";
export const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL"] ?? "gpt-image-2";
