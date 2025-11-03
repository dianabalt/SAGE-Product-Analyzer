// web/lib/simplifyProductName.ts
// Simplify product names for better search results by removing filler words

const FILLER_WORDS = [
  'gentle', 'daily', 'nightly', 'super', 'ultra', 'advanced', 'intensive',
  'superfruit', 'premium', 'professional', 'clinical', 'dermatologist',
  'tested', 'approved', 'recommended', 'perfect', 'ultimate', 'essential',
  'pure', 'natural', 'organic', 'fresh', 'new', 'improved', 'extra',
  'deep', 'rich', 'lightweight', 'oil-free', 'non-comedogenic',
  'fragrance-free', 'paraben-free', 'hypoallergenic'
];

const PRODUCT_TYPES = [
  'cleanser', 'moisturizer', 'cream', 'lotion', 'serum', 'oil', 'gel',
  'toner', 'essence', 'mask', 'scrub', 'exfoliant', 'balm', 'treatment',
  'sunscreen', 'spf', 'foundation', 'concealer', 'powder', 'primer',
  'lipstick', 'gloss', 'liner', 'mascara', 'eyeshadow', 'blush',
  'shampoo', 'conditioner', 'soap', 'wash', 'mist', 'spray'
];

/**
 * Extract brand name from product name (usually first 2-4 words before product type)
 * Examples:
 *   "Youth To The People Papaya Vitamin C Superfruit Gentle Exfoliating Cleanser"
 *   → Brand: "Youth To The People", Product: "Cleanser"
 */
function extractBrandAndType(name: string): { brand: string | null; type: string | null } {
  const words = name.toLowerCase().split(/\s+/);

  // Find product type
  let typeIndex = -1;
  let productType: string | null = null;
  for (let i = 0; i < words.length; i++) {
    if (PRODUCT_TYPES.includes(words[i])) {
      typeIndex = i;
      productType = words[i];
      break;
    }
  }

  // Brand is typically everything before the product type
  let brand: string | null = null;
  if (typeIndex > 0) {
    brand = name.split(/\s+/).slice(0, typeIndex).join(' ').trim();
  } else {
    // No type found, take first 2-3 capitalized words as potential brand
    const titleCaseWords = name.split(/\s+/).filter(w => /^[A-Z]/.test(w));
    if (titleCaseWords.length >= 2) {
      brand = titleCaseWords.slice(0, Math.min(3, titleCaseWords.length)).join(' ');
    }
  }

  return { brand, type: productType };
}

/**
 * Simplify product name by removing filler words while keeping meaningful content
 */
export function simplifyProductName(name: string): string {
  const words = name.split(/\s+/);

  const filtered = words.filter(word => {
    const lower = word.toLowerCase();
    return !FILLER_WORDS.includes(lower);
  });

  return filtered.join(' ').trim();
}

/**
 * Generate multiple search query variations from most specific to least specific
 */
export function generateSearchQueries(productName: string): string[] {
  const queries: string[] = [];
  const { brand, type } = extractBrandAndType(productName);

  // Query 1: Full name with INCI specification
  queries.push(`${productName} ingredients INCI list`);

  // Query 2: Full name with ingredients
  queries.push(`${productName} ingredients`);

  // Query 3: Simplified name (remove fillers)
  const simplified = simplifyProductName(productName);
  if (simplified !== productName && simplified.length >= 10) {
    queries.push(`${simplified} ingredients`);
  }

  // Query 4: Brand + product type + ingredients (if we found both)
  if (brand && type && brand.length >= 3) {
    queries.push(`${brand} ${type} ingredients`);
  }

  // Query 5: Just brand + ingredients (broader)
  if (brand && brand.length >= 3) {
    queries.push(`${brand} ingredients`);
  }

  // Query 6: Product type + ingredients (very broad fallback)
  if (type) {
    // Only use this if we have a distinctive product name component
    const distinctiveWords = productName.toLowerCase().split(/\s+/)
      .filter(w => !FILLER_WORDS.includes(w) && !['the', 'to', 'and', 'for', 'with'].includes(w))
      .filter(w => w.length >= 4);

    if (distinctiveWords.length >= 2) {
      queries.push(`${distinctiveWords.slice(0, 2).join(' ')} ${type} ingredients`);
    }
  }

  return queries;
}

/**
 * Get a short search-friendly version of the product name
 */
export function getSearchFriendlyName(productName: string): string {
  const { brand, type } = extractBrandAndType(productName);

  if (brand && type) {
    return `${brand} ${type}`;
  }

  const simplified = simplifyProductName(productName);
  return simplified || productName;
}
