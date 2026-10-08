import type {
  LookRecommendation,
  SkinTuneProfile,
  ProductCategory,
  ProductRecommendationsResponse,
} from '../types';

/**
 * Fetch real shoppable product recommendations matching a styling look and user profile.
 * Calls backend route `POST /api/product-recommendations`.
 *
 * If the call fails or real search is unavailable, returns a graceful fallback response
 * so the styling recommendation UI remains completely functional.
 */
export async function getProductRecommendations(
  look: LookRecommendation,
  profile: SkinTuneProfile,
  category?: ProductCategory | 'all',
): Promise<ProductRecommendationsResponse> {
  try {
    // Strip raw photoUrl to keep payload light
    const { photoUrl: _photoUrl, ...profileForRequest } = profile;

    const res = await fetch('/api/product-recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        look,
        profile: profileForRequest,
        category: category && category !== 'all' ? category : undefined,
      }),
    });

    if (!res.ok) {
      throw new Error(`Product recommendations request failed with status: ${res.status}`);
    }

    const data = (await res.json()) as ProductRecommendationsResponse;
    return data;
  } catch (err) {
    console.warn('Real product recommendations unavailable:', err);
    return {
      lookId: look.id,
      persona: 'neutral',
      applicableCategories: look.applicableCategories || ['outfit', 'footwear', 'accessories'],
      products: [],
      status: 'unavailable',
      disclaimer: 'Live product discovery is temporarily unavailable. Your styling recommendation above remains fully accessible.',
      searchedAt: new Date().toISOString(),
      totalFound: 0,
    };
  }
}
