// Virtual try-on / avatar-generation provider abstraction — lets the actual
// image-generation mechanism behind /api/avatar/create and /api/try-on be
// swapped without touching either route's business logic (schema
// validation, error handling, response shape).
//
// Two implementations exist:
//   - OpenAiImageProvider (openai-image-provider.ts) — the ORIGINAL,
//     already-verified real-dress-search mechanism: OpenAI's Responses API
//     image_generation tool (primary) / images.edit (fallback), using
//     this codebase's own hand-written identity-preservation prompts.
//     Kept as the default so nothing that already worked regresses.
//   - FashnVtoProvider (fashn-vto-provider.ts) — FASHN's real Face to
//     Model / Try-On Max endpoints (POST /v1/run + GET /v1/status/{id}),
//     verified directly against https://docs.fashn.ai's own API reference
//     pages before writing any code — see that file's doc comment for
//     exactly what was confirmed and how.
//
// Selected via VTO_PROVIDER env var ("openai" | "fashn"), defaulting to
// "openai" — see getVtoProvider() in index.ts. This mirrors the
// lib/providers/search/ pattern already established on this branch for the
// exact same reason: swap a provider without an application-wide rewrite,
// and never fabricate a provider's API against a guess.

export interface AvatarGenerationInput {
  /** The user's raw selfie (base64 data URL or remote URL). */
  photoUrl: string;
  /** Loose styling context (build, etc.) — providers may ignore fields they don't use. */
  bodyBuild?: string;
}

export interface TryOnGenerationInput {
  /** The user's avatar/identity reference photo (base64 data URL or remote URL) — NOT necessarily the raw selfie; see this branch's avatar-reuse design. */
  avatarImageUrl: string;
  /** The real garment's own product photo (usually a remote https URL from search results). */
  garmentImageUrl: string;
  /** Loose styling/occasion context — providers may ignore fields they don't use. */
  context?: {
    occasion?: string;
    bodyBuild?: string;
    fit?: string;
    pronouns?: string;
    garmentTitle?: string;
    garmentSiteName?: string;
  };
}

export interface VtoProvider {
  readonly name: string;
  /** Generates one clean, identity-preserving avatar/reference photo from a raw selfie — no garment involved. */
  generateAvatar(input: AvatarGenerationInput): Promise<string>;
  /** Generates one try-on image: the given avatar/identity photo, wearing the given real garment. */
  generateTryOn(input: TryOnGenerationInput): Promise<string>;
}
