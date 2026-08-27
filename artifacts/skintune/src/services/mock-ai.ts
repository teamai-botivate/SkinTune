import type { LookRecommendation, SkinTuneProfile } from '../types';

export const generateLookImages = async (
  _profile: SkinTuneProfile,
  _context: { occasion: string; details: string },
  recommendations: LookRecommendation[],
): Promise<LookRecommendation[]> => {
  await new Promise((resolve) => setTimeout(resolve, 2600));
  return recommendations;
};