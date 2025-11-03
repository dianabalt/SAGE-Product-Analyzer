// web/lib/looksLikeIngredients.ts
// Quick sanity check so we don't accept navigation/scripts/marketing as "ingredients".

import { calculateDictionaryCoverage } from './canon';
import { flags } from './flags';

const STOP_PHRASES = [
  'select the department', 'all departments', 'customer service', 'sign in',
  'returns & orders', 'account & lists', 'shop by', 'add to cart', 'back to top',
  'window', 'function(', 'var ', 'tmp=+new Date', 'cookie', 'Â©', 'javascript'
];

// Marketing/promotional phrases that indicate this is NOT an ingredient list
const MARKETING_PHRASES = [
  'unlock the full potential', 'unlock your health', 'sunshine for your health',
  'better together', 'on their own', 'essential micronutrients',
  'supports bone health', 'promotes', 'benefits', 'formulated to',
  'clinically proven', 'scientifically', 'discover', 'experience',
  'revolutionary', 'advanced formula', 'premium quality', 'doctor recommended',
  'all natural', 'organic certified', 'gmp certified', 'made in usa', 'made from',
  'third party tested', 'non-gmo', 'gluten free', 'dairy free', 'vegan',
  'vegetarian', 'soy free', 'nut free', 'free from', 'contains no',
  'extra strength', 'maximum strength', 'high potency', 'our formula',
  'why choose', 'perfect for', 'ideal for', 'great for', 'best for',
  'without fillers', 'no fillers', 'filler free', 'without additives', 'no additives',
  'without preservatives', 'no preservatives', 'preservative free',
  'our supplements', 'our products', 'our herbal', 'we use', 'we only use',
  'quality ingredients', 'pure ingredients', 'natural ingredients',
  'carefully selected', 'hand picked', 'sourced from', 'harvested from',
  'trusted by', 'recommended by', 'used by', 'loved by',
  'help you', 'helps you', 'designed to', 'created to', 'crafted to',
  // Allergen and rating phrases (from skinsafeproducts.com issue)
  'only rated', '% rated', 'rated ', 'allergen free', 'allergen-free',
  'top allergen', 'hypoallergenic', 'would not cause', 'will not cause',
  'allergic response', 'allergic reaction', 'virtually anyone', 'anyone sensitive',
  'ingredients that have scent', 'natural herbal scent', 'herbal scents',
  'suitable for all', 'safe for all', 'dermatologist tested', 'dermatologically tested',
  'clinically tested', 'ophthalmologist tested', 'pediatrician tested',
  'fragrance free', 'paraben free', 'sulfate free', 'phthalate free',
  'cruelty free', 'never tested on', 'leaping bunny', 'certified cruelty',
  // Descriptive adjectives (from byeflakes.com issue)
  'sweet', 'spicy', 'bitter', 'delicious', 'delightfully', 'refreshing',
  'smooth', 'creamy', 'luxurious', 'aromatic', 'savory', 'tangy',
  // Product description language (Amazon/retail marketing - from Kashi cereal issue)
  'makes a', 'tasty snack', 'tasty', 'wholesome', 'wholesome serving',
  'provides', 'at work', 'before the gym', 'after workout', 'after the gym',
  'on the go', 'each serving', 'each scoop', 'per serving', 'daily value',
  'grams of protein', 'grams of fiber', 'grams of', 'g of protein', 'g of fiber',
  'serving provides', 'great snack', 'perfect snack', 'ideal snack', 'nutritious',
  'fuel your', 'power through', 'boost your', 'energize your', 'satisfy your'
];

const INCI_HINTS =
  /\b(ingredient[s]?:?|aqua\b|water\b|glycol\b|glycerin\b|sodium\b|butylene\b|tocopher|dimethicone|parfum\b|fragrance\b|ci\s?\d{3,6}|(paraben|benzoate|sulfate)s?\b|cholecalciferol|menaquinone|ascorbic|retinol|niacinamide|hyaluronic|panthenol|tocopherol)/i;

// Food & Supplement ingredient hints (different from cosmetics!)
const FOOD_SUPPLEMENT_HINTS = /\b(protein|whey|casein|isolate|concentrate|amino|leucine|isoleucine|valine|bcaa|glutamine|arginine|lysine|lecithin|salt|sugar|flour|starch|fiber|natural flavor|artificial flavor|steviol|stevia|sucralose|acesulfame|aspartame|maltodextrin|dextrose|fructose|glucose|lactose|xylitol|erythritol|milk|egg|gelatin|collagen|bovine|carrageenan|guar gum|xanthan gum|cellulose|citric acid|malic acid|ascorbic acid|lactic acid|vitamin|cholecalciferol|ergocalciferol|cyanocobalamin|methylcobalamin|tocopherol|retinol|retinyl|beta-carotene|thiamin|riboflavin|niacin|niacinamide|pyridoxine|folate|folic acid|biotin|pantothenic|calcium|magnesium|zinc|iron|selenium|copper|manganese|chromium|molybdenum|iodine|potassium|phosphate|citrate|carbonate|oxide|gluconate|picolinate|extract|root|leaf|berry|seed|fruit|powder|turmeric|curcumin|ashwagandha|ginseng|echinacea|elderberry|ginkgo|valerian|saw palmetto|omega-3|dha|epa|coenzyme|ubiquinone|probiotics|lactobacillus|bifidobacterium|prebiotic|inulin)\b/i;

export function looksLikeIngredients(s: string): boolean {
  if (!s) return false;

  // normalize
  const text = s.replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();

  // REJECT if contains marketing/promotional language
  const marketingHits = MARKETING_PHRASES.reduce((n, p) => n + (lower.includes(p) ? 1 : 0), 0);
  if (marketingHits >= 2) {
    console.log('[looksLikeIngredients] REJECTED: Contains marketing phrases:', marketingHits);
    return false;
  }

  // must have commas/semicolons (lists) or CI codes / common INCI tokens
  const hasListDelims = /[,;] /.test(text);
  const hasInciTokens = INCI_HINTS.test(text);

  if (!(hasListDelims || hasInciTokens)) {
    console.log('[looksLikeIngredients] REJECTED: No list delimiters or INCI tokens');
    return false;
  }

  // REJECT if too few commas (need at least 3 for a valid ingredient list = 4+ items)
  const commaCount = (text.match(/,/g) || []).length;
  if (commaCount < 3) {
    console.log('[looksLikeIngredients] REJECTED: Too few commas (need 3+, found:', commaCount);
    return false;
  }

  // REJECT negative claims (no X, without Y, free from Z) - these are marketing, not ingredients
  if (/\b(no|without|free\s+from)\s+[a-z]+/i.test(text)) {
    console.log('[looksLikeIngredients] REJECTED: Contains negative claims (no/without/free from)');
    return false;
  }

  // reject if lots of stop phrases (menus/scripts)
  const stopHits = STOP_PHRASES.reduce((n, p) => n + (lower.includes(p) ? 1 : 0), 0);
  if (stopHits >= 2) {
    console.log('[looksLikeIngredients] REJECTED: Contains stop phrases:', stopHits);
    return false;
  }

  // REJECT if too many long words without commas (likely sentences/paragraphs)
  const words = text.split(/\s+/);
  const longWords = words.filter(w => w.length > 15).length;
  if (longWords > 5 && commaCount < 3) {
    console.log('[looksLikeIngredients] REJECTED: Too many long words without commas');
    return false;
  }

  // For short lists (<10 tokens), require at least 3 INCI ingredient hits
  // This prevents "No sulfates, parabens, PEGs, sweet, spicy, bitter" from passing
  const tokens = text.split(/[,;]/).map(t => t.trim());
  const inciHits = tokens.filter(t => INCI_HINTS.test(t)).length;
  if (tokens.length < 10 && inciHits < 3) {
    console.log('[looksLikeIngredients] REJECTED: Too few INCI ingredients for short list (tokens:', tokens.length, ', inci:', inciHits, ')');
    return false;
  }

  // length bounds
  if (text.length < 40) {
    console.log('[looksLikeIngredients] REJECTED: Too short');
    return false;
  }
  if (text.length > 8000) {
    console.log('[looksLikeIngredients] REJECTED: Too long');
    return false;
  }

  console.log('[looksLikeIngredients] PASSED validation');
  return true;
}

/**
 * Rule-based cleaning: Remove common headings and footers from ingredient lists
 * This is 100% reliable and doesn't use AI (no hallucinations)
 *
 * Use this instead of AI cleaner for clean sources (INCIdecoder, brand websites)
 */
export function cleanIngredientsHeading(text: string): string {
  if (!text) return text;

  let cleaned = text;

  // Remove headings at start (case-insensitive)
  cleaned = cleaned.replace(/^(Ingredients?|Other Ingredients?|Inactive Ingredients?|Active Ingredients?|Full Ingredients?( List)?|Ingredients? overview|Supplement Facts|Drug Facts):?\s*/i, '');

  // Remove common disclaimers/footers at end
  cleaned = cleaned.replace(/Please be aware that ingredient lists?.*/is, '');
  cleaned = cleaned.replace(/Please refer to the ingredient list.*/is, '');
  cleaned = cleaned.replace(/Read more on how to read.*/is, '');
  cleaned = cleaned.replace(/\*Ingredient lists? may change.*/is, '');
  cleaned = cleaned.replace(/Note:?\s*Ingredient lists?.*/is, '');

  // Fix "IngredientsWater" pattern ONLY if genuinely merged (no space)
  // This pattern matches: "Ingredients" directly followed by a capitalized word (no space)
  // Example: "IngredientsWater" → "Water"
  cleaned = cleaned.replace(/^Ingredients?([A-Z][a-z]+)/i, '$1');

  return cleaned.trim();
}

/**
 * Validator for food and supplement ingredients
 * Different from cosmetics - uses non-INCI naming conventions
 *
 * Used for: protein powders, vitamins, supplements, packaged foods
 * Sources: OpenFoodFacts, nutrition labels, supplement facts
 */
export function looksLikeFoodIngredients(s: string): boolean {
  if (!s) return false;

  const text = s.replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();

  // Must have commas (list format)
  const commaCount = (text.match(/,/g) || []).length;
  if (commaCount < 3) {
    console.log('[looksLikeFoodIngredients] REJECTED: Too few commas (need 3+, found:', commaCount, ')');
    return false;
  }

  // Must have food/supplement-specific terms
  if (!FOOD_SUPPLEMENT_HINTS.test(text)) {
    console.log('[looksLikeFoodIngredients] REJECTED: No food/supplement terms detected');
    return false;
  }

  // Should NOT have cosmetic-specific terms (strong indicators)
  // These are ingredients that ONLY appear in cosmetics, never in food/supplements
  if (/\b(dimethicone|cetyl alcohol|stearyl|cetearyl|parfum|phenoxyethanol|methylparaben|propylparaben|phthalate)\b/i.test(text)) {
    console.log('[looksLikeFoodIngredients] REJECTED: Contains cosmetic-specific terms');
    return false;
  }

  // Length bounds
  if (text.length < 40) {
    console.log('[looksLikeFoodIngredients] REJECTED: Too short (min 40 chars)');
    return false;
  }
  if (text.length > 8000) {
    console.log('[looksLikeFoodIngredients] REJECTED: Too long (max 8000 chars)');
    return false;
  }

  console.log('[looksLikeFoodIngredients] PASSED validation');
  return true;
}

/**
 * Normalize Drug Facts format by stripping purpose labels
 * Example: "Homosalate (8 %), Sunscreen." → "Homosalate (8 %)"
 */
function normalizeDrugFacts(text: string): string {
  // FDA Drug Facts purpose labels (from 21 CFR 201.66)
  const purposes = [
    'Sunscreen', 'Antifungal', 'Antimicrobial', 'Antipruritic', 'Analgesic',
    'Skin Protectant', 'Anticaries', 'Astringent', 'Antacid', 'Antiemetic',
    'Antitussive', 'Expectorant', 'Nasal Decongestant', 'Cough Suppressant',
    'Oral Anesthetic', 'Oral Analgesic'
  ];

  const purposePattern = purposes.join('|');

  // Pattern: "Homosalate (8 %), Sunscreen." or "Homosalate (8 %), Sunscreen.;"
  // Matches: ingredient name + percentage + comma + purpose + period/semicolon
  const regex = new RegExp(
    `\\b([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*\\s*\\([^)]+%\\))\\s*,\\s*(${purposePattern})\\s*[.;]?`,
    'gi'
  );

  // Keep just the ingredient + percentage, remove purpose label
  // Replace with: name(percentage), (comma for continuation)
  return text.replace(regex, '$1,');
}

/**
 * Filter out marketing copy from extracted text
 * Returns cleaned text or null if it's all marketing
 */
export function stripMarketingCopy(text: string): string | null {
  if (!text) return null;

  // Normalize Drug Facts format BEFORE splitting by periods
  // Detects: ingredient names with percentages followed by purpose labels
  if (/\([^)]+%\)\s*,\s*(Sunscreen|Antifungal|Antimicrobial|Antipruritic|Analgesic|Skin Protectant)/i.test(text)) {
    console.log('[stripMarketingCopy] Detected Drug Facts format, normalizing...');
    text = normalizeDrugFacts(text);
  }

  const lower = text.toLowerCase();

  // IMMEDIATE REJECT: If text contains common marketing sentence structures
  const marketingSentencePatterns = [
    /our\s+(herbal\s+)?supplements?\s+are\s+made/i,
    /our\s+products?\s+are\s+made/i,
    /we\s+(only\s+)?use\s+/i,
    /(without|no|free\s+from)\s+(fillers?|additives?|preservatives?)/i,
    /(made|crafted|formulated)\s+(from|with)\s+/i,
    /designed\s+to\s+/i,
    /helps?\s+(you\s+)?/i,
    /supports?\s+/i,
    /promotes?\s+/i,
    // Rating and allergen patterns (from skinsafeproducts.com issue)
    /(only\s+)?rated\s+\d+%/i,
    /product\s+is\s+(only\s+)?rated/i,
    /(top\s+)?allergen\s+(free|-free)/i,
    /(would|will)\s+not\s+cause/i,
    /allergic\s+(response|reaction)/i,
    /suitable\s+for\s+all/i,
    /safe\s+for\s+all/i,
  ];

  for (const pattern of marketingSentencePatterns) {
    if (pattern.test(text)) {
      console.log('[stripMarketingCopy] REJECTED: Contains marketing sentence pattern:', text.substring(0, 100));
      return null;
    }
  }

  // Split by sentences/periods
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);

  const cleanedSentences = sentences.filter(sentence => {
    const lower = sentence.toLowerCase();

    // Reject sentences with marketing language
    const hasMarketing = MARKETING_PHRASES.some(phrase => lower.includes(phrase));
    if (hasMarketing) {
      console.log('[stripMarketingCopy] Removing marketing sentence:', sentence.substring(0, 100));
      return false;
    }

    // Reject very short sentences (likely fragments or headings)
    if (sentence.length < 20) {
      console.log('[stripMarketingCopy] Removing short sentence:', sentence);
      return false;
    }

    // Keep sentences that look like ingredient lists (have commas and chemical names)
    const hasCommas = sentence.includes(',');
    const hasChemicalNames = INCI_HINTS.test(sentence);

    // Must have BOTH commas AND chemical names to be considered ingredients
    if (!hasCommas || !hasChemicalNames) {
      console.log('[stripMarketingCopy] Removing non-ingredient sentence:', sentence.substring(0, 80));
      return false;
    }

    return true;
  });

  const cleaned = cleanedSentences.join('. ').trim();
  return cleaned || null;
}

// ============ Validator V2 (Phase A - Shadow Mode) ============

/**
 * Enhanced validation result with structural checks
 * Phase A: Shadow mode (log decisions, don't block)
 */
export type ValidatorV2Result = {
  commaDensityOk: boolean;
  maxLenOk: boolean;
  hasBadPhrases: boolean;
  dictCoverage: number;
  mayContain: string[];
  activeIngredients: string[];
  inactiveIngredients: string[];
};

/**
 * Enhanced validation with structural checks (Phase A - shadow mode)
 *
 * Checks:
 * 1. Comma density: ≥1 per 25 chars (lists should have frequent delimiters)
 * 2. Max list length: ≤120 tokens (too many = likely junk/full page text)
 * 3. Bad phrases: "key ingredients", "powered by", "free from", "CI XXXXX" (unless in parens)
 * 4. Dictionary coverage: % of tokens that are known INCI ingredients
 * 5. "May contain" separation: Extract allergen/trace items to separate channel
 *
 * Usage:
 *   if (flags.validatorV2) {
 *     const v2 = v2Checks(text, tokens);
 *     console.log('[validator_v2]', v2);
 *   }
 */
export function v2Checks(text: string, tokens: string[]): ValidatorV2Result {
  const len = text.length;

  // ========== Comma Density Check ==========
  // Lists should have frequent delimiters (at least 1 per 25 chars)
  const commaCount = (text.match(/[;,]/g) || []).length;
  const commaDensityOk = commaCount >= Math.max(1, Math.floor(len / 25));

  // ========== Max Length Check ==========
  // Ingredient lists should be ≤120 tokens (too many = likely full page text)
  const maxLenOk = tokens.length <= 120;

  // ========== Bad Phrase Detection ==========
  // Remove parenthetical content first (e.g., "Aqua (Water)" is OK)
  const withoutParens = text.replace(/\([^)]*\)/g, '');

  // Check for marketing phrases (should not be in main ingredient list)
  const hasBadPhrases = /\b(key ingredients?|powered by|free from|no\s+\w+)\b/i.test(withoutParens);

  // ========== Dictionary Coverage ==========
  // What % of tokens are known INCI ingredients?
  // Low coverage (<35%) suggests marketing copy or non-ingredient text
  const dictCoverage = calculateDictionaryCoverage(tokens);

  // ========== Separate "May Contain" Items (Shadow Mode) ==========
  // Extract items from "may contain:" sections and CI color codes
  const mayContain: string[] = [];

  // Pattern 1: "May contain: X, Y, Z"
  const mayContainMatch = text.match(/\bmay contain[:\s]*([^.]+)/i);
  if (mayContainMatch) {
    const mayContainText = mayContainMatch[1];
    mayContain.push(...mayContainText.split(/[,;]/).map(s => s.trim()).filter(Boolean));
  }

  // Pattern 2: CI color codes (e.g., "CI 77491, CI 77492")
  for (const token of tokens) {
    if (/\bci\s*\d{5}/i.test(token)) {
      mayContain.push(token);
    }
  }

  // ========== Active vs Inactive Ingredients (Phase B) ==========
  // TODO Phase B: Parse "Active Ingredients" and "Inactive Ingredients" sections from drug labels
  const activeIngredients: string[] = [];
  const inactiveIngredients: string[] = [];

  return {
    commaDensityOk,
    maxLenOk,
    hasBadPhrases,
    dictCoverage,
    mayContain,
    activeIngredients,
    inactiveIngredients
  };
}