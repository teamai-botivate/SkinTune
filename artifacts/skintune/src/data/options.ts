// Centralized selection option lists for the onboarding wizard and returning-user flows.
// Keeping these here (instead of inline literals in App.tsx) avoids duplication and
// makes the option vocabulary easy to audit or extend in one place.

export type SelectOption = {
  label: string;
  description?: string;
  icon?: string;
};

export const pronounOptions: SelectOption[] = [
  { label: 'Women’s styling' },
  { label: 'Men’s styling' },
  { label: 'Androgynous styling' },
  { label: 'A mix of all three' },
];

export const ageGroupOptions: SelectOption[] = [
  { label: 'Under 25' },
  { label: '25–34' },
  { label: '35–49' },
  { label: '50+' },
  { label: 'Prefer not to say' },
];

export const bodyBuildOptions: SelectOption[] = [
  { label: 'Slim', icon: '🪶', description: 'A lean, narrower line through the frame.' },
  { label: 'Average', icon: '⚖️', description: 'A balanced line through shoulders and hips.' },
  { label: 'Athletic', icon: '🏋️', description: 'Defined or broader shoulders.' },
  { label: 'Curvy', icon: '🌸', description: 'A waist-led line with visible softness.' },
  { label: 'Broad', icon: '🧱', description: 'A fuller line through the shoulders or frame.' },
  { label: 'Prefer not to say', icon: '🤍', description: 'We’ll keep the fit advice flexible.' },
];

export const fitOptions: SelectOption[] = [
  { label: 'Fitted', icon: '✨', description: 'Closer to the body, more defined.' },
  { label: 'Regular', icon: '🙂', description: 'A classic, everyday fit.' },
  { label: 'Relaxed', icon: '🧸', description: 'Roomier, easy movement.' },
  { label: 'Oversized', icon: '🔥', description: 'Bold volume, statement proportion.' },
];

// Note: "priorities" (Style First / Comfort First / Balance Both) is no
// longer a separate onboarding question — the recommendation engine infers
// this balance from the user's style and impression choices instead, to
// keep the required form shorter. See artifacts/api-server/src/routes/
// recommendations.ts's buildUserPrompt().

export const styleOptions: SelectOption[] = [
  { label: 'Elegant' },
  { label: 'Glamorous' },
  { label: 'Traditional' },
  { label: 'Minimal' },
  { label: 'Modern' },
  { label: 'Creative' },
  { label: 'Luxury' },
  { label: 'Casual' },
  { label: 'Bold' },
];

export const colorLoveOptions: SelectOption[] = [
  { label: 'Terracotta' },
  { label: 'Cream' },
  { label: 'Ink navy' },
  { label: 'Olive' },
  { label: 'Butter yellow' },
  { label: 'Clear white' },
  { label: 'Berry' },
  { label: 'Chocolate' },
];

export const colorAvoidOptions: SelectOption[] = [
  { label: 'Neon brights' },
  { label: 'Pastels' },
  { label: 'All black' },
  { label: 'Orange' },
  { label: 'Cool grey' },
  { label: 'Busy patterns' },
];

export const restrictionOptions: SelectOption[] = [
  { label: 'No wool or scratchy textures' },
  { label: 'Comfortable shoes only' },
  { label: 'Modest coverage' },
  { label: 'Easy-care fabrics' },
  { label: 'No dry cleaning' },
  { label: 'None of these' },
];

export const occasionOptions: SelectOption[] = [
  { label: 'Wedding', icon: '💍' },
  { label: 'Party', icon: '🎉' },
  { label: 'Festival', icon: '🪷' },
  { label: 'Office', icon: '💼' },
  { label: 'Date', icon: '❤️' },
  { label: 'Vacation', icon: '✈️' },
  { label: 'Photoshoot', icon: '📸' },
  { label: 'Everyday', icon: '☀️' },
  { label: 'Interview', icon: '🎓' },
  { label: 'Special Event', icon: '✨' },
];

export const impressionOptions: SelectOption[] = [
  { label: 'Powerful', icon: '👑' },
  { label: 'Elegant', icon: '🌸' },
  { label: 'Glamorous', icon: '💎' },
  { label: 'Traditional', icon: '🪷' },
  { label: 'Romantic', icon: '❤️' },
  { label: 'Confident', icon: '😎' },
  { label: 'Minimal', icon: '🤍' },
  { label: 'Creative', icon: '🎨' },
  { label: 'Approachable', icon: '😊' },
];

export const budgetOptions: SelectOption[] = [
  { label: '₹0–₹2K', description: 'Smart, accessible finds.' },
  { label: '₹2K–₹5K', description: 'A mix of high-street and investment.' },
  { label: '₹5K–₹10K', description: 'More room for fabric and construction.' },
  { label: '₹10K–₹25K', description: 'More room for special pieces.' },
  { label: '₹25K+', description: 'Keep the focus on the look.' },
  { label: 'No strict budget', description: 'Show the best options for the direction.' },
];

// Quick-start chips for the returning-user home screen.
export const homeOccasionShortcuts: SelectOption[] = [
  { label: 'Everyday', icon: '☀️' },
  { label: 'Office', icon: '💼' },
  { label: 'Wedding', icon: '💍' },
  { label: 'Party', icon: '🎉' },
  { label: 'Date', icon: '❤️' },
  { label: 'Festival', icon: '🪷' },
  { label: 'Special Event', icon: '✨' },
];

// Feedback "what should we change" chips.
export const feedbackChangeOptions: SelectOption[] = [
  { label: 'Colour', icon: '🎨' },
  { label: 'Outfit', icon: '👗' },
  { label: 'Jewellery', icon: '💎' },
  { label: 'Makeup', icon: '💄' },
  { label: 'Hairstyle', icon: '💇' },
  { label: 'Overall Style', icon: '✨' },
];

export const feedbackFeelingOptions: SelectOption[] = [
  { label: 'Love it', icon: '❤️' },
  { label: 'I would wear it', icon: '👍' },
  { label: 'Maybe', icon: '🤔' },
  { label: 'Not my style', icon: '👎' },
];

// Look category badges applied to the 5 results, in order.
export const lookCategoryBadges = [
  { label: 'Best Match', icon: '⭐' },
  { label: 'Glamorous', icon: '💎' },
  { label: 'Elegant', icon: '🌸' },
  { label: 'Minimal', icon: '🤍' },
  { label: 'Modern Alternative', icon: '🔥' },
] as const;
