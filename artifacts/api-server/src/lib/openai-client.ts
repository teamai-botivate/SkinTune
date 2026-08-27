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

export const RECOMMENDATION_MODEL = process.env["OPENAI_TEXT_MODEL"] ?? "gpt-4o";
export const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL"] ?? "gpt-image-2";
