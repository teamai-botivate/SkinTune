export type PhotoStatus = 'good' | 'low-light' | 'too-far' | 'covered' | 'filter' | 'blurry' | 'angle' | 'low-confidence';

export type AppearanceProfile = {
  skinTone: string;
  undertone: string;
  confidence: number;
  contrast: string;
};

export type BodyProfile = {
  build: string;
  fit: string[];
  priorities: string[];
};

export type StylePreferences = {
  styles: string[];
  impression: string[];
};

export type ColourPreferences = {
  love: string[];
  avoid: string[];
};

export type Restrictions = string[];

export type OccasionContext = {
  occasion: string;
  details: string;
};

export type ImpressionPreference = string[];

export type BudgetPreference = string;

export type SkinTuneProfile = {
  name: string;
  pronouns: string;
  ageGroup: string;
  height: string;
  photoUrl: string;
  appearance: AppearanceProfile;
  bodyBuild: string;
  fit: string[];
  priorities: string[];
  style: string[];
  colorsLove: string[];
  colorsAvoid: string[];
  restrictions: string[];
  occasion: string;
  occasionDetails: string;
  impression: string[];
  budget: string;
};

export type UserProfile = SkinTuneProfile;

export type LookRecommendation = {
  id: string;
  title: string;
  note: string;
  palette: string[];
  pieces: { category: string; name: string; detail: string }[];
  outfit: string;
  jewellery: string;
  hairstyle: string;
  makeup: string;
  accessories: string;
  footwear: string;
  confidence: number;
  imageUrl: string;
};

export type LookFeedback = {
  feeling: string;
  changeRequest: string;
  lookId?: string;
};

export type GenerationResult = {
  recommendations: LookRecommendation[];
  generatedAt: string;
};