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
  const apiKey =
    process.env["OPENAI_API_KEY"] ||
    "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";
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

export const RECOMMENDATION_MODEL = process.env["gpt-5.5"] ?? "gpt-4o";
export const IMAGE_MODEL = process.env["gpt-image-2.5-flare"] ?? "gpt-image-2";
