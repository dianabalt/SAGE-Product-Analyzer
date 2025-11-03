// web/lib/canon.ts
/**
 * Ingredient Token Canonicalization for SAGE v2
 *
 * Normalizes ingredient names using INCI (International Nomenclature of Cosmetic Ingredients) aliases.
 * Helps with:
 * - Dictionary coverage calculation (validator v2)
 * - Ingredient deduplication across sources (Phase C reconciliation)
 * - Common name → INCI name mapping
 *
 * Phase A: Used for dictionary coverage checks (shadow mode)
 * Phase C: Used for cross-source ingredient matching
 *
 * Examples:
 * - "Vitamin E" → "Tocopherol"
 * - "SLS" → "Sodium Lauryl Sulfate"
 * - "Hyaluronic Acid" → "Sodium Hyaluronate"
 */

// ============ INCI Alias Dictionary ============

/**
 * INCI alias dictionary - maps common names to INCI standard names
 * Expandable via data/inci_alias.json in future phases
 */
const INCI_ALIASES: Record<string, string> = {
  // ========== Vitamins ==========
  'vitamin e': 'tocopherol',
  'vitamin c': 'ascorbic acid',
  'vitamin b3': 'niacinamide',
  'vitamin b5': 'panthenol',
  'vitamin a': 'retinol',
  'vitamin d': 'cholecalciferol',
  'vitamin d3': 'cholecalciferol',
  'vitamin d2': 'ergocalciferol',
  'vitamin k': 'phytonadione',
  'vitamin k2': 'menaquinone',
  'vitamin k1': 'phylloquinone',
  'vitamin b12': 'cobalamin',
  'vitamin b6': 'pyridoxine',
  'vitamin b1': 'thiamine',
  'vitamin b2': 'riboflavin',
  'vitamin b9': 'folic acid',
  'vitamin h': 'biotin',

  // ========== Common Chemical Acronyms ==========
  'sls': 'sodium lauryl sulfate',
  'sles': 'sodium laureth sulfate',
  'aha': 'alpha hydroxy acid',
  'bha': 'beta hydroxy acid',
  'pha': 'polyhydroxy acid',
  'dmae': 'dimethylaminoethanol',
  'mct': 'medium chain triglycerides',
  'epa': 'eicosapentaenoic acid',
  'dha': 'docosahexaenoic acid',

  // ========== Skin Care Actives ==========
  'hyaluronic acid': 'sodium hyaluronate',
  'salicylic acid': 'beta hydroxy acid',
  'glycolic acid': 'alpha hydroxy acid',
  'lactic acid': 'alpha hydroxy acid',
  'tretinoin': 'retinoic acid',
  'retinol': 'vitamin a',

  // ========== Botanical Common Names → INCI ==========
  'coconut oil': 'cocos nucifera oil',
  'jojoba oil': 'simmondsia chinensis seed oil',
  'argan oil': 'argania spinosa kernel oil',
  'rosehip oil': 'rosa canina fruit oil',
  'sweet almond oil': 'prunus amygdalus dulcis oil',
  'avocado oil': 'persea gratissima oil',
  'olive oil': 'olea europaea fruit oil',
  'sunflower oil': 'helianthus annuus seed oil',
  'grapeseed oil': 'vitis vinifera seed oil',

  // Butters
  'shea butter': 'butyrospermum parkii butter',
  'cocoa butter': 'theobroma cacao seed butter',
  'mango butter': 'mangifera indica seed butter',

  // Extracts
  'chamomile': 'chamomilla recutita',
  'chamomile extract': 'chamomilla recutita extract',
  'lavender': 'lavandula angustifolia',
  'lavender oil': 'lavandula angustifolia oil',
  'tea tree': 'melaleuca alternifolia',
  'tea tree oil': 'melaleuca alternifolia leaf oil',
  'peppermint': 'mentha piperita',
  'peppermint oil': 'mentha piperita oil',
  'eucalyptus': 'eucalyptus globulus',
  'eucalyptus oil': 'eucalyptus globulus leaf oil',
  'rosemary': 'rosmarinus officinalis',
  'rosemary extract': 'rosmarinus officinalis leaf extract',
  'aloe vera': 'aloe barbadensis',
  'aloe vera gel': 'aloe barbadensis leaf juice',
  'green tea': 'camellia sinensis',
  'green tea extract': 'camellia sinensis leaf extract',
  'witch hazel': 'hamamelis virginiana',
  'witch hazel extract': 'hamamelis virginiana water',

  // ========== Preservatives ==========
  'parabens': 'methylparaben',  // Generic → specific
  'phenoxyethanol': 'phenoxyethanol',
  'benzyl alcohol': 'benzyl alcohol',
  'potassium sorbate': 'potassium sorbate',
  'sodium benzoate': 'sodium benzoate',

  // ========== Emulsifiers ==========
  'polysorbate 20': 'polysorbate 20',
  'polysorbate 80': 'polysorbate 80',
  'lecithin': 'lecithin',

  // ========== Humectants ==========
  'glycerin': 'glycerin',
  'glycerine': 'glycerin',
  'glycerol': 'glycerin',
  'propylene glycol': 'propylene glycol',
  'butylene glycol': 'butylene glycol',
  'sorbitol': 'sorbitol',

  // ========== Thickeners ==========
  'xanthan gum': 'xanthan gum',
  'carbomer': 'carbomer',
  'cellulose gum': 'cellulose gum',

  // ========== Minerals & Pigments ==========
  'titanium dioxide': 'ci 77891',
  'iron oxide': 'ci 77491',
  'zinc oxide': 'zinc oxide',
  'mica': 'mica',

  // ========== Supplements ==========
  'omega 3': 'eicosapentaenoic acid',
  'omega-3': 'eicosapentaenoic acid',
  'fish oil': 'omega-3 fatty acids',
  'flaxseed oil': 'linum usitatissimum seed oil',
  'glucosamine': 'glucosamine',
  'chondroitin': 'chondroitin sulfate',
  'msm': 'methylsulfonylmethane',
  'coq10': 'ubiquinone',
  'coenzyme q10': 'ubiquinone'
};

/**
 * Canonicalize ingredient token using alias dictionary
 *
 * Returns: INCI standard name if found, original token otherwise
 */
export function canonicalizeToken(token: string): string {
  if (!token) return token;

  const lower = token.toLowerCase().trim();
  return INCI_ALIASES[lower] || token;
}

/**
 * Load alias dictionary (for future expansion from JSON file)
 * Phase A: returns hardcoded dictionary
 * Phase B+: can load from data/inci_alias.json
 */
export function loadAliasDictionary(): Record<string, string> {
  return { ...INCI_ALIASES };
}

/**
 * Calculate dictionary coverage (what % of tokens are known ingredients)
 *
 * Used by validator v2 to determine if extracted text looks like real ingredients.
 * Low coverage (<35%) = likely marketing copy or non-ingredient text
 *
 * Returns: 0.0 to 1.0 (percentage as decimal)
 */
export function calculateDictionaryCoverage(tokens: string[]): number {
  if (tokens.length === 0) return 0;

  const knownTokens = tokens.filter(token => {
    // Check if token has a dictionary entry
    const canonical = canonicalizeToken(token);
    if (canonical !== token) return true; // Found in dictionary

    // Check if token looks like a known INCI ingredient (heuristic)
    return isKnownINCI(token);
  });

  return knownTokens.length / tokens.length;
}

/**
 * Check if token looks like a known INCI ingredient using heuristics
 *
 * Patterns:
 * - Chemical hints: sodium, acid, glycerin, oxide, sulfate
 * - Botanical hints: extract, oil, butter, leaf, seed
 * - INCI patterns: PEG-40, CI 77891, FD&C
 */
function isKnownINCI(token: string): boolean {
  if (!token) return false;

  const lower = token.toLowerCase();

  // Chemical suffixes and prefixes
  const chemicalPatterns = [
    /\b(sodium|potassium|calcium|magnesium|aluminum)\b/,
    /\b(acid|glycerin|glycerol|alcohol|amine|amide)\b/,
    /\b(oxide|sulfate|chloride|carbonate|phosphate|nitrate)\b/,
    /\b(hydroxide|peroxide|dioxide|citrate|benzoate|sorbate)\b/,
    /\b(paraben|siloxane|silica|tocopherol|retinol|niacinamide)\b/,
    /\b(panthenol|allantoin|urea|betaine|xanthan)\b/,
    /\b(cetyl|stearyl|lauryl|myristyl|palmityl|oleyl)\b/
  ];

  for (const pattern of chemicalPatterns) {
    if (pattern.test(lower)) return true;
  }

  // Botanical indicators
  const botanicalPatterns = [
    /\b(extract|oil|butter|wax)\b/,
    /\b(leaf|root|seed|flower|fruit|bark|berry|peel|stem)\b/,
    /\b(herb|plant|botanical)\b/
  ];

  for (const pattern of botanicalPatterns) {
    if (pattern.test(lower)) return true;
  }

  // INCI-specific patterns
  if (/\bpeg-\d+\b/.test(lower)) return true;  // PEG-40, PEG-100
  if (/\bppg-\d+\b/.test(lower)) return true;  // PPG-15
  if (/\bci\s?\d{5}/.test(lower)) return true; // CI 77891
  if (/\bfd&c\b/.test(lower)) return true;     // FD&C Yellow 5
  if (/\b(yellow|red|blue|green|black|white)\s+\d+\b/.test(lower)) return true; // Yellow 5

  // Color indicators (common in cosmetics)
  if (/\b(pigment|colorant|dye)\b/.test(lower)) return true;

  // Percentage indicators (dosage in supplements)
  if (/\d+%/.test(token)) return true;

  return false;
}

/**
 * Batch canonicalize tokens (for efficiency)
 *
 * Returns: Map of original token → canonical name
 */
export function canonicalizeTokens(tokens: string[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const token of tokens) {
    if (!map.has(token)) {
      map.set(token, canonicalizeToken(token));
    }
  }

  return map;
}

/**
 * Get all known INCI aliases (for debugging/introspection)
 */
export function getAllAliases(): Record<string, string> {
  return { ...INCI_ALIASES };
}

/**
 * Check if a token has a known alias
 */
export function hasAlias(token: string): boolean {
  if (!token) return false;
  const lower = token.toLowerCase().trim();
  return lower in INCI_ALIASES;
}
