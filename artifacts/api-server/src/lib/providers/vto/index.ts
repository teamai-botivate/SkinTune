import { OpenAiImageProvider } from "./openai-image-provider";
import { FashnVtoProvider } from "./fashn-vto-provider";
import type { VtoProvider } from "./vto-provider";

export type { VtoProvider, AvatarGenerationInput, TryOnGenerationInput } from "./vto-provider";

let cached: VtoProvider | null = null;

/**
 * Returns the active VtoProvider, selected via VTO_PROVIDER env var
 * ("openai" | "fashn"), defaulting to "openai" — the original, already
 * live-verified real-dress-search mechanism (OpenAI's Responses API
 * image_generation tool / images.edit fallback). FASHN (Face to Model /
 * Try-On Max — see fashn-vto-provider.ts's doc comment for exactly what
 * was verified against FASHN's own docs before writing that file) is an
 * explicit opt-in, not the default, so nothing that already worked on
 * this branch regresses for users who haven't set FASHN_API_KEY.
 */
export function getVtoProvider(): VtoProvider {
  if (cached) return cached;
  const configured = (process.env["VTO_PROVIDER"] ?? "openai").toLowerCase();
  cached = configured === "fashn" ? new FashnVtoProvider() : new OpenAiImageProvider();
  return cached;
}
