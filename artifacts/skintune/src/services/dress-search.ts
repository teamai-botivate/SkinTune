// Dress Search & Try-On Service (real-dress-search branch)
// -----------------------------------------------------------
// Replaces recommendation-engine.ts + image-generation.ts's role on this
// branch: instead of an AI-generated look, this searches the real web
// (backend's /api/search-dresses, via Tavily) for actual purchasable
// dresses matching the user's profile, and tries a selected one on the
// user's own uploaded photo (backend's /api/try-on, gpt-image-2).
//
// Same boundary discipline as the rest of the app: UI components only ever
// call these functions, never a search/image provider SDK directly.

import type { DressResult, ShopLink, SkinTuneProfile } from '../types';

export type DressSearchPage = {
  results: DressResult[];
  shopLinks: ShopLink[];
  hasMore: boolean;
};

/**
 * Fetches one page of real dress results for the given profile. `offset`/
 * `limit` drive the "More" button — each call is a fresh, slightly
 * broadened search (see the backend route), not a cached-and-sliced list,
 * so pass the previous total count as the next call's offset.
 */
export const searchDresses = async (
  profile: SkinTuneProfile,
  offset: number,
  limit = 10,
): Promise<DressSearchPage> => {
  const { photoUrl: _photoUrl, ...profileForRequest } = profile;
  const res = await fetch('/api/search-dresses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: profileForRequest, offset, limit }),
  });
  if (!res.ok) throw new Error(`Dress search request failed: ${res.status}`);
  const data = (await res.json()) as DressSearchPage;
  return data;
};

/**
 * Generates a try-on image: the user's own uploaded photo, re-dressed in
 * the exact dress they picked. Throws on failure — the calling screen
 * should show a retry state rather than silently showing nothing, since
 * this is a single explicit user action ("try this on"), not a background
 * batch fetch with independent per-item fallbacks like generate-image.ts.
 */
export const tryOnDress = async (
  dress: DressResult,
  profile: SkinTuneProfile,
): Promise<string> => {
  if (!profile.photoUrl) throw new Error('A photo is required to try on a dress.');
  const { photoUrl, ...profileForRequest } = profile;
  const res = await fetch('/api/try-on', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dress, profile: profileForRequest, photoUrl }),
  });
  if (!res.ok) throw new Error(`Try-on request failed: ${res.status}`);
  const data = (await res.json()) as { imageUrl: string };
  if (!data.imageUrl) throw new Error('Empty try-on response');
  return data.imageUrl;
};
