// FASHN VtoProvider implementation — a specialized, purpose-built
// virtual-try-on/fashion-avatar API, per this branch's product spec's
// explicit direction to use one instead of (or alongside) OpenAI's
// general-purpose image editing.
//
// EVERY field/endpoint/status value used below was verified directly
// against FASHN's own published documentation before writing this file —
// none of it is guessed or copied from a possibly-outdated example. Method:
//   - https://docs.fashn.ai/api-overview/api-fundamentals — base URL
//     (https://api.fashn.ai), auth header ("Authorization: Bearer <key>"),
//     the exact documented POST /v1/run curl example, and the five
//     documented status values (starting/in_queue/processing/completed/
//     failed).
//   - https://docs.fashn.ai/api-reference/face-to-model — the
//     "face-to-model" model_name and its exact `inputs` schema
//     (face_image required; prompt/aspect_ratio/resolution/
//     generation_mode/seed/num_images/output_format/return_base64 all
//     optional) and response shape (`output.images: string[]`).
//   - https://docs.fashn.ai/api-reference/tryon-max — the "tryon-max"
//     model_name and its exact `inputs` schema (product_image + model_image
//     required; resolution/generation_mode/seed/num_images/output_format/
//     return_base64/prompt all optional) and response shape
//     (`output: string[]`, NOT nested under `.images` — the two endpoints'
//     response shapes genuinely differ, confirmed by reading both pages
//     rather than assuming they'd match).
//   - https://docs.fashn.ai/api-overview/error-handling — the exact
//     API-level error shape ({error, message}) and the exact runtime-
//     failure shape ({id, status: "failed", error: {name, message}}).
//   - The exact GET /v1/status/{id} polling path was confirmed via the
//     error-handling page's own worked example ("poll /v1/status/{id}")
//     rather than a full curl snippet, since no single page happened to
//     show one — this is the one detail with slightly less direct
//     confirmation than the others; if predictions ever come back with a
//     404 on the status call specifically, re-check this exact path
//     against the live docs first.
//
// NOT selected by default (VTO_PROVIDER must be explicitly set to
// "fashn") — see vto-provider.ts's module doc comment for why
// OpenAiImageProvider stays the default. This provider also requires a
// separate FASHN_API_KEY; getFashnApiKey() throws a clear error if it's
// missing, the same fail-loud pattern getOpenAIClient() already uses for
// OPENAI_API_KEY.

import { logger } from "../../logger";
import type { AvatarGenerationInput, TryOnGenerationInput, VtoProvider } from "./vto-provider";

const FASHN_BASE_URL = "https://api.fashn.ai";

function getFashnApiKey(): string {
  const key = process.env["FASHN_API_KEY"];
  if (!key) {
    throw new Error(
      "FASHN_API_KEY is not set. Configure it as an environment variable to use VTO_PROVIDER=fashn.",
    );
  }
  return key;
}

type FashnRunResponse = { id: string; error: string | null };
type FashnStatusResponse =
  | { id: string; status: "starting" | "in_queue" | "processing"; output: null; error: null }
  | { id: string; status: "completed"; output: unknown; error: null }
  | { id: string; status: "failed"; output: null; error: { name: string; message: string } };

async function fashnRun(modelName: string, inputs: Record<string, unknown>): Promise<string> {
  const apiKey = getFashnApiKey();
  const res = await fetch(`${FASHN_BASE_URL}/v1/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model_name: modelName, inputs }),
  });
  const body = (await res.json().catch(() => null)) as (FashnRunResponse & { error?: string; message?: string }) | null;
  if (!res.ok || !body?.id) {
    // API-level error shape confirmed on docs.fashn.ai/api-overview/error-handling: {"error": "UnauthorizedAccess", "message": "..."}.
    throw new Error(`FASHN ${modelName} run failed: ${res.status} ${body?.message ?? body?.error ?? "unknown error"}`);
  }
  return body.id;
}

/**
 * Polls GET /v1/status/{id} until the prediction is completed or failed.
 * FASHN's own documented rate limit for this endpoint is 50 requests per
 * 10 seconds, so a 2-second poll interval stays comfortably under that
 * even with several concurrent try-ons in flight. No documented maximum
 * wait time exists on FASHN's side, so this enforces its own generous
 * ceiling (2 minutes) rather than polling forever if a prediction somehow
 * never resolves — matching this codebase's existing preference for
 * failing loudly and visibly over hanging silently (see CLAUDE.md's
 * "Generating screen used to hang forever" fix elsewhere in this repo).
 */
async function fashnPollUntilDone(id: string): Promise<unknown> {
  const apiKey = getFashnApiKey();
  const deadline = Date.now() + 2 * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(`${FASHN_BASE_URL}/v1/status/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = (await res.json().catch(() => null)) as FashnStatusResponse | null;
    if (!res.ok || !body) {
      throw new Error(`FASHN status poll failed: ${res.status}`);
    }
    if (body.status === "completed") return body.output;
    if (body.status === "failed") {
      // Runtime-failure shape confirmed on docs.fashn.ai/api-overview/error-handling:
      // {"id": "...", "status": "failed", "error": {"name": "ImageLoadError", "message": "..."}}.
      throw new Error(`FASHN prediction failed: ${body.error?.name ?? "UnknownError"} — ${body.error?.message ?? "no message"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`FASHN prediction ${id} did not complete within 2 minutes`);
}

export class FashnVtoProvider implements VtoProvider {
  readonly name = "fashn";

  async generateAvatar({ photoUrl }: AvatarGenerationInput): Promise<string> {
    // face-to-model inputs schema confirmed on docs.fashn.ai/api-reference/face-to-model:
    // face_image (required), prompt/aspect_ratio/resolution/generation_mode/
    // seed/num_images/output_format/return_base64 (all optional, defaults
    // used here except aspect_ratio — "3:4" chosen over the endpoint's own
    // "2:3" default since it's a slightly less extreme vertical crop for a
    // full-length reference photo, still within the endpoint's documented
    // vertical-ratio options).
    const id = await fashnRun("face-to-model", {
      face_image: photoUrl,
      aspect_ratio: "3:4",
      resolution: "1k",
      output_format: "jpeg",
    });
    const output = await fashnPollUntilDone(id);
    // Response shape confirmed on docs.fashn.ai/api-reference/face-to-model:
    // {"output": {"images": ["https://cdn.fashn.ai/..."]}} — nested under
    // `.images`, unlike tryon-max's flat array below. Do not assume these
    // two endpoints' output shapes match without re-checking their own
    // pages — they were confirmed to differ.
    const images = (output as { images?: string[] } | null)?.images;
    const imageUrl = images?.[0];
    if (!imageUrl) {
      logger.error({ output }, "FASHN face-to-model completed but returned no image");
      throw new Error("FASHN face-to-model returned no image");
    }
    return imageUrl;
  }

  async generateTryOn({ avatarImageUrl, garmentImageUrl }: TryOnGenerationInput): Promise<string> {
    // tryon-max inputs schema confirmed on docs.fashn.ai/api-reference/tryon-max:
    // product_image + model_image (both required), resolution/
    // generation_mode/seed/num_images/output_format/return_base64/prompt
    // (all optional, defaults used here).
    const id = await fashnRun("tryon-max", {
      model_image: avatarImageUrl,
      product_image: garmentImageUrl,
      resolution: "1k",
      output_format: "jpeg",
    });
    const output = await fashnPollUntilDone(id);
    // Response shape confirmed on docs.fashn.ai/api-reference/tryon-max:
    // {"output": ["https://cdn.fashn.ai/..."]} — a flat array, NOT nested
    // under `.images` the way face-to-model's is. This asymmetry between
    // the two endpoints' response shapes was verified by reading both
    // pages directly, not assumed from one applying to the other.
    const images = output as string[] | null;
    const imageUrl = images?.[0];
    if (!imageUrl) {
      logger.error({ output }, "FASHN tryon-max completed but returned no image");
      throw new Error("FASHN tryon-max returned no image");
    }
    return imageUrl;
  }
}
