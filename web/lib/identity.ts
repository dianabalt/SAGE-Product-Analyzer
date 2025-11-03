// web/lib/identity.ts
/**
 * Product Identity Scoring for SAGE v2
 *
 * Prevents false positives from wrong product variants (size/scent/form mismatches).
 * Uses structured data (JSON-LD) + page signals (title/H1/breadcrumbs) to score identity.
 *
 * Key features:
 * - Hard brand gate: brand mismatch → immediate rejection (score 0)
 * - GTIN check digit validation (UPC-12, EAN-13, GTIN-14)
 * - Size normalization: fl oz ↔ ml, net wt oz ↔ grams (separate channels)
 * - Scent/shade normalization with synonym handling
 * - Domain boost: manufacturer sites get +0.5 confidence
 *
 * Scoring breakdown:
 * - Brand match (hard gate): 3.0 base
 * - Domain boost: +0.5 (manufacturer site)
 * - Name tokens: +0.0 to +1.0 (proportional to matches)
 * - Size match: +1.0 (within 10% tolerance, same unit type)
 * - Form match: +0.5 (soap, serum, capsule, etc.)
 * - Scent/shade match: +0.75
 * - GTIN exact match: +5.0 (decisive, requires valid check digit)
 *
 * Threshold: ≥4.0 to pass (configurable via SAGE_IDENTITY_THRESHOLD)
 */

import { flags } from './flags';

// ============ Types ============

export type ProductIdentity = {
  brand: string;
  name: string;
  size: string | null;        // Normalized to "100 ml" or "50 g"
  sizeUnit: 'ml' | 'g' | null; // Track unit type separately
  form: string | null;         // "soap", "serum", "capsule", "tablet"
  scentShade: string | null;   // "peppermint", "lavender", "unscented"
  gtin: string | null;         // UPC/EAN/GTIN (validated)
  sku: string | null;
  region: string | null;       // "US", "EU", etc.
};

export type PageSignals = {
  title: string;               // <title> or og:title
  h1: string;                  // First <h1> on page
  breadcrumbs: string[];       // Breadcrumb trail
  urlHost: string;             // Domain (e.g., "sephora.com")
};

export type IdentityGateResult = {
  score: number;
  passed: boolean;
  reason?: 'brand_mismatch' | 'low_score' | 'gtin_conflict' | 'size_mismatch' | 'scent_mismatch';
  breakdown: {
    brandMatch: boolean;
    nameTokensMatched: number;
    nameTokensTotal: number;
    sizeMatch: boolean;
    formMatch: boolean;
    scentMatch: boolean;
    gtinValid: boolean;
    gtinMatch: boolean;
    domainBoost: number;
  };
};

// ============ Brand Normalization ============

/**
 * Normalize brand names for matching
 * Handles: apostrophes, special chars, common variations
 */
export function normalizeBrand(brand: string): string {
  if (!brand) return '';

  return brand
    .toLowerCase()
    .replace(/['']/g, '')  // Remove apostrophes: "L'Oréal" → "Loreal"
    .replace(/[éèê]/g, 'e') // Normalize accents
    .replace(/l'or[eé]al paris|l oreal paris/i, 'loreal')
    .replace(/dr\.?\s*/i, 'dr ')  // "Dr. Bronner's" → "dr bronners"
    .replace(/\s+/g, ' ')
    .trim();
}

// ============ Size Normalization ============

/**
 * Normalize product size with separate handling for fluid volume vs net weight
 *
 * IMPORTANT: Fluid ounces ≠ Net weight ounces
 * - 1 fl oz = 29.5735 ml (volume)
 * - 1 oz (net wt) = 28.3495 g (weight)
 *
 * Returns: { value: number, unit: 'ml' | 'g' } or null
 */
export function normalizeSize(sizeStr: string | null | undefined): { value: number; unit: 'ml' | 'g' } | null {
  if (!sizeStr) return null;

  const s = sizeStr.toLowerCase().replace(/\s+/g, ' ').trim();

  // Pattern 1: Fluid volume (fl oz → ml)
  const flOzMatch = s.match(/([\d\.]+)\s*(?:fl\s*oz|fluid\s*ounce)/i);
  if (flOzMatch) {
    const ml = parseFloat(flOzMatch[1]) * 29.5735;
    return { value: Math.round(ml), unit: 'ml' };
  }

  // Pattern 2: Milliliters (already ml)
  const mlMatch = s.match(/([\d\.]+)\s*ml/i);
  if (mlMatch) {
    return { value: Math.round(parseFloat(mlMatch[1])), unit: 'ml' };
  }

  // Pattern 3: Liters → ml
  const lMatch = s.match(/([\d\.]+)\s*l(?:iter)?(?!b)/i); // Negative lookahead for "lb"
  if (lMatch) {
    return { value: Math.round(parseFloat(lMatch[1]) * 1000), unit: 'ml' };
  }

  // Pattern 4: Net weight ounces (oz → grams)
  // Only match if NOT "fl oz" and either has "net wt" or no volume indicators
  const netOzMatch = s.match(/([\d\.]+)\s*oz(?:\s*net\s*wt)?/i);
  if (netOzMatch && !s.includes('fl')) {
    const grams = parseFloat(netOzMatch[1]) * 28.3495;
    return { value: Math.round(grams), unit: 'g' };
  }

  // Pattern 5: Grams (already grams)
  const gMatch = s.match(/([\d\.]+)\s*g(?:rams?)?/i);
  if (gMatch) {
    return { value: Math.round(parseFloat(gMatch[1])), unit: 'g' };
  }

  // Pattern 6: Kilograms → grams
  const kgMatch = s.match(/([\d\.]+)\s*kg/i);
  if (kgMatch) {
    return { value: Math.round(parseFloat(kgMatch[1]) * 1000), unit: 'g' };
  }

  // Pattern 7: Pounds → grams
  const lbMatch = s.match(/([\d\.]+)\s*lb/i);
  if (lbMatch) {
    return { value: Math.round(parseFloat(lbMatch[1]) * 453.592), unit: 'g' };
  }

  return null;
}

// ============ Scent Normalization ============

/**
 * Scent/shade normalization with synonyms and common typos
 * Handles: fragrance-free variations, typos, case normalization
 */
const SCENT_ALIASES: Record<string, string> = {
  // Fragrance-free synonyms
  'unscented': 'fragrance-free',
  'zero fragrance': 'fragrance-free',
  'no fragrance': 'fragrance-free',
  'no scent': 'fragrance-free',
  'fragrance free': 'fragrance-free',
  'scent free': 'fragrance-free',

  // Common typos
  'pepermint': 'peppermint',
  'lavendar': 'lavender',
  'eucaliptus': 'eucalyptus',
  'chamomile': 'chamomile',  // British vs American spelling

  // Shade variations
  'nude': 'natural',
  'beige': 'natural',
  'fair': 'light',
  'medium tan': 'medium'
};

export function normalizeScent(scent: string | null | undefined): string | null {
  if (!scent) return null;
  const lower = scent.toLowerCase().trim();
  return SCENT_ALIASES[lower] || lower;
}

// ============ GTIN Validation ============

/**
 * Validate GTIN-14 check digit (also supports UPC-12, EAN-13, GTIN-8)
 *
 * Algorithm:
 * 1. Strip non-digits
 * 2. Verify length (8, 12, 13, or 14 digits)
 * 3. Calculate check digit using alternating 3x/1x weights
 * 4. Compare with last digit
 *
 * Returns: true if valid, false otherwise
 */
export function isValidGTIN14(gtin: string): boolean {
  if (!gtin) return false;

  const s = gtin.replace(/\D/g, ''); // Remove non-digits
  if (![8, 12, 13, 14].includes(s.length)) return false;

  const digits = s.split('').map(Number);
  const check = digits.pop()!;

  // Calculate check digit: reverse, alternate 3x/1x weights
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  const calc = (10 - (sum % 10)) % 10;

  return calc === check;
}

// ============ Domain Boost ============

/**
 * Give identity boost for manufacturer domains
 * Manufacturer sites are more trustworthy for product data
 *
 * Returns: +0.5 for manufacturer domains, 0 for marketplaces/retailers
 */
const KNOWN_MANUFACTURER_DOMAINS: Record<string, string[]> = {
  'cerave': ['cerave.com'],
  'loreal': ['lorealparisusa.com', 'loreal.com', 'lorealparis.com'],
  'neutrogena': ['neutrogena.com'],
  'clinique': ['clinique.com'],
  'theordinary': ['theordinary.com', 'deciem.com'],
  'drbronner': ['drbronner.com'],
  'olay': ['olay.com'],
  'aveeno': ['aveeno.com'],
  'dove': ['dove.com'],
  'eucerin': ['eucerin.com', 'eucerin-us.com'],
  'vaseline': ['vaseline.com']
};

export function brandBoostFromDomain(urlHost: string, brand: string): number {
  if (!urlHost || !brand) return 0;

  const normalizedBrand = normalizeBrand(brand);
  const normalizedHost = urlHost.replace(/^www\./, '').toLowerCase();

  // Check if host is a known manufacturer domain for this brand
  for (const [key, domains] of Object.entries(KNOWN_MANUFACTURER_DOMAINS)) {
    if (normalizedBrand.includes(key)) {
      if (domains.some(d => normalizedHost.includes(d))) {
        return 0.5; // Boost for manufacturer's own site
      }
    }
  }

  return 0;
}

// ============ Identity Scoring ============

/**
 * Score product identity match between page signals and wanted product
 *
 * HARD GATE: Brand must match or score = 0 immediately
 *
 * Additive scoring:
 * - Brand match (hard gate): 3.0 base
 * - Domain boost: +0.5
 * - Name tokens: +0.0 to +1.0
 * - Size match: +1.0
 * - Form match: +0.5
 * - Scent match: +0.75
 * - GTIN match: +5.0 (decisive)
 *
 * Threshold: ≥4.0 to pass (configurable)
 */
export function identityScore(
  pageSignals: PageSignals,
  jsonldId: Partial<ProductIdentity>,
  want: ProductIdentity
): IdentityGateResult {
  const titleText = (pageSignals.title || pageSignals.h1 || '').toLowerCase();

  // ========== HARD GATE: Brand must match ==========
  const wantBrand = normalizeBrand(want.brand);
  const brandJson = normalizeBrand(jsonldId.brand || '');
  const visible = (pageSignals.title + ' ' + pageSignals.h1).toLowerCase();

  // Brand can match via JSON-LD OR visible page text (title/H1)
  // This prevents false rejections when JSON-LD doesn't include brand
  const brandMatch =
    (brandJson && wantBrand && brandJson.includes(wantBrand)) ||
    (!!wantBrand && visible.includes(wantBrand));

  if (!brandMatch) {
    return {
      score: 0,
      passed: false,
      reason: 'brand_mismatch',
      breakdown: {
        brandMatch: false,
        nameTokensMatched: 0,
        nameTokensTotal: 0,
        sizeMatch: false,
        formMatch: false,
        scentMatch: false,
        gtinValid: false,
        gtinMatch: false,
        domainBoost: 0
      }
    };
  }

  let score = 3; // Base score for brand match

  // ========== Domain Boost ==========
  const domainBoost = brandBoostFromDomain(pageSignals.urlHost, want.brand);
  score += domainBoost;

  // ========== Name Token Matching ==========
  const tokens = want.name.toLowerCase().split(/\s+/).filter(w => w.length >= 3 && !['the', 'and', 'for', 'with', 'from', 'this', 'that'].includes(w));
  const matchedTokens = tokens.filter(tok => titleText.includes(tok));
  const nameTokenScore = tokens.length > 0 ? matchedTokens.length / tokens.length : 0;
  score += nameTokenScore;

  // ========== Size Matching ==========
  let sizeMatch = false;
  if (want.size && jsonldId.size) {
    const wantNorm = normalizeSize(want.size);
    const jsonNorm = normalizeSize(jsonldId.size);

    if (wantNorm && jsonNorm && wantNorm.unit === jsonNorm.unit) {
      const diff = Math.abs(wantNorm.value - jsonNorm.value);
      const tolerance = wantNorm.value * 0.1; // 10% tolerance
      sizeMatch = diff <= tolerance;
      if (sizeMatch) score += 1.0;
    }
  }

  // ========== Form Matching ==========
  let formMatch = false;
  if (want.form && titleText.includes(want.form.toLowerCase())) {
    formMatch = true;
    score += 0.5;
  }

  // ========== Scent Matching ==========
  let scentMatch = false;
  if (want.scentShade) {
    const wantScent = normalizeScent(want.scentShade);
    const jsonScent = normalizeScent(jsonldId.scentShade);

    if (wantScent && (titleText.includes(wantScent) || (jsonScent && jsonScent === wantScent))) {
      scentMatch = true;
      score += 0.75;
    }
  }

  // ========== GTIN Matching (Decisive) ==========
  let gtinValid = false;
  let gtinMatch = false;

  if (jsonldId.gtin && want.gtin) {
    gtinValid = isValidGTIN14(jsonldId.gtin);

    if (gtinValid && jsonldId.gtin === want.gtin) {
      gtinMatch = true;
      score += 5.0; // Decisive boost
    } else if (!gtinValid && jsonldId.gtin === want.gtin) {
      // Same GTIN but invalid check digit → conflict (likely corrupted data)
      return {
        score: 0,
        passed: false,
        reason: 'gtin_conflict',
        breakdown: {
          brandMatch,
          nameTokensMatched: matchedTokens.length,
          nameTokensTotal: tokens.length,
          sizeMatch,
          formMatch,
          scentMatch,
          gtinValid: false,
          gtinMatch: false,
          domainBoost
        }
      };
    }
  }

  // ========== Determine Pass/Fail ==========
  const threshold = flags.identityThreshold;
  const passed = score >= threshold;

  let reason: IdentityGateResult['reason'] = undefined;
  if (!passed) {
    // Provide specific reason for failure (helps with debugging)
    if (!sizeMatch && want.size) reason = 'size_mismatch';
    else if (!scentMatch && want.scentShade) reason = 'scent_mismatch';
    else reason = 'low_score';
  }

  return {
    score,
    passed,
    reason,
    breakdown: {
      brandMatch,
      nameTokensMatched: matchedTokens.length,
      nameTokensTotal: tokens.length,
      sizeMatch,
      formMatch,
      scentMatch,
      gtinValid,
      gtinMatch,
      domainBoost
    }
  };
}
