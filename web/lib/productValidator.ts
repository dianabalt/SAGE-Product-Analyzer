// web/lib/productValidator.ts
// Coded product validator with confidence scoring
// Used to validate if extracted ingredients match the intended product

/**
 * Product validation result
 */
export interface ValidationResult {
  confidence: number;      // 0-100 confidence score
  isMatch: boolean;        // true if confidence >= 80
  details: {
    tokenOverlap: number;   // 0-50 points
    urlSlugMatch: number;   // 0-30 points
    synonymBonus: number;   // 0 or +30 points (bonus for known product line synonyms)
    lineIdentifier: number; // 0 or -20 points (penalty for mismatches)
    spfMatch: number;       // 0 or -15 points (penalty for different SPF)
    sourceBonus: number;    // 0-20 points (authoritative source bonus)
  };
  reasons: string[];       // Explanation of scoring
}

/**
 * Normalize text for comparison (lowercase, remove special chars, trim)
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Replace special chars with space
    .replace(/\s+/g, ' ')       // Collapse multiple spaces
    .trim();
}

/**
 * Extract tokens from text (filter out common words)
 */
function extractTokens(text: string): Set<string> {
  const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'should', 'could', 'may', 'might', 'must', 'can', 'oz', 'ml',
    'fl', 'g', 'mg', 'lb', 'pkg', 'pack', 'count', 'ct'
  ]);

  const normalized = normalize(text);
  const tokens = normalized.split(/\s+/);

  return new Set(
    tokens.filter(token =>
      token.length >= 2 &&           // At least 2 chars
      !STOPWORDS.has(token) &&       // Not a stopword
      !/^\d+$/.test(token)           // Not a pure number
    )
  );
}

/**
 * Calculate Jaccard similarity between two sets of tokens
 * Returns value between 0 (no overlap) and 1 (identical)
 */
function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  if (union.size === 0) return 0;

  return intersection.size / union.size;
}

/**
 * Extract product line identifiers from text
 * Examples: "intensive", "ultra", "daily", "advanced", "gentle", etc.
 */
function extractProductLineIdentifiers(text: string): Set<string> {
  const LINE_IDENTIFIERS = [
    'intensive', 'ultra', 'daily', 'advanced', 'gentle', 'sensitive',
    'original', 'classic', 'premium', 'professional', 'clinical',
    'extra', 'maximum', 'regular', 'light', 'lightweight', 'rich',
    'deep', 'rapid', 'instant', 'overnight', 'daytime', 'nighttime',
    'am', 'pm', 'renewal', 'repair', 'resurfacing', 'renewing'
  ];

  const normalized = normalize(text);
  const found = new Set<string>();

  for (const identifier of LINE_IDENTIFIERS) {
    if (normalized.includes(identifier)) {
      found.add(identifier);
    }
  }

  return found;
}

/**
 * Extract SPF level from text
 * Returns number or null if not found
 */
function extractSpf(text: string): number | null {
  const match = text.match(/spf\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Check if URL slug matches product name tokens
 */
function checkUrlSlugMatch(url: string, productTokens: Set<string>): number {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Extract product slug from URL (last segment before query params)
    // Example: /ip/CeraVe-Moisturizing-Cream-16-oz/123456 → cerave-moisturizing-cream-16-oz
    const segments = pathname.split('/').filter(s => s.length > 0);
    const slugSegment = segments.find(seg =>
      seg.length > 10 &&                    // Long enough to be product name
      !seg.match(/^\d+$/) &&                // Not a pure number (ID)
      seg.includes('-')                     // Contains hyphens (product slug format)
    );

    if (!slugSegment) return 0;

    // Tokenize slug
    const slugTokens = extractTokens(slugSegment.replace(/-/g, ' '));

    // Calculate overlap
    const overlap = jaccardSimilarity(productTokens, slugTokens);

    // Convert to 0-30 scale
    return Math.round(overlap * 30);

  } catch {
    return 0; // Invalid URL
  }
}

/**
 * Product line synonyms dictionary for both COSMETICS and FOOD products
 * Maps canonical product names to their known variants
 */
const PRODUCT_LINE_SYNONYMS: Record<string, string[]> = {
  // ===== COSMETIC PRODUCTS =====

  // Dove
  'dove beauty bar': ['dove cream bar', 'dove white beauty bar', 'dove moisturizing bar', 'dove original bar', 'dove soap bar', 'dove bar soap', 'dove beauty cream bar'],

  // CeraVe
  'cerave moisturizing cream': ['cerave daily moisturizing lotion', 'cerave facial moisturizing lotion', 'cerave moisturizing lotion', 'cerave cream'],
  'cerave hydrating cleanser': ['cerave hydrating facial cleanser', 'cerave face wash', 'cerave hydrating face wash'],
  'cerave sa cleanser': ['cerave salicylic acid cleanser', 'cerave sa face wash'],

  // Neutrogena
  'neutrogena hydro boost': ['neutrogena water gel', 'neutrogena hydrating gel cream', 'neutrogena gel cream'],

  // ===== FOOD/SUPPLEMENT PRODUCTS =====

  // Quest Bars
  'quest protein bar': ['quest bar', 'quest nutrition bar', 'quest protein'],

  // Optimum Nutrition
  'optimum nutrition whey': ['on gold standard whey', 'gold standard 100% whey', 'optimum whey protein', 'on whey'],

  // Nature Made (vitamins)
  'nature made vitamin d3': ['nature made d3', 'nature made vitamin d'],

  // Orgain
  'orgain organic protein powder': ['orgain protein powder', 'orgain organic protein', 'orgain vegan protein', 'orgain protein'],

  // Kind Bars
  'kind bar': ['kind nut bar', 'kind fruit and nut bar', 'kind nutrition bar']
};

/**
 * Check if two product names are known synonyms from the same product line
 * Returns true if both names match variants of the same canonical product
 */
function areProductLineSynonyms(name1: string, name2: string): boolean {
  const lower1 = normalize(name1);
  const lower2 = normalize(name2);

  // Check each canonical product and its variants
  for (const [canonical, variants] of Object.entries(PRODUCT_LINE_SYNONYMS)) {
    const allNames = [canonical, ...variants].map(n => normalize(n));

    // Check if both names contain any variant from this product family
    const matches1 = allNames.some(variant => lower1.includes(variant) || variant.includes(lower1));
    const matches2 = allNames.some(variant => lower2.includes(variant) || variant.includes(lower2));

    if (matches1 && matches2) {
      return true; // Both match the same product line family
    }
  }

  return false;
}

/**
 * Determine if source is authoritative (high-quality ingredient databases)
 */
function getSourceBonus(url: string): number {
  const AUTHORITATIVE_SOURCES = [
    'incidecoder.com',
    'skinsort.com',
    'dailymed.nlm.nih.gov',
    'fda.gov',
    'nih.gov',
    'openfoodfacts.org',
    'ewg.org'
  ];

  const SEMI_AUTHORITATIVE = [
    'walmart.com',      // Retail with ingredient info
    'target.com',       // Retail with ingredient info
    'amazon.com',       // Retail with ingredient info
    'sephora.com',
    'ulta.com',
    'dermstore.com',
    'paulaschoice.com'
  ];

  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');

    if (AUTHORITATIVE_SOURCES.some(src => hostname.includes(src))) {
      return 20; // Top-tier sources
    }

    if (SEMI_AUTHORITATIVE.some(src => hostname.includes(src))) {
      return 10; // Good sources
    }

    return 0; // Unknown source

  } catch {
    return 0;
  }
}

/**
 * Validate if source product matches our intended product
 *
 * @param ourProductName - The product we're trying to find (e.g., "CeraVe Moisturizing Cream")
 * @param sourceProductName - The product name from the source page (e.g., "CeraVe Intensive Moisturizing Cream")
 * @param sourceUrl - The URL of the source page (used for slug validation and source bonus)
 * @returns ValidationResult with confidence score and details
 */
export function validateProductMatch(
  ourProductName: string,
  sourceProductName: string,
  sourceUrl: string
): ValidationResult {
  const reasons: string[] = [];
  let totalScore = 0;

  // Extract tokens from both product names
  const ourTokens = extractTokens(ourProductName);
  const sourceTokens = extractTokens(sourceProductName);

  // 1. Token Overlap (0-50 points)
  const tokenSimilarity = jaccardSimilarity(ourTokens, sourceTokens);
  const tokenScore = Math.round(tokenSimilarity * 50);
  totalScore += tokenScore;

  if (tokenSimilarity >= 0.8) {
    reasons.push(`✅ High token overlap (${Math.round(tokenSimilarity * 100)}%)`);
  } else if (tokenSimilarity >= 0.6) {
    reasons.push(`⚠️ Moderate token overlap (${Math.round(tokenSimilarity * 100)}%)`);
  } else {
    reasons.push(`❌ Low token overlap (${Math.round(tokenSimilarity * 100)}%)`);
  }

  // 2. URL Slug Match (0-30 points)
  const slugScore = checkUrlSlugMatch(sourceUrl, ourTokens);
  totalScore += slugScore;

  if (slugScore >= 20) {
    reasons.push(`✅ URL slug matches product name`);
  } else if (slugScore >= 10) {
    reasons.push(`⚠️ URL slug partially matches`);
  } else {
    reasons.push(`❌ URL slug doesn't match product name`);
  }

  // 2.5. Product Line Synonyms Check (+30 bonus points)
  // Check if products are known variants of the same product line
  let synonymBonus = 0;
  if (areProductLineSynonyms(ourProductName, sourceProductName)) {
    synonymBonus = 30;
    totalScore += synonymBonus;
    reasons.push(`✅ Recognized product line synonyms (e.g., Dove Beauty Bar variants)`);
  }

  // 3. Product Line Identifier Check (0 or -20 penalty)
  const ourIdentifiers = extractProductLineIdentifiers(ourProductName);
  const sourceIdentifiers = extractProductLineIdentifiers(sourceProductName);

  let lineScore = 0;

  // Check for conflicting identifiers
  const conflicts: string[] = [];
  for (const sourceId of sourceIdentifiers) {
    if (!ourIdentifiers.has(sourceId) && ourIdentifiers.size > 0) {
      conflicts.push(sourceId);
    }
  }

  if (conflicts.length > 0) {
    lineScore = -20;
    totalScore += lineScore;
    reasons.push(`❌ Different product line: source has "${conflicts.join(', ')}" not in our product`);
  } else if (ourIdentifiers.size > 0 || sourceIdentifiers.size > 0) {
    reasons.push(`✅ No conflicting product line identifiers`);
  }

  // 4. SPF Level Check (0 or -15 penalty)
  const ourSpf = extractSpf(ourProductName);
  const sourceSpf = extractSpf(sourceProductName);

  let spfScore = 0;

  if (ourSpf !== null && sourceSpf !== null && ourSpf !== sourceSpf) {
    spfScore = -15;
    totalScore += spfScore;
    reasons.push(`❌ Different SPF levels: ours=${ourSpf}, source=${sourceSpf}`);
  } else if (ourSpf !== null && sourceSpf !== null) {
    reasons.push(`✅ SPF levels match (${ourSpf})`);
  }

  // 5. Authoritative Source Bonus (0-20 points)
  const sourceBonus = getSourceBonus(sourceUrl);
  totalScore += sourceBonus;

  if (sourceBonus === 20) {
    reasons.push(`✅ Authoritative source (${new URL(sourceUrl).hostname})`);
  } else if (sourceBonus === 10) {
    reasons.push(`✅ Reputable source (${new URL(sourceUrl).hostname})`);
  }

  // Calculate final confidence (clamp to 0-100)
  const confidence = Math.max(0, Math.min(100, totalScore));

  // Determine if it's a match (75+ confidence threshold)
  const isMatch = confidence >= 75;

  return {
    confidence,
    isMatch,
    details: {
      tokenOverlap: tokenScore,
      urlSlugMatch: slugScore,
      synonymBonus,
      lineIdentifier: lineScore,
      spfMatch: spfScore,
      sourceBonus
    },
    reasons
  };
}

/**
 * Batch validate multiple sources against a product
 * Returns sources sorted by confidence (highest first)
 */
export function validateMultipleSources(
  productName: string,
  sources: Array<{ name: string; url: string }>
): Array<{ source: { name: string; url: string }; validation: ValidationResult }> {
  const results = sources.map(source => ({
    source,
    validation: validateProductMatch(productName, source.name, source.url)
  }));

  // Sort by confidence (highest first)
  return results.sort((a, b) => b.validation.confidence - a.validation.confidence);
}
