// Photo-quality diagnostic states. `good` means the photo is usable; every other
// value maps to a specific, explainable problem (see data/photo-diagnostics.ts).
export type PhotoStatus =
  | 'good'
  | 'low-light'
  | 'warm-light'
  | 'blurry'
  | 'angle'
  | 'filter'
  | 'occluded'
  | 'low-confidence';

export type AppearanceProfile = {
  skinTone: string;
  undertone: string;
  confidence: number;
  contrast: string;
};

export type SkinTuneProfile = {
  name: string;
  pronouns: string;
  ageGroup: string;
  height: string;
  photoUrl: string;
  appearance: AppearanceProfile;
  bodyBuild: string;
  /** Single-select: Fitted / Regular / Relaxed / Oversized. */
  fit: string;
  style: string[];
  colorsLove: string[];
  colorsAvoid: string[];
  restrictions: string[];
  occasion: string;
  impression: string[];
  budget: string;
};

/** Alias kept for continuity with a future backend contract. */
export type UserProfile = SkinTuneProfile;

export type LookPiece = {
  category: string;
  name: string;
  detail: string;
};

// A complete-look recommendation. This is the contract between the
// recommendation engine and the image-generation service (see
// services/recommendation-engine.ts and services/image-generation.ts) — it
// carries enough structured styling data for an image provider to visualize
// the look without inventing its own styling strategy.
export type LookRecommendation = {
  id: string;
  title: string;
  note: string;
  category?: string;
  /** A single distinct mood word (e.g. "Radiant", "Grounded") used to drive per-look pose/expression in image generation. */
  vibe?: string;
  /** 1-2 sentences of photographer-facing pose/energy direction for this specific look. */
  personaEnergy?: string;
  palette: string[];
  pieces: LookPiece[];
  outfit: string;
  outfitColor: string;
  jewellery: string;
  hairstyle: string;
  makeup: string;
  accessories: string;
  footwear: string;
  reasoning: string[];
  confidence: number;
  imageUrl: string;
  applicableCategories?: string[];
};

export type ProductCategory =
  | 'outfit'
  | 'makeup'
  | 'jewellery'
  | 'accessories'
  | 'footwear';

export type PriceTier = 'budget' | 'mid' | 'premium';

export type ProductResult = {
  id: string;
  category: ProductCategory;
  subcategory: string;
  recommendedItemTitle?: string;
  brand: string;
  productName: string;
  retailer: string;
  price?: number;
  formattedPrice?: string;
  originalPrice?: number;
  formattedOriginalPrice?: string;
  currency?: string;
  priceTier?: PriceTier;
  priceVerified?: boolean;
  productVerified?: boolean;
  shade?: string;
  color?: string;
  material?: string;
  description?: string;
  imageUrl?: string;
  productUrl: string;
  urlType?: 'exact_product' | 'search_result';
  isVerified?: boolean;
  matchScore?: number;
  matchReason: string;
  availability?: string;
  source?: string;
  lastChecked?: string;
};

export type ProductGroup = {
  category: ProductCategory;
  recommendedItemTitle: string;
  stylingRequirement: string;
  products: ProductResult[];
};

export type ProductRecommendationsRequest = {
  look: LookRecommendation;
  profile: SkinTuneProfile;
  category?: ProductCategory | 'all';
};

export type ProductRecommendationsResponse = {
  lookId: string;
  persona: 'woman' | 'man' | 'child' | 'neutral';
  applicableCategories: string[];
  products: ProductResult[];
  groups?: ProductGroup[];
  status: 'success' | 'partial' | 'unavailable';
  disclaimer?: string;
  searchedAt: string;
  totalFound: number;
};

export type LookFeedback = {
  feeling: string;
  changeRequest: string;
  changeAreas: string[];
  lookId?: string;
};

export type GenerationResult = {
  recommendations: LookRecommendation[];
  generatedAt: string;
};
