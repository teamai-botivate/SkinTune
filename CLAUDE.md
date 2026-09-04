# SkinTune — CLAUDE.md

Guidance for Claude Code (or any agent) working in this repo.

## What this is

SkinTune is a personal appearance-intelligence product. A user answers a
short, tap-driven wizard (appearance, body/fit, taste, colours, occasion,
context, desired impression, budget) and gets 5 personalized complete-look
recommendations (outfit, colour, jewellery, hairstyle, makeup, accessories).

**Explicitly out of scope on `main` — do not add these:** wardrobe
digitisation, wardrobe upload, real-time try-on, medical/diagnostic claims,
beauty scoring. The product is about confidence and expression, not
judgement.

**The `real-dress-search` branch is a deliberate, explicit exception to
"no real-time try-on"** — see "Real-dress-search branch" near the bottom of
this file. That branch replaces the 5-AI-generated-look flow with real web-
sourced dresses and a real try-on visualisation, per direct product
direction. Wardrobe upload, medical/diagnostic claims, and beauty scoring
remain out of scope even there.

## Repo layout (pnpm workspace monorepo)

```
artifacts/
  skintune/          the actual product frontend (React + Vite + Tailwind v4)
  api-server/         Express 5 API; also serves the built frontend in prod
  mockup-sandbox/      Replit design-preview scaffold — not shipped product
lib/
  api-spec/            OpenAPI spec (Orval codegen source)
  api-zod/              generated Zod schemas from the spec
  api-client-react/     generated React Query hooks from the spec (unused by skintune today)
  db/                   Drizzle ORM + Postgres scaffold (schema currently empty)
scripts/               trivial workspace script package
Dockerfile              single-service deploy image (frontend + API in one container)
```

The **real product code** lives entirely in `artifacts/skintune/src/`. Read
`artifacts/skintune/README.md` for the frontend's own architecture notes
(state, services, mock data, image-generation boundary).

## Frontend architecture (artifacts/skintune)

- **No router.** Navigation is a hand-rolled `Screen` state machine in
  `App.tsx` (`useState<Screen>` + a `go()`/`back()` pair). `wouter` is
  installed but intentionally unused — don't wire it in without discussing;
  the state-machine approach is deliberate and keeps the WhatsApp-style
  one-question-at-a-time flow simple.
- **Wizard steps are generic, not duplicated per field.** `SingleChoiceStep`,
  `MultiChoiceStep`, `HeightStep`, and `SectionStep` (in `App.tsx`) are
  reused across every onboarding screen, driven by option lists in
  `src/data/options.ts`. Don't hand-roll a new one-off step component for a
  single-choice or multi-choice field — extend a generic step (or a
  section's `fields` array) with a new entry instead.
- **Single-choice steps auto-advance; sections don't.** Tapping an option in
  a standalone `SingleChoiceStep` both selects it and calls `onNext()` after
  a short delay — this is intentional (tap → next, no separate "Continue"
  tap). The footer Continue button is kept only as a fallback for
  keyboard/assistive-tech users. Fields inside a `SectionStep` never
  auto-advance, even single-choice ones — a section holds several questions
  on one page, so advancing on the first tap would skip the rest before the
  user could answer them. One Continue button per section, gated on that
  section's required fields.
- **After the photo step, questions are grouped into 3 section screens, not
  11 individual ones.** `body-style` (build, fit, style), `colors-occasion`
  (colours loved/avoided, restrictions, occasion), `final-prefs`
  (impression, budget) — each is one `SectionStep` call with a `fields`
  array, not separate `Screen` entries. This exists specifically to cut
  onboarding time after photo upload; if a new field belongs conceptually
  with one of these three groups, add it to that section's `fields` array
  rather than creating a new standalone screen. `SectionField`'s
  `kind: 'single' | 'multi' | 'text'` covers everything currently needed (a
  plain textarea uses `'text'`); required defaults to `true` — pass
  `required: false` for optional fields (e.g. colours to avoid,
  restrictions).
- **`priorities` (Style First/Comfort First/Balance Both) and
  `occasionDetails` (free-text notes) were removed from `SkinTuneProfile`
  entirely** — not just made optional — to cut required onboarding taps
  further per explicit product direction ("kam se kam fill karna pare and
  sb kuch ussi me Agent samjh jaaye"). The recommendation engine now infers
  a sensible style/comfort balance from the user's `style` and `impression`
  choices, and infers reasonable occasion context from the `occasion` word
  alone — see `buildUserPrompt`'s "infer" instruction in
  `artifacts/api-server/src/routes/recommendations.ts`. Do not re-add
  either field without also removing that inference instruction, or the
  model will get conflicting signals. Name, age, gender/pronouns, height,
  and budget were explicitly confirmed as NOT candidates for this kind of
  cut — they stay required, real questions.
- **Photo analysis** (`PhotoPanel` in `App.tsx`) shows staged "Analyzing…"
  copy (`src/data/photo-diagnostics.ts`), then either a good-photo appearance
  read or a specific, explainable problem (Problem / Why it matters / How to
  improve) with a Retry CTA. It never shows a generic "photo rejected"
  message.
- **Recommendation engine vs. image generation are separate services** — see
  below. UI components only ever call these two functions; they never talk
  to a specific model/provider directly.
- **`Generating` (`App.tsx`) cycles through stages on repeat, it doesn't run
  once and stop.** Real generation (5 images at `quality: "high"` — see
  below) takes ~90-100s+ total, but the original version's 4 stages
  finished advancing in ~2.5s and then sat frozen on the last one for the
  rest of the wait, reading as stuck rather than working. It now loops
  through a longer stage list indefinitely, shows a live elapsed-time
  counter instead of a static "usually takes less than a minute" (which was
  no longer true once quality was bumped to high), and has a continuously
  animated spinner + indeterminate progress bar so the screen visibly stays
  alive for the whole real wait, however long that turns out to be.

### Theme (`src/index.css`)

**Deep luxury palette** — near-black charcoal background, warm ivory text,
gold/champagne primary/accent. This is the app's one and only palette;
there is no light/dark toggle in the UI, so the `:root` custom properties
in `index.css` ARE the theme (not an override of some other default). A
previous prototype had an unused `.dark` class variant with different
values and no toggle ever invoked it — that's been removed; if a
light/dark toggle is ever added, add it back as a real `.light`/`.dark`
pair driven by actual UI state, not dead CSS. Nearly all colour usage in
`App.tsx` goes through the `bg-background`/`text-foreground`/`bg-primary`/
etc. Tailwind utilities that resolve to these tokens — a few genuinely
decorative spots (the `Welcome` screen's abstract skin-tone illustration,
`LookVisual`'s CSS-gradient placeholder before a real image arrives) use
literal hex values on purpose since they represent a person's colouring or
a look's actual palette, not UI chrome, and shouldn't follow the site
theme. When changing the theme again, grep `App.tsx` for `bg-\[#` to find
any hardcoded hex that IS UI chrome (there have been stragglers before —
e.g. the `Generating` screen used to hardcode its own dark colours instead
of using tokens) and convert those, but leave the person/look-representing
ones alone.

### `src/services/recommendation-engine.ts`

Owns the *styling decision*: given a `SkinTuneProfile`, returns 5
`LookRecommendation` objects (outfit, colour, jewellery, hairstyle, makeup,
accessories, reasoning). Calls the backend's `POST /api/recommendations`
(GPT-4o, strict JSON-schema structured output — see
`artifacts/api-server/src/routes/recommendations.ts`); on any failure (no
`OPENAI_API_KEY` configured, network issue, provider error) it falls back to
a curated static mock set so the UI never dead-ends.

### `src/services/image-generation.ts`

Owns *visualising* those decisions. `generateLookImages(recommendations,
profile, context)` calls the backend's `POST /api/generate-image` **once per
look** (OpenAI `gpt-image-2` — see
`artifacts/api-server/src/routes/generate-image.ts`), in parallel, not one
batched request for all 5. Each look falls back independently to its
existing placeholder `imageUrl` if its own request fails, so one failure
never blocks the other four.

**Sends `profile.photoUrl` (unlike `recommendation-engine.ts`, which strips
it)** — the backend calls OpenAI's `images.edit` on that photo, so the
generated look shows THE SAME PERSON re-dressed, not a stranger from a text
prompt. This is deliberate and required for the product's core promise; if
the user skipped the photo step, the backend falls back to text-to-image
generation via `images.generate` (still usable as a style visualisation,
just won't resemble the user). Verified live: an edit call against a real
reference photo returned an image with the same face/hair/build, correctly
re-dressed per the look's outfit — see git history around this change.

`gpt-image-2`'s `images.edit` does **not** support the `input_fidelity`
parameter (confirmed against the live API with a 400, despite some docs
describing it for the gpt-image family generally — it's `gpt-image-1`/
`1.5`-only) — don't add it back without re-verifying against whatever model
is current at the time.

**Identity preservation is fragile and composition-dependent — this was a
real production bug.** `images.edit` does not strongly guarantee the output
face matches the input face; the model has more room to "reinterpret" the
face the further the requested output composition is from the input photo.
A close-up selfie edited into a full-length editorial shot lost the user's
actual face entirely in production. The fix (see `buildLookEditPrompt` in
`generate-image.ts`) was two things together, not prompting alone:
1. Very explicit, repeated identity instructions — stated up front AND
   restated at the end of the prompt (both ends of a prompt get weighted
   more heavily than the middle).
2. **Requesting waist-up/portrait framing instead of full-length.** This is
   the bigger lever: a smaller transformation from a typical selfie's
   framing empirically preserves the face far better than asking for a
   full-length editorial shot. Verified by generating a synthetic
   selfie-style reference photo (close-up, low angle, distinctive facial
   hair, matching a real user's actual upload style) and confirming the
   edited output kept the same face, hair, and build.

If you ever need full-length shots again, expect identity drift to return
and budget time to re-solve it (e.g. multi-step composition, or accepting
the tradeoff with a clear UI disclaimer) rather than assuming the current
prompt generalizes to a bigger transformation.

**Even with the waist-up prompt fix above, `images.edit` was still a
noticeably weaker face match than it should be.** The real fix was the API
path, not just the prompt: `generate-image.ts` now tries the **Responses
API's `image_generation` tool first** (`editViaResponsesApi`), with
`detail: 'original'` on the input image (skips any downscaling before the
model sees the photo) and `quality: 'high'` on the tool. This is a
genuinely different, better result — verified side-by-side against the
same selfie-style test photo: the Responses API output preserved the
hairline, eyebrow shape, mustache pattern, and even a facial mole; the
`images.edit` output on the same input photo did not preserve those as
well. Do not treat `images.edit` as "the fix" — it's the fallback now, kept
only for when the Responses API path is unavailable (see below).

**The Responses API's `image_generation` tool requires the OpenAI
organization to be "Verified"** (platform.openai.com → Settings →
Organization → Verify Organization) — an unverified org gets a 403
("Your organization must be verified to use the model...") on every call.
This is a real, confirmed constraint, not a hypothetical: it blocked this
route in this exact deployment before verification. `generate-image.ts`
therefore tries `editViaResponsesApi` first and, on ANY failure (403,
network error, malformed response, etc.), logs a warning and falls back to
`editViaImagesEdit` — so the feature keeps working (with weaker identity
preservation) rather than failing the whole request while verification is
pending or if it's ever revoked. Once the deploying org is verified, no
code change is needed — the primary path just starts succeeding and the
fallback stops being exercised. Verify this by checking Render logs for
"Responses API image edit failed, falling back to images.edit" warnings —
their absence after verification confirms the primary path is working.

**The edit prompt re-poses the person — it does not preserve the input
photo's camera angle or head position.** Real uploads are often casual
low-angle selfies (phone held low, chin tucked, eyes cast down/sideways).
Preserving that literal angle would carry an unflattering "bad selfie"
composition straight into the styled result. `buildLookEditPrompt` /
`buildFlatteringInstruction` in `generate-image.ts` therefore explicitly
instruct the model to keep the same FACE (identity) but re-compose the pose
at eye-level camera height, chin level, shoulders squared, confident
expression — verified against a deliberately bad-angle test selfie (phone
held below chest, head tilted down and away): the output came back
eye-level, confident, and correctly dressed, with the same face preserved.
`buildFlatteringInstruction` also branches on `profile.pronouns` for
gender-appropriate "at their best" language (beautiful/radiant for women's
styling, handsome/sharp for men's, confident/best-self neutral otherwise) —
always framed around genuine photographic quality (lighting, expression,
grooming polish), never around "fixing" anything, per this product's
language guidelines.

**Outfit fit is called out explicitly too**, in `buildLookEditPrompt` —
"preserve their build" alone only stops the model from altering body shape,
it says nothing about whether the generated garments look tailored to that
build (shoulder line, sleeve/hem length, fabric drape). A dedicated
instruction requires the outfit to look correctly fitted to this specific
person, never pasted-on or cut for a different body shape. Verified live
against both a broad-build and a slim-build reference photo styled in
fitted looks (a tailored blazer, a fitted wrap dress) — the shoulder seams,
collar, and drape follow each person's actual proportions rather than a
generic template.

**Prompt-writing agent** (`writeStylingAddendum` in `generate-image.ts`) —
before building the final edit prompt, a GPT-4o vision call looks at the
user's actual uploaded photo plus their full profile and the look's
styling data, and writes 2-5 sentences of additional photo-specific
styling AND pose/expression detail (e.g. actual apparent shoulder width,
framing, build, plus a pose suggestion matching this look's specific mood)
that a static text template can't know without seeing the photo. This is
strictly additive: the mandatory rules (identity preservation, pose
recomposition, fit-to-build) are always injected by `buildLookEditPrompt`
regardless of what this agent returns, so it can only add nuance, never
weaken or drop a non-negotiable constraint. If the call fails for any
reason, the route logs a warning and continues with the static template
alone — the mandatory rules still apply. Only runs when a photo was
provided (there's nothing for it to look at otherwise). Its output is
logged at `debug` level (`stylingAddendum`) if you need to inspect what it
wrote for a given request. Verified live: with a slim-build reference photo
styled in a fitted evening dress, the addendum-assisted result correctly
fit the actual narrow shoulder line and body proportions, not a generic
template.

**Pose and expression are decided by the vision agent looking at the
actual face, not by a rule-based template — this went through two
iterations, both real production bugs.**

The first version had one fixed pose/expression sentence shared by all 5
looks ("eye-level, chin level, confident expression"), so all 5 results
read as the same photo with different clothes. The fix at the time added
`buildPoseAndEnvironmentInstruction`, which keyword-matched each look's
`category`/`title`/`note`/`reasoning` text against a small set of
pose "families" (candid smile for casual, poised stance for elegant,
etc.) — but in practice this was still too generic/formulaic to visibly
change the output; expressions kept coming out nearly identical across
looks regardless of which family matched, and the failure mode was
explicitly reported by the user as a "cut-paste face" feel — the face
reading as pasted onto a different pose rather than one coherent photo.

The current fix removes the keyword-matched template as the primary
mechanism. `writeStylingAddendum` in `generate-image.ts` is now the
PRIMARY decision-maker for pose/expression/body-language: its system
prompt explicitly instructs the model to act as a photographer/stylist,
genuinely study THIS person's actual face (resting expression, features)
in the uploaded photo, and decide a pose/expression that suits both that
face and this specific look's mood — not fill in a template slot.
`temperature` was raised from 0.5 to 0.8 to reduce convergence toward one
"safe" answer across the 5 parallel per-look calls. The old
`buildPoseAndEnvironmentInstruction` was demoted to
`buildFallbackPoseInstruction` — a deliberately bare generic line, used
ONLY when the addendum agent fails or no photo was provided. Do not
resurrect keyword-matching as the primary mechanism; it was tried and
didn't work — see git history around this fix. `buildLookEditPrompt` also
now has an explicit anti-"cut-paste" instruction (the face must blend
continuously into the neck/jaw/shoulders with consistent lighting/angle,
"one single photograph... not a composite") addressing that failure mode
by name, not just implicitly via the identity-preservation rule.

Verified live: generated two looks (a playful casual outfit and a formal
evening suit) from the SAME neutral-expression reference photo. The
results are genuinely different photographs — different pose, different
hand placement, different setting/background, different head angle — not
just different clothes on an identical stance, and both preserved the same
face with no pasted-look seam.

**Round 2 of this same bug: even with the agent rewrite above, real 5-look
batches from the recommendation engine still produced repetitive
expressions in production.** Root cause, found by pulling a real
`/api/recommendations` response and inspecting it: the 5 looks' actual
`category`/`note`/`reasoning` text was too similar to give the pose agent
anything genuinely distinct to react to (a real response had categories
`Elegant, Modern, Elegant, Minimalist, Bold` — two of five literally
identical — and thin generic `note` values like `"Major match"` /
`"Modern interpretation"`). The pose agent was doing exactly what it was
told (read the look's mood from its text), but the upstream text wasn't
mood-differentiated enough to read from.

Fix: added two new required fields to `LookRecommendationSchema` —
`vibe` (a single mood word, must be 5 different words across the 5 looks,
explicitly forbidden from defaulting to the same
Elegant/Modern/Minimal/Bold/Glamorous rotation every time) and
`personaEnergy` (1-2 vivid, photographer-actionable sentences of how this
person would move/stand/feel in this specific look). `recommendations.ts`'s
system prompt now explicitly states these two fields exist specifically to
drive per-look pose generation, and that near-duplicate energy across
looks produces near-duplicate photos — naming the downstream consequence,
not just asking for "distinct" abstractly. `writeStylingAddendum` in
`generate-image.ts` now receives `look.vibe`/`look.personaEnergy` as
direct input and is told to honor that brief but translate it onto the
actual face in the photo, not just restate it. Both are `.optional()` in
the schema so older cached/mock looks without them still validate; the
mock static looks in `recommendation-engine.ts` were also given real
`vibe`/`personaEnergy` values for consistency when the AI call fails and
that fallback is used.

Verified live: pulled a real `/api/recommendations` response after this
fix — 5 genuinely distinct vibes (`Sophisticated, Chic, Dreamy, Playful,
Serene`) with 5 clearly distinguishable `personaEnergy` descriptions
(different movement, different mood, different expression per look),
compared directly against the earlier repetitive-category response from
the same test payload. If expressions are ever reported as repetitive
again, check the actual `vibe`/`personaEnergy` values in a real
`/api/recommendations` response FIRST — this has now been the root cause
twice, both times upstream of the image-generation code itself.

**Round 3: with vibe/personaEnergy correctly distinct upstream, production
still showed near-identical expressions across all 5 looks AND — a new,
worse symptom — near-identical hairstyles across DIFFERENT USERS
entirely**, reported directly by the user with screenshots of 5 generated
looks that all had the same short side-swept haircut and the same
closed-mouth, direct-camera expression regardless of look mood (formal
office blazer, gold party shirt, casual grey hoodie, etc. all looked the
same face-and-hair-wise). Two separate root causes, found by re-reading
`generate-image.ts` rather than re-tweaking the recommendation engine
again (which was already confirmed correct in round 2):

1. **Hairstyle**: `buildLookEditPrompt`'s only hairstyle instruction was a
   single flat line (`Hairstyle: ${look.hairstyle}`) sitting in a long
   paragraph dominated by a strongly-worded identity-preservation
   instruction ("do NOT change their face... skin tone... identity in any
   way"). Image-editing models bias conservative near a strict
   identity-lock instruction — hairstyle got swept into "don't change
   this" by association, even though only face/identity was meant to be
   protected. Different users converging on similar hair (not just one
   user's 5 looks looking alike) is the signature of the model defaulting
   to "leave it as in the input photo" as the path of least resistance.
2. **Expression**: `writeStylingAddendum` (the vision agent that decides
   pose/expression) was free-form prose with no visibility into the other
   4 looks being generated in the same batch — each of the 5 parallel
   per-look HTTP requests independently asked the same model roughly the
   same question ("what expression suits this look on this face") and
   converged on similar-sounding "confident, natural" photographer clichés
   despite genuinely distinct vibe/personaEnergy input.

Fix (both together, `generate-image.ts` + `skintune-schemas.ts` +
`image-generation.ts`):
- `writeStylingAddendum` now returns **structured JSON** (`StylingAddendum`:
  `expression`, `headAndCameraAngle`, `bodyLanguage`, `hairstyleRendering`,
  `fitNotes`) via strict `response_format` instead of free prose — forcing
  the model to commit to a specific value per field rather than writing
  plausible-sounding but vague text. `temperature` raised 0.8 → 0.9.
- The frontend now sends `siblingVibes` — the OTHER 4 looks' `vibe` words
  in the same batch (`image-generation.ts`'s `generateLookImages`, new
  `siblingVibes` field on `GenerateImageRequestSchema`, optional/best-effort)
  — so each per-look call is explicitly told what's already "used" in this
  shoot and instructed to pick something clearly different, breaking the
  blind-convergence problem instead of hoping temperature alone fixes it.
- `buildLookEditPrompt` was rewritten to explicitly state that identity
  preservation means ONLY "who this person is" (face/skin tone) —
  hairstyle, expression, pose, and clothing are explicitly called out as
  free to change "as much as needed for the best result", per direct user
  clarification. The hairstyle line is now a dedicated forceful instruction
  ("This hairstyle MUST be visibly and clearly restyled... rendering the
  same hair across every look is a failure") separate from and no longer
  competing with the identity-lock instruction, plus the addendum's
  `hairstyleRendering` field describes exactly how the new style should sit
  on this person's real head/hair as seen in the photo.
- Do not resurrect free-prose addendum output or a sibling-blind per-look
  call — both were tried and both under-delivered in production. If
  repetition is ever reported again, check with real generated images
  first (not just the `/api/recommendations` text output, which was
  already confirmed correct in round 2) — this round's bug was entirely in
  `generate-image.ts`, downstream of already-correct recommendation data.

**Round 4: explicit product direction — nothing in the pose/expression/
hairstyle/environment decision may be hardcoded, ever.** Even after round
3's fix, `generate-image.ts` still had two fixed template functions sitting
in `buildLookEditPrompt`: `buildFallbackPoseInstruction` (a fixed
"eye-level, waist-up, confident expression" string with only the occasion
word swapped in) and `buildFlatteringInstruction` (3 fixed paragraphs
branched on `profile.pronouns` — one for "women", one for "men", one
neutral — reused verbatim on every single request regardless of the actual
photo, look, or occasion). These ran unconditionally on every request
(the pose fallback only when the addendum was null, but the flattering
instruction always), meaning a real, non-negotiable slice of every
generated image's direction was literally the same hardcoded text
repeated across every user and every look. The user explicitly clarified
the product intent: the ONLY fixed constraint should be that the same
person's identity is preserved — everything else (hairstyle, expression,
pose, environment/setting, what makes the photo flattering) must be a
genuine, fresh AI decision reasoning over the actual photo + look +
occasion each time, never a template, never keyword-matched, never
branched on a fixed lookup like pronouns-to-paragraph.

Fix: deleted both template functions entirely. `buildFlatteringInstruction`
has no replacement function — that reasoning moved into
`writeStylingAddendum`'s own job. `StylingAddendum` gained two more
required fields: `environmentAndSetting` (background/lighting/setting,
reasoned fresh per request to fit the occasion and look — explicitly
instructed not to default to a generic backdrop) and `flatteringDirection`
(concrete, non-generic reasoning about what will make THIS person look
their best in THIS look, based on what the agent can actually see in the
photo — explicitly instructed not to reuse a generic "confident and
radiant" line). The agent's system/user prompts now also receive
`profile.pronouns` and `context.details` purely as context for natural
tone/occasion reasoning, explicitly told NOT to branch into a fixed set of
phrases based on them. The only hardcoded string left in this file is
`buildMinimalPoseFallback()` — one neutral sentence used ONLY as an
absolute last resort when the addendum agent produced nothing at all (no
photo provided, or every attempt failed) so the prompt isn't left with a
hole; it is not a styling decision and never runs when the agent
succeeded. If a future change needs a new dimension of styling decision
(e.g. lighting mood, colour grading), add a required field to
`StylingAddendum` and extend the agent's prompt — do not add a new
template function to this file.

**Image quality is intentionally set to the high end of the cost/latency
tradeoff.** All three call sites (`editViaResponsesApi`,
`editViaImagesEdit`, and the no-photo `images.generate` fallback) use
`quality: "high"` and `moderation: "low"` (the latter to reduce
false-positive content blocks on legitimate photos/outfits;
`images.edit` does not support `moderation`, only the other two paths do —
confirmed via TypeScript, not just docs). This is a deliberate choice, not
an oversight: `quality: "high"` measured at ~95-105s per image in testing
(vs ~30-45s at default), a real latency cost, but was chosen explicitly
over speed per product direction ("best quality of images"). If latency
ever becomes a blocking complaint, the fix is dropping to `quality:
"medium"` on these three call sites, not re-adding batching or cutting
other corners.

**Do not re-batch this into a single multi-look request.** A single
generated image (even JPEG-compressed) can run a few hundred KB to low
single-digit MB; 5 of them in one JSON response is exactly what caused a
real production `413 Payload Too Large` (intermittently, depending on
image size that round) — not from the request body (already small), but
because bundling 5 large images into one response risks tripping a
body-size limit somewhere in the deployment chain that isn't fully under
this app's control (a hosting platform's reverse proxy, for example). One
request per look keeps every request/response small and bounded regardless
of how many looks there are or how large any single image comes out.

**The OpenAI API key lives only in `artifacts/api-server`**, read from
`OPENAI_API_KEY` (see `src/lib/openai-client.ts`). It is never sent to or
readable from the browser — the frontend only ever calls same-origin
`/api/recommendations`, `/api/generate-image`, and `/api/analyze-photo`.
Model names are overridable via `OPENAI_TEXT_MODEL` (default `gpt-4o`) and
`OPENAI_IMAGE_MODEL` (default `gpt-image-2`).

### `src/services/photo-analysis.ts`

Calls the backend's `POST /api/analyze-photo` (GPT-4o **vision** — see
`artifacts/api-server/src/routes/analyze-photo.ts`) to actually look at the
uploaded photo and judge whether it's usable, and if so, estimate skin
tone/undertone/contrast/confidence. Falls back to a mock "good" result if
the call fails, same pattern as the other services.

**Three of the four AI routes now legitimately receive the raw photo:**
`/api/analyze-photo` (to read it), `/api/generate-image` (to edit it — see
`image-generation.ts` above), and `/api/refine-image` (see below). Only
`/api/recommendations` still strips it (it only ever needs
`appearance.skinTone`/`undertone`, already derived by the analysis step).
Don't assume "the photo never leaves the browser" as a blanket rule when
touching these routes — check which one you're actually changing.

### `src/services/image-generation.ts`'s `refineLookImage` — retry with customization

Per-look "Retry with changes" on the `LookDetail` screen: the user types a
free-text correction (e.g. "make the sleeves longer", "different shoe
colour") and `refineLookImage` calls `POST /api/refine-image`
(`artifacts/api-server/src/routes/refine-image.ts`), which sends BOTH the
user's original uploaded photo AND the already-generated look image as
reference images to the Responses API's `image_generation` tool, alongside
the correction text — a targeted refinement of the existing result, not a
fresh generation from the original photo. Same primary/fallback pattern as
`generate-image.ts` (`refineViaResponsesApi` tries first, falls back to
`refineViaImagesEdit` with the images passed as an array — `images.edit`
supports up to 16 reference images — on any failure, including the same
org-verification 403). One request per look, same reasoning as
`/api/generate-image`. Verified live: refining a generated casual look with
"change the tote to black and swap the shirt for a denim jacket" produced
exactly that change while keeping the face, pose, background, and every
other garment identical to the original generation — a precise edit, not a
regeneration.

**Download** — `LookDetail` also has a plain "Download image" button
(`downloadLookImage` in `App.tsx`) that triggers a browser download of the
current `imageUrl` via a synthetic `<a download>` click. Works because
`imageUrl` is a `data:` URL (base64), not a same-origin fetch — if a future
change ever serves images from a real URL instead, this would need a
fetch+blob step first.

**Photo-quality gating is deliberately lenient.** The system prompt in
`analyze-photo.ts` was originally too strict — it kept flagging ordinary
phone selfies (low angle, indoor lighting, casual framing) as low-light/
angle/blurry, forcing real users into repeated retries for photos that were
genuinely fine. Fixed by rewriting the prompt to explicitly treat a normal
imperfect phone selfie as "good" by default, and reserve each problem
status for only the case that would genuinely prevent a colour read (too
dark to see features at all, face not recognisable, mostly out of frame,
etc.) — "when in doubt, choose good" is stated explicitly. Verified against
a deliberately bad-angle/low-light test selfie: it now returns `status:
"good"` with ~90% confidence instead of being rejected. If retries start
feeling too easy to trigger again in the future, tighten this prompt
carefully and re-verify against a realistic bad selfie before shipping —
there's no numeric threshold in the frontend to tune instead; the model's
own judgment via `status` is the only gate.

`PhotoPanel` in `App.tsx` calls this from `runAnalysis()`, which also keeps
the staged "Analyzing…" UI on screen for its full minimum duration even if
the real analysis returns faster, so the experience doesn't flash past.

Local dev: copy `artifacts/api-server/.env.example` to `.env` (gitignored)
and fill in `OPENAI_API_KEY`, or set it directly in your shell. The frontend
dev server proxies `/api/*` to `http://localhost:5000` by default (see
`API_PROXY_TARGET` in `artifacts/skintune/vite.config.ts`) so both `pnpm
--filter @workspace/api-server run dev` and `pnpm --filter @workspace/skintune
run dev` can run side by side locally.

### Data model

`src/types.ts` — `SkinTuneProfile`, `LookRecommendation`, `LookFeedback`,
`GenerationResult` are the client-facing contracts. Keep these stable if you
add a real backend.

**Every `SkinTuneProfile` field's array-vs-string shape must match how it's
actually populated in the wizard.** `App.tsx`'s generic `SingleChoiceStep`
writes a plain `string`; `MultiChoiceStep` writes a `string[]`. The
`update({ [field]: v } as Partial<SkinTuneProfile>)` cast inside both
bypasses TypeScript's per-field checking, so pairing the wrong step
component with a field's declared type will NOT be caught by `tsc` — it
will build and typecheck cleanly, then crash at runtime the first time
something calls `.join()` (or similar) on what's actually a string, or
tries to read a string as an array. This happened once in production (the
Review screen crashed on `profile.fit.join(...)` after `fit` was switched
from multi- to single-select) — when adding or changing a wizard field,
manually re-check `types.ts`, `initialProfile`, every place that field is
read (grep for `.fieldName`), AND `artifacts/api-server/src/lib/
skintune-schemas.ts`'s mirrored Zod schema, which is a second, independent
place this same mismatch can hide.

### State / persistence

Frontend-only prototype. Three `localStorage` keys, all in `App.tsx`:
`skintune-profile` (includes the uploaded photo as a base64 data URL —
prototype-only, do not add more sensitive data here), `skintune-saved-looks`,
`skintune-feedback`. `Settings` has a working delete-everything flow.

## Backend (artifacts/api-server)

Express 5, esbuild-bundled to a single `dist/index.mjs`. Currently exposes
one real route, `GET /api/healthz`. In production it **also serves the built
SkinTune frontend as static files** — see `src/app.ts`: if `STATIC_DIR`
(or `./public` next to the bundle) exists, it's served via
`express.static`, with an SPA fallback to `index.html` for any non-`/api`,
non-file route. If no static dir is present (e.g. local API-only dev), it
just logs a warning and serves the API alone — this file should keep working
either way.

## Deployment — Render, single Docker web service

**One Render web service, built from the root `Dockerfile`.** No
`render.yaml` — configure the service directly in the Render dashboard
(Environment: Docker, Dockerfile path: `Dockerfile` at repo root, no build/
start command overrides — the Dockerfile's `CMD` is authoritative).

The image:
1. Installs the full pnpm workspace (needed because `artifacts/api-server`
   depends on workspace packages like `@workspace/api-zod`).
2. Builds `artifacts/skintune` (Vite) → `artifacts/skintune/dist/public`.
3. Builds `artifacts/api-server` (esbuild) → `artifacts/api-server/dist`.
4. Runtime stage copies only `dist/` (API bundle) and `dist/public` (frontend
   build, renamed to `/app/public`) into a slim `node:24-slim` image and runs
   `node dist/index.mjs`.

Render sets `$PORT` itself; `artifacts/api-server/src/index.ts` already reads
`process.env.PORT` (throws clearly if missing) — nothing else to configure.
`STATIC_DIR` is baked into the image as `/app/public` by the Dockerfile.

**Request body size:** `SkinTuneProfile.photoUrl` is a base64 data URL of
the user's photo and can be several hundred KB to a few MB. Only
`recommendation-engine.ts` strips it before POSTing (`/api/recommendations`
never uses the raw photo — only the already-derived
`appearance.skinTone`/`undertone`), so `photoUrl` is `.optional()` on
`SkinTuneProfileSchema`. `photo-analysis.ts` and `image-generation.ts` both
legitimately send it — the former to read it, the latter as a separate
top-level `photoUrl` field on `GenerateImageRequestSchema` (edited via
`images.edit`, not embedded in `profile`). `app.ts` raises Express's
default 100kb JSON body limit to 15mb, which comfortably covers a single
photo on any of these routes.

**Response body size:** see the "Do not re-batch" note under
`image-generation.ts` above — `/api/generate-image` is deliberately
one-look-per-call so no single response ever bundles multiple large
base64 images. This was a real production bug (intermittent 413s once real
images started coming back) and the fix was architectural (stop batching),
not just raising a limit further.

**Set `OPENAI_API_KEY` as a Render environment variable** on the service
(Render dashboard → service → Environment) for real AI recommendations,
images, and photo analysis to work in production. Without it, all three
routes return a 502 and the frontend transparently falls back to mock
data — the app still runs, just without real AI output.

**Do not add a `render.yaml`** unless the user asks for one — the dashboard
Docker service + this Dockerfile is the whole deployment story.

If you change the Dockerfile, re-verify by hand against the actual repo
paths (`docker build` may not be available in this dev environment — it
wasn't when this file was written). At minimum: confirm every path the
Dockerfile `COPY`s exists, and that `pnpm --filter @workspace/skintune run
build` and `pnpm --filter @workspace/api-server run build` both still
succeed from repo root.

**pnpm version must stay pinned.** Root `package.json` has
`"packageManager": "pnpm@9.15.9"` — this MUST match the pnpm version that
generated `pnpm-lock.yaml`. The Dockerfile's `corepack enable` reads this
field to resolve which pnpm to install; without it (or if it drifts from the
lockfile's version), a newer pnpm can normalize `pnpm-workspace.yaml`'s
`overrides` block differently and `pnpm install --frozen-lockfile` fails
with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` on Render even though nothing about
the actual dependencies changed (this happened once — see git history around
the fix). If you ever intentionally bump the local pnpm version, update this
field to match in the same commit, and regenerate `pnpm-lock.yaml` if needed.

## Commands

```bash
pnpm install                                          # from repo root
pnpm --filter @workspace/skintune run dev              # frontend dev server (needs PORT + BASE_PATH env vars)
pnpm --filter @workspace/api-server run dev             # API dev server (needs PORT)
pnpm run typecheck                                       # whole workspace
pnpm --filter @workspace/skintune run build               # frontend production build
pnpm --filter @workspace/api-server run build               # API production bundle
```

`artifacts/skintune`'s Vite config requires `PORT` and `BASE_PATH` env vars
to even start (throws otherwise) — this is intentional, inherited from the
Replit workflow. For a plain local dev run: `PORT=5173 BASE_PATH=/ pnpm
--filter @workspace/skintune run dev`.

## Working conventions

- Don't add wardrobe upload features. Don't add real-time try-on on `main`
  — that exists intentionally only on the `real-dress-search` branch (see
  "What this is" and the dedicated section near the bottom of this file).
- Keep option vocabulary (labels, emojis) centralized in
  `src/data/options.ts`, not inline in `App.tsx`.
- Keep the recommendation engine and image generation as two separate
  service files — never let a UI component import a provider SDK directly.
- No medical/diagnostic language anywhere in copy. Avoid words like "flaws",
  "hide your body", "make you fairer", "dull", "unsuitable body",
  "imperfections" — see the product brief's supportive-language guidance.
- This repo has no test suite yet. Verify changes with `pnpm run typecheck`
  and the relevant `build` script at minimum before considering a change
  done.

## `real-dress-search` branch — real web dresses + real try-on

This branch replaces the entire AI-generated-look flow (recommendation
engine inventing 5 outfit descriptions, then visualizing them) with real
web search, per explicit product direction from the user: search the web
for actual purchasable dresses matching the profile, let the user try on
any one of them (real photo of them wearing it), and send them to the real
store if they're interested. This is a genuine architectural fork from
`main`, not an incremental feature — `main` is untouched and keeps the
original AI-look product; do not merge this branch back without an
explicit decision to replace the shipped product, since it removes a
core, previously-shipped flow (5 AI-generated looks) entirely.

**Non-negotiable product requirement, stated explicitly and repeatedly by
the user: nothing about pose, expression, hairstyle, or environment may
ever be hardcoded, templated, or keyword-matched.** Every one of those
must be a fresh AI decision from the actual photo + actual garment + actual
occasion, every time. This directly continues (and hardens) the same
principle established on `main` in the image-generation pose/expression
fix rounds — see the "Round 4" note above. The ONLY thing that is ever a
fixed rule in this branch's prompts is identity preservation (same face);
literally everything else about how the shot looks is left to the vision
agent's judgement. When extending this feature, do not add a new
if/switch/lookup-table deciding any visual/styling detail — add a field to
the relevant agent's structured output schema instead and let the model
decide it.

### Real dress search (`POST /api/search-dresses`)

`artifacts/api-server/src/lib/tavily-client.ts` wraps Tavily's `/search`
endpoint (`TAVILY_API_KEY` env var). `artifacts/api-server/src/routes/
search-dresses.ts` builds a query from the profile (gender inferred from
`pronouns`, first `style`, first `colorsLove`, `occasion`, `budget` — every
clause conditional, nothing hardcoded per-category or per-brand) and
returns two separate lists:

1. **`results` (`DressResult[]`)** — real product photos, built from
   Tavily's `images[]`. Each card's `sourceUrl` is that same photo's own
   image-host domain, normalized from common CDN hostnames to the real
   retailer (`CDN_HOST_TO_RETAILER` table + a generic `images.`/`cdn.`/
   `i<digit>.` prefix-stripping heuristic) — e.g. `i.etsystatic.com` ->
   `etsy.com`. This is a real, always-present link, but NOT guaranteed to
   be the exact product page (Tavily doesn't expose that association) —
   documented explicitly in the route and confirmed by live testing.
2. **`shopLinks` (`ShopLink[]`)** — general real store pages, built from
   Tavily's `results[]`, each with a price when a `₹|Rs|$|€|£<digits>`
   pattern was found in the page snippet. NOT tied to any specific dress
   card above.

**Why two separate lists instead of one paired "product" shape — this was
tested and confirmed, not assumed:** a real query ("buy red wedding guest
dress online") was run directly against Tavily and the `images[]` results
(cicinia.com, etsy.com, walmart.com, next.co.uk) came from almost entirely
different hostnames than the `results[]` pages (selfieleslie.com, asos.com,
karenmillen.com, anthropologie.com) — hostname-matching the two arrays,
which was the first approach tried, returned wrong/useless links (a CDN
image's own root domain) for the vast majority of cards. The user was
asked directly and chose the two-separate-lists design (Option B) over
forcing a fragile pairing (Option A). Do not attempt to re-pair these two
arrays by hostname or fuzzy title match without re-verifying against a
live Tavily response first — this exact approach was tried and abandoned.

**Pagination ("More dresses") is a fresh, slightly broadened search, not a
cached-list slice.** `buildSearchQuery`'s `page` parameter nudges the query
(adds the user's 2nd style/colour preference, or "more options") so a
later page surfaces a different slice of the web rather than re-showing
the same top results. Tavily has no native pagination for a single query.

### Try-on (`POST /api/try-on`)

`artifacts/api-server/src/routes/try-on.ts` — same `gpt-image-2` machinery
as `generate-image.ts` (Responses API `image_generation` tool primary,
`images.edit` fallback, same org-verification 403 caveat), but takes the
picked `DressResult`'s own real product photo as a SECOND reference image
alongside the user's own photo (mirrors `refine-image.ts`'s two-reference-
image pattern), so the edit shows the person wearing that exact real
garment rather than a text-described approximation.

`writeTryOnAddendum` is this route's vision agent — same
structured-JSON-output pattern as `generate-image.ts`'s
`writeStylingAddendum` (see "Round 4" above for why structured fields over
free prose): it looks at BOTH images together and decides `expression`,
`headAndCameraAngle`, `bodyLanguage`, `environmentAndSetting`, and
`fitNotes` fresh each time, reasoning about this specific person and this
specific real garment together. `profile.pronouns`/`occasion` are passed
only as context for tone, explicitly instructed never to be branched into
a fixed set of phrases. If this call fails, `buildTryOnPrompt` only gets a
single neutral placeholder sentence — never a hardcoded styling decision.

### Frontend flow

`src/services/dress-search.ts` (`searchDresses`, `tryOnDress`) is the
service boundary — UI components never call Tavily/OpenAI directly. In
`App.tsx`, the wizard's `review` step now leads into `generating` (which
runs the first `searchDresses` call, ~10 results, then advances to
`dresses`) instead of the old AI-look generation. `DressGrid` shows the
photo grid (tap a card or "Try this on" to try it) plus the "Shop these
online" `shopLinks` section beneath it, with a "More dresses" button when
`hasMore`. `TryOn` shows the loading/result/error states for one dress,
with "Interested — visit {site}" (linking to `dress.sourceUrl`, disabled
until the image is ready) and "Not this one — try another" (back to the
grid) as the two outcomes described in the original product ask. Saved
items (`SavedDress = { dress, imageUrl }`) persist to the same
`skintune-saved-looks` localStorage key as before, just with a different
shape.

**Removed on this branch** (confirmed orphaned — no remaining imports —
before deletion): `src/services/recommendation-engine.ts`,
`src/services/image-generation.ts`, the `LookRecommendation`/`LookPiece`/
`LookFeedback`/`GenerationResult` types, the `Feedback` screen (its
"How did this land?" flow had no remaining entry point once the AI-look
retry path was gone), and `feedbackFeelingOptions`/`feedbackChangeOptions`/
`lookCategoryBadges` from `options.ts`. The backend's `recommendations.ts`,
`generate-image.ts`, and `refine-image.ts` routes were deliberately LEFT IN
PLACE (per explicit decision, not an oversight) — they're unreachable from
this branch's frontend but harmless, and keeping them means `main`'s flow
can be restored quickly if ever needed without resurrecting deleted files.

**Local dev needs `TAVILY_API_KEY`** in `artifacts/api-server/.env` (get
one at app.tavily.com) alongside `OPENAI_API_KEY` — see `.env.example`.
Without it, `/api/search-dresses` returns a clear 502; there is no mock
fallback for dress search the way other routes fall back to static mock
data, since there's no meaningful "mock real dress" to show.

**Tavily free/dev-tier keys have a monthly usage cap — a real production
issue, not a code bug.** Hit in this exact deployment: Render logs showed
`Tavily search failed: 432 {"detail":{"error":"This request exceeds your
plan's set usage limit..."}}`. Fix is on Tavily's dashboard (upgrade the
plan, or wait for the next billing cycle), not in this codebase — but see
the next paragraph for a real code bug this surfaced.

**The `Generating` screen used to hang forever with no feedback if the
search call failed** (e.g. this exact Tavily 432, or any other
`/api/search-dresses` error) — the effect that calls `searchDresses` had a
`.then()` but no `.catch()`, so a rejected promise just left the user
staring at the animated "Searching real stores…" screen indefinitely, with
only a silent console error and an uncaught-promise warning to show for it
(confirmed via a real Render deployment + browser console during the
Tavily-limit incident above). Fixed: the search effect now has a
`.catch()` that sets a `searchError` message, `Generating` renders a
distinct error state (message + "Try again" re-triggering the search via a
`searchAttempt` counter + "Back") instead of the spinner, and the
"More dresses" button on `DressGrid` got the same treatment
(`loadMoreError`, shown inline above the button) since it had an identical
silent-failure gap. Any future call added to this screen's loading effect
must have an explicit `.catch()` — a bare `.then()` on a screen with no
other feedback mechanism reads as the app being stuck, not as an error.

**Follow-up per direct user request: a generic error message wasn't
enough — the search flow needed a genuinely interactive, step-by-step log,
both in the console and on screen, so it's clear exactly how far a request
got and where it failed.** `src/lib/activity-log.ts`'s `createActivityLog`
is a small real (not cosmetic) step tracker: each step transitions
`pending` -> `active` -> `done`/`error`, every transition is
console-logged with a timestamp (`[SkinTune HH:MM:SS.mmm] ✓/✗/… label`),
and the same state renders as `App.tsx`'s `StepChecklist` on the
`Generating` screen. The steps are real request boundaries, not a fixed
timer: "Searching real stores" starts when the `fetch` to
`/api/search-dresses` goes out and finishes when a response arrives;
"Building your results" wraps the response's `.json()` parse. "Reading
your profile" is the one synthetic step (marked done immediately — there's
no separate network call for it) purely so the checklist doesn't open on
an empty first row.

**Error messages are now the server's actual message, not a generic
retry-later string.** `dress-search.ts`'s `readErrorMessage` reads the
backend's `{error, message}` JSON body (every route already returns this
shape on failure) and surfaces `message` specifically — e.g. a real Tavily
401 comes through as `"Dress search request failed: 401 — Tavily search
failed: 401 {...Unauthorized: missing or invalid API key...}"`, not a vague
"couldn't reach real stores." Verified live in this session: pointed the
route at a deliberately invalid `TAVILY_API_KEY` and confirmed the exact
Tavily 401 body flows all the way through to what would render in the UI.
`runTryOn` and the "More dresses" handler in `App.tsx` got the same
treatment — every failure path in this branch now surfaces the real
server-side error text via `console.error` and on-screen, not a canned
message. When adding a new request in this flow, thread the real error
message through the same way rather than writing a new generic string.

Verified live (this branch): ran real `/api/search-dresses` calls against
the real Tavily API with both a women's ("red, elegant, wedding guest,
mid-range") and a men's ("navy, classic, office, mid-range") profile —
correctly gender- and context-appropriate real results both times (red
wedding-guest dresses vs. navy suits), real prices on `shopLinks` (`$44.99`,
`£30`, etc.), and correct, non-duplicated pagination on a second page
(`offset: 10` returned 5 different dresses, ids 11-15, not a repeat of
page one). Try-on itself was not live-verified end-to-end in this session
(no `OPENAI_API_KEY` available in the dev environment at the time) — it
reuses `generate-image.ts`'s already-verified edit machinery, but if
try-on identity preservation or garment fidelity is ever reported as poor,
verify it live the same way `generate-image.ts`'s fixes were verified
(a real reference photo + a real dress image through the actual route)
before assuming the reused machinery transfers perfectly to a two-real-
photo input instead of one-real-photo-plus-text-description.

**Follow-up bug 1: results were dominated by a single site and a single
colour**, reported live with a real screenshot — 6 results in a row all
from Etsy, all the same terracotta/rust colour. Root cause, confirmed by
re-reading `search-dresses.ts`: `buildSearchQuery` only ever read
`profile.style[0]`/`profile.colorsLove[0]` (index 0 only) and ran ONE
unscoped Tavily query per page — whichever single site happened to rank
highest for that one query (Etsy, for this niche of menswear) dominated
every image result, and every result was necessarily the same one colour
since the query only ever asked for one.

Fix: `buildQueryPlan` now fans out one task per entry in a fixed
`SHOPPING_SITES` list (amazon.in, flipkart.com, myntra.com, ajio.com,
meesho.com, etsy.com — a list of where to look, not a styling decision),
round-robining through the user's FULL `colorsLove`/`style` lists (not
just index 0) across those tasks. All tasks run in parallel
(`Promise.allSettled`, so one site failing doesn't sink the request), each
with `include_domains` set to that one site as a ranking hint, and results
are interleaved (not concatenated) so the merged grid alternates
sites/colours instead of running all of one task's cards before the next.

**Confirmed live, and this matters for future changes to this file:
Tavily's `include_domains` does NOT reliably restrict `images[]` to that
domain.** A search scoped to `amazon.in` alone still returned 3/5 Etsy
images in direct testing; scoping to `flipkart.com`/`myntra.com`/
`ajio.com`/`meesho.com` individually returned almost entirely Etsy/eBay
images for this test query, not the target site. An earlier version of
this fix hard-filtered `buildDressCards` to only keep images matching the
task's target domain — this was the "honest" choice but discarded almost
every result for four of five sites, leaving too few dresses to show. The
current version does NOT filter by expected domain: every card shows its
own real, correct source site (never mislabeled), site-scoping just shifts
what Tavily tends to return rather than guaranteeing it. If a query is
ever reported as still too single-site-heavy, that reflects a genuine gap
in what Tavily has actually indexed/crawled for that query — verify with a
live query (`curl` directly against `api.tavily.com/search`) before
assuming the query-fanout or interleaving logic itself is broken; both
were confirmed working live (a men's profile with 3 colours returned 4
distinct real sites and all 3 colours represented in a 6-result page; a
women's profile returned Shopify/Nordstrom/Etsy with 2 different colours).
Cross-task duplicate images (different tasks surfacing the same photo,
common when several fall back to the same well-indexed site) are
de-duplicated by image URL before the final `limit`-sized page is built.

**Follow-up bug 2: try-on results looked like the input selfie with the
outfit swapped in — same pose, same expression, same everything else** —
reported live as "same to same copy-paste". This is the identical failure
mode `generate-image.ts` went through 4 rounds fixing on `main` (see those
notes above), but `try-on.ts` was written fresh for this branch and never
inherited those specific fixes. Root cause: `try-on.ts`'s prompt had no
anti-"cut-paste"/no-copy instruction and no forceful "this is a full
re-styling, not a touch-up" framing — nothing telling the model it's
allowed, let alone expected, to genuinely change the pose/expression/hair
rather than defaulting to the easy path of barely touching the input
photo. Fix: ported the exact hard-won language from
`generate-image.ts`'s `buildLookEditPrompt`/`writeStylingAddendum` into
`try-on.ts` — the anti-cut-paste instruction, explicit "not a light
touch-up" framing repeated at both ends of the prompt, and a new
`hairstyleRendering` field on `TryOnAddendum` with the same forceful
"MUST be visibly restyled if it calls for a change" instruction that fixed
this exact symptom in `generate-image.ts`. This was NOT independently
live-verified in this session (no `OPENAI_API_KEY` available) — it is a
faithful port of already-verified wording, not a new untested idea, but
if this symptom is ever reported again, verify with a real photo +
real dress through the actual route before assuming the port was
faithful enough; do not re-derive the fix from scratch a third time.
