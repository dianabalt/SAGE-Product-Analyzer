// web/lib/ingredientExtract.ts
// Robust ingredient extraction with domain-aware rules + strong cleanup.
// Refactored with paren-preserving splits, strict marketing detection,
// confidence scoring, and deterministic flow.

import * as cheerio from 'cheerio';
import { flags } from './flags';
import { extractJsonLdProduct } from './jsonld';
import type { PageSignals } from './identity';
import { looksLikeIngredients } from './looksLikeIngredients';

type Out = { text: string | null; where: string | null };

// Extended type for detailed extraction results
type ExtractResult = {
  text: string | null;
  where: string | null;
  ingredients?: string[];
  contains?: string[];
  mayContain?: string[];
  confidence?: number;
  tokenCount?: number;
};

// Common "noise" markers we never want in the ingredient list
const CUT_MARKERS = [
  'also-called', 'also called', 'aka', 'what-it-does', 'what it does',
  'comedogenicity', 'irritancy', 'safety', 'details', 'learn more', 'read more',
  // Preservation statements (Amazon issue - "For Freshness.Product")
  'for freshness', 'to preserve freshness', 'to maintain freshness',
  'freshness preserved', 'added to preserve', 'for color',
  // Section headers that leak into ingredients
  'product details', 'product information', 'product description'
];

// Stop phrases that indicate non-ingredient content (navigation, scripts, etc.)
// Apply these BEFORE marketing logic
const STOP_PHRASES = [
  'add to cart', 'buy now', 'shop now', 'add to bag', 'sold out',
  'free shipping', 'customer reviews', 'you may also like',
  'javascript', 'cookie', 'privacy policy', 'terms of service',
  'sign up', 'subscribe', 'newsletter', 'follow us'
];

// Section markers that indicate different ingredient categories
const SECTION_MARKERS = {
  mayContain: /\b(may contain|could contain|possible traces)\b/i,
  freeFrom: /\b(free from|does not contain|without)\b/i,
  warnings: /\b(warning|caution|directions?|usage|storage)\b/i,
};

// Marketing sentence patterns (hard reject if no delimiters)
const MARKETING_PATTERNS = [
  /\b(our|your)\s+(supplements?|products?|formula)\s+(are|is)\s+\w+/i,
  /\b(designed|formulated|created)\s+to\s+/i,
  /\b(supports?|helps?|promotes?|boosts?)\s+(your|healthy|optimal)/i,
  /\bunlock\s+(your|the)\s+potential\b/i,
  /\bmade\s+(from|with)\s+pure\b/i,
  /\bwithout\s+fillers\b/i,
];

// Chemical and botanical hints for validation
const CHEMICAL_HINTS = [
  'oxide', 'sodium', 'potassium', 'calcium', 'magnesium', 'sulfate', 'chloride',
  'acid', 'glycerin', 'glycerol', 'alcohol', 'paraben', 'benzoate', 'citrate',
  'hydroxide', 'carbonate', 'phosphate', 'nitrate', 'sulfide', 'dioxide',
  'peg-', 'ppg-', 'cetyl', 'stearyl', 'lauryl', 'myristyl',
  'dimethicone', 'siloxane', 'silica', 'tocopherol', 'retinol', 'niacinamide',
  'panthenol', 'allantoin', 'urea', 'betaine', 'xanthan',
  'ci ', 'fd&c', 'yellow ', 'red ', 'blue ', 'green ', 'black ', 'white ',
];

const BOTANICAL_HINTS = [
  'extract', 'oil', 'butter', 'wax', 'leaf', 'root', 'seed', 'flower',
  'fruit', 'bark', 'berry', 'peel', 'stem', 'herb', 'plant', 'botanical',
];

// Common first ingredients (protect from boundary trimming)
const FIRST_INGREDIENT_WHITELIST = [
  'water', 'aqua', 'eau', 'woda', 'agua', 'wasser',
];

// EU allergen list - commonly appears at end of ingredient lists (protect from boundary trimming)
const LAST_INGREDIENT_WHITELIST = [
  'limonene', 'linalool', 'citral', 'geraniol', 'citronellol',
  'coumarin', 'eugenol', 'farnesol', 'benzyl alcohol', 'benzyl benzoate',
  'benzyl salicylate', 'cinnamal', 'cinnamyl alcohol', 'hexyl cinnamal',
  'hydroxycitronellal', 'hydroxyisohexyl 3-cyclohexene carboxaldehyde',
  'isoeugenol', 'amyl cinnamal', 'anise alcohol', 'methyl 2-octynoate',
];

const SECT_HEAD_RE = /(ingredients?|ingredient list|supplement facts|active ingredients|other ingredients|inactive ingredients)\b/i;

// ============ Core Utilities ============

/**
 * Normalize Unicode punctuation and bullets to ASCII.
 * Converts Chinese commas/semicolons, bullets, etc. to standard delimiters.
 */
function normalizeUnicodePunctuation(s: string): string {
  // Chinese/fullwidth punctuation
  s = s.replace(/\u3001/g, ','); // Ideographic comma
  s = s.replace(/\uff0c/g, ','); // Fullwidth comma
  s = s.replace(/\uff1b/g, ';'); // Fullwidth semicolon
  s = s.replace(/\u3002/g, '.'); // Ideographic period

  // Bullets and list markers
  s = s.replace(/[\u2022\u00B7\u25CF\u2043\u25E6\u25AA\u25AB\u2023\u2219\u25CB\u2218]/g, ',');

  // Vertical bars and other separators
  s = s.replace(/[|\u2758]/g, ',');

  // Non-breaking spaces and special whitespace
  s = s.replace(/[\u00A0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F]/g, ' ');

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ');

  return s.trim();
}

/**
 * Standard normalization: Unicode + whitespace collapse.
 */
function norm(s: string): string {
  return normalizeUnicodePunctuation(s);
}

/**
 * Check if text contains list delimiters (commas, semicolons, bullets, newlines).
 */
function hasListDelimiters(s: string): boolean {
  // Count delimiters
  const delimiterCount = (s.match(/[,;\n]/g) || []).length;
  // Or has many words (likely a list even without explicit delimiters)
  const wordCount = s.split(/\s+/).length;
  return delimiterCount >= 2 || wordCount > 10;
}

/**
 * Check if text matches marketing sentence patterns (no delimiters required).
 */
function isMarketingSentence(s: string): boolean {
  for (const pattern of MARKETING_PATTERNS) {
    if (pattern.test(s)) return true;
  }
  return false;
}

/**
 * Check if text is likely marketing copy vs ingredients.
 * Only hard-reject if NO delimiters present AND matches marketing patterns.
 */
function looksLikeMarketing(s: string): boolean {
  // If it has delimiters, treat as potential ingredient block even with marketing adjectives
  if (hasListDelimiters(s)) return false;

  // No delimiters + marketing patterns = reject
  if (isMarketingSentence(s)) return true;

  // Count marketing phrases (only reject if excessive and no delimiters)
  let marketingCount = 0;
  const lowerText = s.toLowerCase();
  const marketingWords = [
    'unlock', 'potential', 'pure', 'fillers', 'supplements', 'formula',
    'designed', 'formulated', 'supports', 'helps', 'promotes', 'boosts',
    'optimal', 'healthy', 'wellness', 'vitality', 'nourish', 'enhance',
  ];

  for (const word of marketingWords) {
    if (lowerText.includes(word)) marketingCount++;
  }

  return marketingCount >= 3;
}

/**
 * Check if text contains stop phrases (navigation, scripts).
 * Apply this BEFORE marketing logic.
 */
function containsStopPhrases(s: string): boolean {
  const lower = s.toLowerCase();
  return STOP_PHRASES.some(phrase => lower.includes(phrase));
}

/**
 * Check if text looks like an ingredient list vs. customer review or marketing copy.
 * Rejects text containing review-like phrases and validates presence of ingredient-like patterns.
 */
function looksLikeIngredientList(text: string): boolean {
  const lower = text.toLowerCase();

  // Reject if contains review-like phrases
  const reviewPhrases = [
    'i love', 'i hate', 'i recommend', 'i tried', 'this product',
    'highly recommend', 'would recommend', 'stars', 'rating',
    'pros:', 'cons:', 'purchased', 'ordered', 'bought this',
    'great product', 'love this', 'works well', 'not worth',
    'waste of money', 'best ever', 'disappointed'
  ];

  if (reviewPhrases.some(phrase => lower.includes(phrase))) {
    return false;
  }

  // Count marketing sentence patterns (product description language)
  let marketingPatternCount = 0;

  // Pattern 1: Action verbs in marketing context
  const actionVerbs = ['makes a', 'provides', 'helps', 'supports', 'boosts', 'fuels', 'powers', 'energizes'];
  if (actionVerbs.some(verb => lower.includes(verb))) {
    marketingPatternCount++;
  }

  // Pattern 2: Lifestyle/usage contexts
  const lifestyleContexts = ['at work', 'before the gym', 'after workout', 'on the go', 'gym', 'workout'];
  if (lifestyleContexts.some(ctx => lower.includes(ctx))) {
    marketingPatternCount++;
  }

  // Pattern 3: Descriptive adjectives for food/products
  const descriptiveAdjectives = ['tasty', 'wholesome', 'delicious', 'nutritious', 'great', 'perfect', 'ideal'];
  if (descriptiveAdjectives.some(adj => lower.includes(adj))) {
    marketingPatternCount++;
  }

  // Pattern 4: Serving/nutrition marketing language
  const nutritionMarketing = ['each serving', 'per serving', 'daily value', 'grams of protein', 'g of protein', 'grams of fiber', 'g of fiber'];
  if (nutritionMarketing.some(phrase => lower.includes(phrase))) {
    marketingPatternCount++;
  }

  // Reject if 2+ marketing patterns detected (likely product description, not ingredients)
  if (marketingPatternCount >= 2) {
    console.log('[Amazon] Rejected: Contains', marketingPatternCount, 'marketing sentence patterns (likely product description)');
    return false;
  }

  // Ingredient lists typically have proper nouns (brand names, botanical names) and chemical names
  const hasProperNouns = /[A-Z][a-z]+\s[A-Z][a-z]+/.test(text); // e.g., "Whey Protein", "Aloe Vera"
  const hasChemicalNames = /(acid|oxide|ium|ate|ine|ose|glyc|sulf|phos|hydr)\b/i.test(text); // Common chemical suffixes/prefixes

  // Should have at least one of these characteristics for ingredient lists
  return hasProperNouns || hasChemicalNames;
}

/**
 * Split text on delimiters while preserving parentheses content.
 * Handles: "Aqua (Water, Eau)", "CI 77891 (Titanium Dioxide)"
 */
function parenPreservingSplit(s: string): string[] {
  // Temporary placeholders for masked content
  const masked: string[] = [];
  let maskIndex = 0;

  // Mask content inside parentheses and brackets
  let result = s.replace(/[(\[{]([^)\]}]*)[)\]}]/g, (match) => {
    const placeholder = `__MASK${maskIndex}__`;
    masked[maskIndex] = match;
    maskIndex++;
    return placeholder;
  });

  // Split on top-level delimiters: comma, semicolon, newline
  const tokens = result.split(/[,;\n]+/).map(t => t.trim()).filter(Boolean);

  // Unmask parentheses content
  const unmasked = tokens.map(token => {
    let unmaskedToken = token;
    for (let i = 0; i < masked.length; i++) {
      unmaskedToken = unmaskedToken.replace(`__MASK${i}__`, masked[i]);
    }
    return unmaskedToken.trim();
  });

  return unmasked.filter(Boolean);
}

/**
 * Count chemical/botanical hints in text.
 */
function countIngredientHints(s: string): number {
  const lower = s.toLowerCase();
  let count = 0;

  for (const hint of CHEMICAL_HINTS) {
    if (lower.includes(hint.toLowerCase())) count++;
  }
  for (const hint of BOTANICAL_HINTS) {
    if (lower.includes(hint.toLowerCase())) count++;
  }

  // Also count INCI-style patterns (e.g., PEG-40, CI 77891)
  const peg = (lower.match(/\bpeg-\d+/g) || []).length;
  const ci = (lower.match(/\bci\s+\d{5}/g) || []).length;
  const percentages = (lower.match(/\d+%/g) || []).length;

  count += peg + ci + percentages;

  return count;
}

/**
 * Filter and clean individual tokens after splitting.
 */
function filterToken(token: string, reason: { value: string }): string | null {
  token = norm(token);

  if (!token || token.length < 2) {
    reason.value = 'too short';
    return null;
  }

  // Strip footnote markers (*, †, ±) from token without removing the token itself
  token = token.replace(/[*†±]/g, '').trim();

  // WHITELIST CHECK - protect common first/last ingredients from boundary trimming
  // These are often simple words that lack chemical/botanical hints but are valid ingredients
  // Check if token CONTAINS whitelisted ingredient (e.g., "Limonene *CERTIFIED FAIR TRADE...")
  const tokenLower = token.toLowerCase();

  // First check for exact match (fast path)
  if (FIRST_INGREDIENT_WHITELIST.includes(tokenLower) ||
      LAST_INGREDIENT_WHITELIST.includes(tokenLower)) {
    return token; // Protected - exact match
  }

  // Then check if token CONTAINS a whitelisted ingredient at the start or end
  // This handles cases like:
  // - "Limonene *CERTIFIED FAIR TRADE ±Regenerative Organic..." → "Limonene"
  // - "read Lisa Bronner's Liquid Soaps Dilutions Cheat Sheet. Ingredients Water" → "Water"
  for (const whitelisted of [...FIRST_INGREDIENT_WHITELIST, ...LAST_INGREDIENT_WHITELIST]) {
    // Check if whitelisted ingredient appears at the START
    if (tokenLower.startsWith(whitelisted + ' ') ||
        tokenLower.startsWith(whitelisted + '*') ||
        tokenLower.startsWith(whitelisted + '†') ||
        tokenLower.startsWith(whitelisted + '±')) {
      // Extract just the whitelisted ingredient name (capitalize first letter)
      const capitalizedName = whitelisted.charAt(0).toUpperCase() + whitelisted.slice(1);
      return capitalizedName;
    }

    // Check if whitelisted ingredient appears at the END
    if (tokenLower.endsWith(' ' + whitelisted) ||
        tokenLower.endsWith('*' + whitelisted) ||
        tokenLower.endsWith('†' + whitelisted) ||
        tokenLower.endsWith('±' + whitelisted)) {
      // Extract just the whitelisted ingredient name (capitalize first letter)
      const capitalizedName = whitelisted.charAt(0).toUpperCase() + whitelisted.slice(1);
      return capitalizedName;
    }
  }


  // Strip heading prefixes
  token = token.replace(/^(ingredients?|other ingredients?|inactive ingredients?|active ingredients?):\s*/i, '');

  // Drop if token is ONLY a heading word (standalone "Ingredients", "Other Ingredients", etc.)
  if (/^(ingredients?|other ingredients?|inactive ingredients?|active ingredients?|supplement facts?|nutrition facts?)$/i.test(token)) {
    reason.value = 'heading word only';
    return null;
  }

  // Drop section markers
  if (SECTION_MARKERS.mayContain.test(token) ||
      SECTION_MARKERS.freeFrom.test(token) ||
      SECTION_MARKERS.warnings.test(token)) {
    reason.value = 'section marker';
    return null;
  }

  // Drop tokens starting with period (HTML fragments like ".Product", ".Details")
  if (/^\./.test(token)) {
    reason.value = 'HTML fragment (starts with .)';
    return null;
  }

  // Drop preservation/freshness statements
  if (/^(for|to preserve|to maintain|added to preserve)\s+(freshness|color|flavor)/i.test(token)) {
    reason.value = 'preservation statement';
    return null;
  }

  // Drop section header fragments (Product, Details, Information as standalone words)
  if (/^(product|details|information|description)$/i.test(token)) {
    reason.value = 'section header fragment';
    return null;
  }

  // Drop pure dosage tokens (e.g., "60 mg" without a name)
  if (/^\d+\s*(mg|mcg|g|iu|%)\s*$/i.test(token)) {
    reason.value = 'pure dosage';
    return null;
  }

  // Drop if too long (likely full sentences or junk)
  if (token.length > 150) {
    reason.value = 'too long';
    return null;
  }

  // Drop if no letters
  if (!/[a-zA-Z]/.test(token)) {
    reason.value = 'no letters';
    return null;
  }

  // Drop if it's a marketing sentence with no delimiters
  if (isMarketingSentence(token) && !hasListDelimiters(token)) {
    reason.value = 'marketing sentence';
    return null;
  }

  // Keep if it has chemical/botanical hints
  if (countIngredientHints(token) > 0) {
    return token;
  }

  // Keep if it looks like a reasonable ingredient (has word structure)
  if (token.split(/\s+/).length <= 6 && token.length >= 3) {
    return token;
  }

  reason.value = 'no ingredient hints';
  return null;
}

/**
 * Split tokens with paren-preserving logic, then apply token-level filters.
 * Returns { ingredients, contains, mayContain, dropped }.
 */
function splitAndFilterTokens(s: string): {
  ingredients: string[];
  contains: string[];
  mayContain: string[];
  dropped: Array<{ token: string; reason: string }>;
} {
  const ingredients: string[] = [];
  const contains: string[] = [];
  const mayContain: string[] = [];
  const dropped: Array<{ token: string; reason: string }> = [];

  const tokens = parenPreservingSplit(s);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // Categorize by section
    if (SECTION_MARKERS.mayContain.test(token)) {
      // Skip the marker itself, next tokens go to mayContain
      continue;
    }

    if (/\b(contains?|includes?):/i.test(token)) {
      // Extract what comes after "Contains:"
      const match = token.match(/\b(contains?|includes?):\s*(.+)/i);
      if (match && match[2]) {
        const subTokens = parenPreservingSplit(match[2]);
        for (const sub of subTokens) {
          const reason = { value: '' };
          const filtered = filterToken(sub, reason);
          if (filtered) {
            contains.push(filtered);
          } else {
            dropped.push({ token: sub, reason: reason.value });
          }
        }
      }
      continue;
    }

    // Regular ingredient
    const reason = { value: '' };
    const filtered = filterToken(token, reason);

    if (filtered) {
      ingredients.push(filtered);
    } else {
      dropped.push({ token, reason: reason.value });
    }
  }

  return { ingredients, contains, mayContain, dropped };
}

/**
 * Dedupe and join ingredient tokens into comma-separated string.
 */
function dedupeJoin(tokens: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!t) continue;
    const k = t.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }

  return out.join(', ');
}

/**
 * Strip text after "cut markers" like "Also-called", "What-it-does".
 * Apply this AFTER block selection, before splitting.
 */
function stripAfterMarkers(s: string): string {
  let x = s;
  for (const m of CUT_MARKERS) {
    const i = x.toLowerCase().indexOf(m);
    if (i > 0) x = x.slice(0, i);
  }

  // Strip JavaScript code patterns (leaked script tags, selectors, etc.)
  // Pattern: CSS selectors like "#productDescription > div"
  x = x.replace(/#[a-zA-Z][\w-]*\s*>\s*\w+/g, '');
  // Pattern: JavaScript keywords and syntax
  x = x.replace(/\b(if|else|function|var|let|const|return|width|height)\s*[=+\-*/><!]+/g, '');
  // Pattern: jQuery-like selectors and operators
  x = x.replace(/\$\s*[-+\(\)]/g, '');
  // Pattern: "this" keyword often in JavaScript
  x = x.replace(/\s+this\s*$/i, '');

  // Remove preservation statements at end of text (Amazon issue - "For Freshness.Product")
  x = x.replace(/\s+(for|to preserve|to maintain|added to preserve)\s+(freshness|color|flavor)\.?$/i, '');

  // Remove section header fragments at end (period + capitalized word like ".Product", ".Details")
  x = x.replace(/\.([A-Z][a-z]+)$/g, '');

  return norm(x);
}

/**
 * Clean food/supplement ingredient text by removing nutrition facts data.
 * Food products often have nutrition info mixed with ingredients.
 * This removes: calories, protein grams, vitamins, RDI percentages, allergen warnings.
 */
function cleanFoodIngredients(text: string): string {
  let cleaned = text;

  // Remove nutrition facts data (calories, macros, vitamins with amounts)
  // Pattern: "Calories: 200", "Protein: 20g", "Vitamin D: 400 IU", "Calcium 10% DV"
  cleaned = cleaned.replace(/\b(calories?|protein|fat|carb(ohydrate)?s?|sugar|sodium|fiber|vitamin [a-z]?[0-9]*|calcium|iron|potassium|zinc|magnesium)[:\s]+[\d\.,]+(g|mg|mcg|iu|%|cal|oz)?\b/gi, '');

  // Remove "% Daily Value" or "% DV" or "% RDI" percentages
  cleaned = cleaned.replace(/\b\d+%\s*(daily value|dv|rdi|recommended daily intake)\b/gi, '');

  // Remove standalone percentages that look like RDI (e.g., "10%", "25%")
  cleaned = cleaned.replace(/\b\d{1,3}%(?!\s*[a-z])/gi, '');  // Only if not followed by a letter (keeps "100% Pure")

  // Remove "Contains:" allergen section (usually at end: "Contains: Milk, Soy, Tree Nuts.")
  cleaned = cleaned.replace(/\bContains:\s*[^\.]+\./gi, '');

  // Remove "Allergens:" section
  cleaned = cleaned.replace(/\bAllergens?:\s*[^\.]+\./gi, '');

  // Remove serving size info ("Serving Size: 1 scoop", "Servings Per Container: 30")
  cleaned = cleaned.replace(/\b(serving size|servings? per container)[:\s]+[^\.,]+[,\.]/gi, '');

  // Remove "Amount Per Serving" header
  cleaned = cleaned.replace(/\bamount per serving:?/gi, '');

  // Clean up multiple spaces and normalize
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

  return cleaned;
}

/**
 * Calculate confidence score for a candidate ingredient block.
 * +2 if valid "Ingredients" heading present
 * +1 if block has 12+ delimiters
 * +1 if block has 8+ chemical/botanical hints
 * -2 if block has 2+ marketing verbs and no delimiters
 */
function calculateConfidence(block: string, hasHeading: boolean): number {
  let score = 0;

  if (hasHeading) score += 2;

  const delimiterCount = (block.match(/[,;\n]/g) || []).length;
  if (delimiterCount >= 12) score += 1;

  const hintCount = countIngredientHints(block);
  if (hintCount >= 8) score += 1;

  // Penalize if marketing-heavy and no delimiters
  if (!hasListDelimiters(block) && isMarketingSentence(block)) {
    score -= 2;
  }

  return score;
}

// ============ Domain-specific Extractors ============

/**
 * INCIdecoder product pages: Extract from the specific ingredient list container.
 *
 * HTML Structure (provided by user):
 * <div id="ingredlist-short">
 *   <span role="listitem">
 *     <a href="/ingredients/dimethicone" class="ingred-link black">Dimethicone</a>
 *   </span>
 *   <span role="listitem">
 *     <a href="/ingredients/glycerin" class="ingred-link black">Glycerin</a>
 *   </span>
 *   ...
 *   <span class="showmore-mobile">Show More</span>
 * </div>
 *
 * Strategy: Target #ingredlist-short, find all [role="listitem"] spans,
 * extract <a> tag text from each. This ensures we ONLY get ingredients from
 * this specific product's list, not related products or UI elements.
 */
function extractFromInciDecoder($: cheerio.CheerioAPI): string | null {
  const ingredients: string[] = [];

  console.log('[INCIdecoder] Starting extraction with role="listitem" strategy...');

  // Target the specific ingredient list container
  const $container = $('#ingredlist-short');

  if ($container.length === 0) {
    console.log('[INCIdecoder] ❌ #ingredlist-short container not found');
    return null;
  }

  console.log('[INCIdecoder] ✅ Found #ingredlist-short container');

  // Find all list items within the container
  const $listItems = $container.find('[role="listitem"]');

  if ($listItems.length === 0) {
    console.log('[INCIdecoder] ❌ No [role="listitem"] elements found');
    return null;
  }

  console.log(`[INCIdecoder] Found ${$listItems.length} list items`);

  // Extract ingredient name from each list item
  $listItems.each((_, listItem) => {
    const $listItem = $(listItem);

    // Find the ingredient link within this list item
    const $link = $listItem.find('a[href*="/ingredients/"]');

    if ($link.length === 0) return; // Skip if no link found

    const text = norm($link.text());

    // Basic validation
    if (!text || text.length < 2 || text.length > 100) return;

    // Skip UI elements like "Show More", "Read More", etc.
    const lowerText = text.toLowerCase();
    if (lowerText.includes('show') ||
        lowerText.includes('read') ||
        lowerText.includes('more') ||
        lowerText.includes('click') ||
        lowerText.includes('copy') ||
        lowerText.includes('learn')) {
      return;
    }

    // Skip tooltip markers and functional descriptions (from INCIdecoder tooltips)
    if (lowerText.includes('what-it-does') ||
        lowerText.includes('also-called') ||
        lowerText.includes('skin conditioning')) {
      return;
    }

    // Skip if looks like a sentence (contains verbs)
    if (/(does|is|helps|provides|contains|includes)/i.test(text)) {
      return;
    }

    // Must contain at least one capital letter (INCI format)
    if (!/[A-Z]/.test(text)) {
      return;
    }

    // Clean and collect - remove tooltip markers if they slipped through
    let cleaned = stripAfterMarkers(text);
    cleaned = cleaned
      .replace(/what-it-does:.*/gi, '')
      .replace(/also-called:.*/gi, '')
      .replace(/\(moisturizer\)/gi, '')
      .replace(/\(emollient\)/gi, '')
      .replace(/\(preservative\)/gi, '')
      .replace(/\(surfactant\)/gi, '')
      .trim();

    if (cleaned && /[a-zA-Z]/.test(cleaned) && cleaned.length >= 2) {
      ingredients.push(cleaned);
    }
  });

  if (ingredients.length === 0) {
    console.log('[INCIdecoder] ❌ No valid ingredients extracted from list items');
    return null;
  }

  // Deduplicate and join
  const joined = dedupeJoin(ingredients);
  console.log(`[INCIdecoder] ✅ Extracted ${ingredients.length} ingredients using role="listitem" strategy`);

  return joined;
}

/**
 * Sephora: there is usually a heading "Ingredients" and a paragraph/div after it
 */
function extractFromSephora($: cheerio.CheerioAPI): string | null {
  // Look for the label then next element
  let block = '';
  let hasHeading = false;

  $('*').each((i, el) => {
    const t = norm($(el).text());
    if (SECT_HEAD_RE.test(t)) {
      hasHeading = true;
      // Extract ONLY the immediate next sibling (not 5 siblings)
      const nextSibling = $(el).next();
      if (nextSibling.length) {
        block = norm(nextSibling.text());
      }
      return false; // break
    }
  });

  if (!block) {
    // Fallback to data attributes commonly used in PDP
    block = norm($('[data-comp*="Ingredients"], [data-test*="ingredients"]').text());
  }

  if (!block) return null;

  block = stripAfterMarkers(block);
  const { ingredients } = splitAndFilterTokens(block);
  const list = dedupeJoin(ingredients);

  if (list) {
    const confidence = calculateConfidence(block, hasHeading);
    console.log(`[Sephora] Extracted ${ingredients.length} ingredients, confidence: ${confidence}`);
  }

  return list || null;
}

/**
 * Ulta: similar pattern – heading + following paragraph/div
 */
function extractFromUlta($: cheerio.CheerioAPI): string | null {
  let block = '';
  let hasHeading = false;

  $('*').each((i, el) => {
    const t = norm($(el).text());
    if (SECT_HEAD_RE.test(t)) {
      hasHeading = true;
      // Extract ONLY the immediate next sibling (not 5 siblings)
      const nextSibling = $(el).next();
      if (nextSibling.length) {
        block = norm(nextSibling.text());
      }
      return false;
    }
  });

  if (!block) {
    block = norm($('[data-test*="ingredients"], [id*="ingredients"]').text());
  }

  if (!block) return null;

  block = stripAfterMarkers(block);
  const { ingredients } = splitAndFilterTokens(block);
  const list = dedupeJoin(ingredients);

  if (list) {
    const confidence = calculateConfidence(block, hasHeading);
    console.log(`[Ulta] Extracted ${ingredients.length} ingredients, confidence: ${confidence}`);
  }

  return list || null;
}

/**
 * DailyMed: FDA-hosted supplement database with standardized structure
 * Prioritize tables and structured elements, then heading-based extraction
 */
function extractFromDailyMed($: cheerio.CheerioAPI): string | null {
  const candidateBlocks: Array<{ block: string; source: string; hasHeading: boolean }> = [];

  // Pattern 1: Look for ingredient tables (most reliable for DailyMed)
  $('table').each((_, table) => {
    const tableText = norm($(table).text());
    if (SECT_HEAD_RE.test(tableText)) {
      // Extract all cell contents
      const cells: string[] = [];
      $(table).find('td, th').each((_, cell) => {
        const cellText = norm($(cell).text());
        // Skip headings and short labels
        if (cellText && cellText.length > 3 && cellText.length < 200 && !SECT_HEAD_RE.test(cellText)) {
          cells.push(cellText);
        }
      });
      if (cells.length > 0) {
        candidateBlocks.push({
          block: cells.join(', '),
          source: 'table',
          hasHeading: true
        });
      }
    }
  });

  // Pattern 2: Heading-based extraction for non-table sections
  const sectionHeadings = /(active ingredients?|inactive ingredients?|other ingredients?|supplement facts?|ingredients)\b/i;

  $('p, div, li').each((_, el) => {
    const text = norm($(el).text());

    // Check if this element or a nearby heading mentions ingredients
    const prevHeading = $(el).prevAll('h1, h2, h3, h4, strong, b').first().text();
    const parentHeading = $(el).parent().prevAll('h1, h2, h3, h4, strong, b').first().text();
    const hasHeading = sectionHeadings.test(text) || sectionHeadings.test(prevHeading) || sectionHeadings.test(parentHeading);

    if (hasHeading) {
      // Extract ingredient text from this element
      if (text.length > 20 && text.length < 2000) {
        candidateBlocks.push({
          block: text,
          source: 'heading',
          hasHeading: true
        });
      }

      // Also check next few siblings
      let current = $(el).next();
      for (let i = 0; i < 5 && current.length; i++) {
        const sibText = norm(current.text());
        if (sibText && sibText.length > 20 && sibText.length < 1500) {
          candidateBlocks.push({
            block: sibText,
            source: 'heading',
            hasHeading: true
          });
        }
        current = current.next();
      }
    }
  });

  if (candidateBlocks.length === 0) return null;

  // Score and select best block
  const scoredBlocks = candidateBlocks.map(({ block, source, hasHeading }) => {
    const cleanBlock = stripAfterMarkers(block);
    const confidence = calculateConfidence(cleanBlock, hasHeading);
    const { ingredients } = splitAndFilterTokens(cleanBlock);
    return { block, source, confidence, ingredients, tokenCount: ingredients.length };
  });

  scoredBlocks.sort((a, b) => {
    // Prefer tables over headings
    if (a.source === 'table' && b.source !== 'table') return -1;
    if (b.source === 'table' && a.source !== 'table') return 1;
    // Then by confidence
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    // Then by token count
    return b.tokenCount - a.tokenCount;
  });

  const best = scoredBlocks[0];
  if (best && best.tokenCount >= 3) {
    const list = dedupeJoin(best.ingredients);
    console.log(`[DailyMed] Extracted ${best.tokenCount} ingredients from ${best.source}, confidence: ${best.confidence}`);
    return list;
  }

  return null;
}

/**
 * Amazon: specific patterns for Amazon product pages with multiple ingredient sections
 * Prioritize structured sections over prose
 */
function extractFromAmazon($: cheerio.CheerioAPI): string | null {
  // Remove script tags and style tags that might leak JavaScript code
  $('script, style, noscript').remove();

  const candidateBlocks: Array<{ block: string; source: string }> = [];

  // Pattern 1: Important Information section (most reliable for Amazon)
  const importantInfo = $('#important-information, [id*="important"], [class*="important-information"]');
  if (importantInfo.length) {
    const fullText = norm(importantInfo.text());

    // Look for "Ingredients" section within Important Information
    const ingredientsMatch = fullText.match(/ingredients?:?\s*([^]+?)(?=\n\s*(directions?|warnings?|suggested use|storage|legal disclaimer|$))/i);

    if (ingredientsMatch && ingredientsMatch[1]) {
      const ingredientText = norm(ingredientsMatch[1]);
      if (ingredientText.length > 50 && ingredientText.length < 5000) {
        candidateBlocks.push({ block: ingredientText, source: 'important-info' });
      }
    }
  }

  // Pattern 2: Product Details table
  $('table tr, .detail-bullet-list tr, [class*="prodDetTable"] tr').each((_, row) => {
    const $row = $(row);
    const cells = $row.find('td, th');

    if (cells.length >= 2) {
      const label = norm(cells.eq(0).text());
      const value = norm(cells.eq(1).text());

      if (/ingredients?/i.test(label) && value.length > 20 && value.length < 3000) {
        candidateBlocks.push({ block: value, source: 'table' });
      }
    }
  });

  // Pattern 3: Look for any <div> or <span> that contains "Ingredients:" followed by the list
  // IMPORTANT: Exclude customer review sections to avoid extracting review text
  $('div, span, p').each((_, el) => {
    const $el = $(el);

    // Skip if element is inside customer review section
    if ($el.closest('[id*="review"], [class*="review"], [data-hook*="review"], [id*="cm-cr"], [id*="customer"]').length > 0) {
      return; // Skip this element - it's in a review container
    }

    const text = norm($el.text());

    // Match pattern: "Ingredients: Water, Sodium..." or "Ingredients: WATER • SODIUM..."
    const match = text.match(/ingredients?:?\s*(.+?)(?=\s*(directions?|warnings?|legal disclaimer|$))/i);
    if (match && match[1]) {
      const ingredientText = norm(match[1]);

      // Verify it looks like a real ingredient list (has delimiters, reasonable length)
      const hasDelimiters = hasListDelimiters(ingredientText);

      if (hasDelimiters && ingredientText.length > 50 && ingredientText.length < 5000) {
        // Filter out text containing stop phrases (reviews, navigation, etc.)
        if (containsStopPhrases(ingredientText)) {
          return; // Skip this block - contains non-ingredient content
        }

        // Filter out review-like text and validate ingredient patterns
        if (!looksLikeIngredientList(ingredientText)) {
          return; // Skip this block - doesn't look like an ingredient list
        }

        candidateBlocks.push({ block: ingredientText, source: 'inline' });
      }
    }
  });

  if (candidateBlocks.length === 0) {
    console.log('[Amazon] No ingredients found');
    return null;
  }

  // Score and select best block
  const scoredBlocks = candidateBlocks.map(({ block, source }) => {
    const cleanBlock = stripAfterMarkers(block);
    const hasHeading = /ingredients?:/i.test(block);
    const confidence = calculateConfidence(cleanBlock, hasHeading);
    const { ingredients } = splitAndFilterTokens(cleanBlock);
    return { block, source, confidence, ingredients, tokenCount: ingredients.length };
  });

  scoredBlocks.sort((a, b) => {
    // Prefer structured sources
    const sourceOrder = { 'table': 3, 'important-info': 2, 'inline': 1 };
    const aScore = sourceOrder[a.source as keyof typeof sourceOrder] || 0;
    const bScore = sourceOrder[b.source as keyof typeof sourceOrder] || 0;
    if (aScore !== bScore) return bScore - aScore;
    // Then by confidence
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    // Then by token count
    return b.tokenCount - a.tokenCount;
  });

  const best = scoredBlocks[0];
  if (best && best.tokenCount >= 3) {
    const list = dedupeJoin(best.ingredients);
    console.log(`[Amazon] Extracted ${best.tokenCount} ingredients from ${best.source}, confidence: ${best.confidence}`);
    return list;
  }

  return null;
}

/**
 * Skinsort: skincare database with separate "Active Ingredients" and "Inactive Ingredients" sections
 * HTML Pattern (from actual page):
 *   <div class="font-normal text-sm text-warm-gray-500 ...">Active Ingredients</div>
 *   <a data-ingredient-id="27569">Pyrithione Zinc 2%\nAntimicrobial</a>
 *   <div class="font-normal text-sm text-warm-gray-500 ...">Inactive Ingredients</div>
 *   <a data-ingredient-id="...">Water\nSolvent</a>
 * IMPORTANT: Active ingredients must be listed FIRST, then inactive ingredients
 *
 * Strategy:
 * 1. Find all divs on the page
 * 2. Filter to only those with EXACT text match for "Active Ingredients" or "Inactive Ingredients"
 * 3. For each heading, traverse ALL following siblings (using while loop)
 * 4. Stop when hitting next heading or end of siblings
 * 5. Extract FIRST LINE ONLY from each ingredient link text (to exclude function labels)
 */

/**
 * Walmart-specific extractor.
 *
 * HTML Structure:
 * - Active ingredients: <h3>Active Ingredients</h3> followed by <p>Ceramide NP|Ceramide AP|...</p> (pipe-separated)
 * - Inactive ingredients: <p class="mv0 lh-copy f6 mid-gray">AQUA / WATER / EAU, GLYCERIN, ...</p> (comma-separated)
 *
 * Both use classes: mv0 lh-copy f6 mid-gray for the ingredient text
 * Active ingredients section also has: <h3 class="mv0 lh-copy f5 pb1 dark-gray">Active Ingredients</h3>
 */
function extractFromWalmart($: cheerio.CheerioAPI): string | null {
  let allIngredients: string[] = [];

  console.log('[Walmart] Starting extraction...');

  // Pattern 1: Active Ingredients section
  // <h3 class="...dark-gray">Active Ingredients</h3> followed by <p class="...mid-gray">...</p>

  $('h3.dark-gray, h3[class*="dark-gray"]').each((_, heading) => {
    const $heading = $(heading);
    const headingText = norm($heading.text());

    if (/^Active\s+Ingredients?$/i.test(headingText)) {
      // Found "Active Ingredients" heading - get next paragraph
      const $activeIngredients = $heading.next('p.mid-gray, p[class*="mid-gray"]');
      if ($activeIngredients.length) {
        const activeText = norm($activeIngredients.text());
        // Active ingredients are pipe-separated: "Ceramide NP|Ceramide AP|..."
        const actives = activeText.split('|').map(s => s.trim()).filter(s => s.length > 0);

        if (actives.length > 0) {
          allIngredients.push(...actives);
          console.log('[Walmart] Found active ingredients:', actives.length);
        }
      }
    }
  });

  // Pattern 2: Inactive/Regular Ingredients paragraph
  // <p class="mv0 lh-copy f6 mid-gray">AQUA / WATER / EAU, GLYCERIN, ...</p>

  $('p.mid-gray, p[class*="mid-gray"]').each((_, para) => {
    const $para = $(para);
    const text = norm($para.text());

    // Skip if it's the active ingredients we already got (contains pipes)
    if (text.includes('|')) return;

    // Check if this looks like an ingredient list
    // Must have: decent length, multiple commas, uppercase words (ingredient names)
    if (text.length > 50 &&
        text.length < 5000 &&
        (text.match(/,/g) || []).length >= 5 &&
        /[A-Z]{2,}/.test(text)) { // Has uppercase words

      // Check if previous sibling mentions ingredients (optional but helpful)
      const $prevHeading = $para.prev('h3, h4, dt, strong');
      const prevText = norm($prevHeading.text()).toLowerCase();

      // Accept if: (1) previous heading says "ingredients", (2) no previous heading, (3) we haven't found ingredients yet
      if (prevText.includes('ingredient') || prevText === '' || allIngredients.length === 0) {
        // Split by comma and clean up
        const ingredients = text
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length >= 2 && s.length <= 100);

        if (ingredients.length >= 5) {
          allIngredients.push(...ingredients);
          console.log('[Walmart] Found ingredient list:', ingredients.length, 'ingredients');
          return false; // Stop searching (found main list)
        }
      }
    }
  });

  // Pattern 3: Collapsible panel structure (new Walmart layout)
  // <div class="w_rhen expand-collapse-content"><div class="pb3 pb4 pt3"><h3>Ingredients</h3><p>...</p></div></div>
  $('div[class*="expand-collapse-content"], div[class*="w_rhen"]').each((_, panel) => {
    const $panel = $(panel);

    // Look for "Ingredients" or "Active Ingredient Name" headings
    $panel.find('h3, h4').each((_, heading) => {
      const $heading = $(heading);
      const headingText = norm($heading.text());

      if (/^(Ingredients?|Active Ingredient Name)$/i.test(headingText)) {
        // Get next paragraph
        const $para = $heading.next('p');
        if ($para.length) {
          const text = norm($para.text());

          // Relax requirements for single-ingredient products (e.g., supplements)
          const hasMultipleCommas = (text.match(/,/g) || []).length >= 5;
          const isSingleIngredient = text.length >= 10 && text.length <= 100 && !text.includes(',');

          // Check if this looks like an ingredient list (multi or single ingredient)
          if ((text.length > 50 && hasMultipleCommas) || isSingleIngredient) {
            if (isSingleIngredient) {
              // Single ingredient: just add it directly
              allIngredients.push(text);
              console.log('[Walmart] Found single ingredient from collapsible panel:', text);
              return false; // Stop searching - found it
            } else {
              // Multiple ingredients: split by comma
              const ingredients = text
                .split(',')
                .map(s => s.trim())
                .filter(s => s.length >= 2 && s.length <= 150);

              if (ingredients.length >= 5) {
                allIngredients.push(...ingredients);
                console.log('[Walmart] Found ingredients from collapsible panel:', ingredients.length, 'under', headingText);
              }
            }
          }
        }
      }
    });
  });

  if (allIngredients.length === 0) {
    console.log('[Walmart] No ingredients found');
    return null;
  }

  // Use dedupeJoin for consistent deduplication (handles active + inactive sections)
  const dedupedList = dedupeJoin(allIngredients);

  console.log('[Walmart] Total extracted:', allIngredients.length, 'tokens,', dedupedList.split(',').length, 'unique ingredients');

  return dedupedList;
}

function extractFromSkinsort($: cheerio.CheerioAPI): string | null {
  const activeIngredients: string[] = [];
  const inactiveIngredients: string[] = [];

  console.log('[Skinsort] Starting extraction with .nextUntil() strategy...');

  // Find ALL div elements
  const allDivs = $('div');
  console.log('[Skinsort] Total divs on page:', allDivs.length);

  // Filter to find headings with EXACT text match
  const activeHeading = allDivs.filter((_, el) => {
    const text = norm($(el).text());
    return /^Active\s+Ingredients?\s*:?\s*$/i.test(text);
  }).first();

  const inactiveHeading = allDivs.filter((_, el) => {
    const text = norm($(el).text());
    return /^Inactive\s+Ingredients?\s*:?\s*$/i.test(text);
  }).first();

  console.log('[Skinsort] Found headings:', {
    activeFound: activeHeading.length > 0,
    inactiveFound: inactiveHeading.length > 0
  });

  // STRATEGY 1: Use .nextUntil() to collect elements between headings
  if (activeHeading.length > 0 && inactiveHeading.length > 0) {
    console.log('[Skinsort] Using .nextUntil() to collect active ingredients between headings');

    // Get ALL elements between Active and Inactive headings
    const betweenElements = activeHeading.nextUntil(inactiveHeading);
    console.log('[Skinsort] Elements between Active and Inactive headings:', betweenElements.length);

    // Find all <a data-ingredient-id> within those elements (both direct and nested)
    const activeAnchors = betweenElements.filter('a[data-ingredient-id]');
    console.log('[Skinsort] Direct anchor matches (filter):', activeAnchors.length);

    // Also search nested anchors (in case they're wrapped in divs)
    betweenElements.each((_, el) => {
      $(el).find('a[data-ingredient-id]').each((__, anchor) => {
        const ingredientText = norm($(anchor).text());

        // Enhanced cleaning for Skinsort
        const cleaned = ingredientText
          .replace(/\bCopy\b/gi, '') // Remove "Copy" anywhere in text
          .replace(/what-it-does:.*/gi, '')
          .replace(/also-called:.*/gi, '')
          .replace(/\(moisturizer\)/gi, '')
          .replace(/\(emollient\)/gi, '')
          .replace(/\(preservative\)/gi, '')
          .replace(/\(surfactant\)/gi, '')
          .split('\n')[0] // Take only first line
          .trim();

        // Skip if looks like UI text or tooltip
        const lowerCleaned = cleaned.toLowerCase();
        if (/^(show|read|more|click|learn|copy)$/i.test(cleaned)) {
          return;
        }

        // Skip if contains tooltip markers
        if (/what-it-does|also-called|skin conditioning/i.test(cleaned)) {
          return;
        }

        // Must look like INCI ingredient (capital letter + reasonable length)
        if (!/[A-Z]/.test(cleaned) || cleaned.length < 2 || cleaned.length > 80) {
          return;
        }

        if (cleaned && !activeIngredients.includes(cleaned)) {
          activeIngredients.push(cleaned);
          console.log('[Skinsort] Found active ingredient (nested):', cleaned);
        }
      });
    });

    // Process direct anchor matches
    activeAnchors.each((_, anchor) => {
      const ingredientText = norm($(anchor).text());

      // Enhanced cleaning for Skinsort
      const cleaned = ingredientText
        .replace(/\bCopy\b/gi, '')
        .replace(/what-it-does:.*/gi, '')
        .replace(/also-called:.*/gi, '')
        .replace(/\(moisturizer\)/gi, '')
        .replace(/\(emollient\)/gi, '')
        .replace(/\(preservative\)/gi, '')
        .replace(/\(surfactant\)/gi, '')
        .split('\n')[0]
        .trim();

      // Skip if looks like UI text or tooltip
      if (/^(show|read|more|click|learn|copy)$/i.test(cleaned)) {
        return;
      }

      // Skip if contains tooltip markers
      if (/what-it-does|also-called|skin conditioning/i.test(cleaned)) {
        return;
      }

      // Must look like INCI ingredient
      if (!/[A-Z]/.test(cleaned) || cleaned.length < 2 || cleaned.length > 80) {
        return;
      }

      if (cleaned && !activeIngredients.includes(cleaned)) {
        activeIngredients.push(cleaned);
        console.log('[Skinsort] Found active ingredient (direct):', cleaned);
      }
    });

    console.log('[Skinsort] Active ingredients collected:', activeIngredients.length);
  }

  // Collect inactive ingredients (after Inactive heading until next section or end)
  if (inactiveHeading.length > 0) {
    console.log('[Skinsort] Collecting inactive ingredients after Inactive heading');

    // Find next section heading after Inactive (to know where to stop)
    const nextSectionHeading = inactiveHeading.nextAll().filter((_, el) => {
      const text = norm($(el).text());
      // Stop at headings like "Reviews", "Details", "How to Use", etc.
      return /^(reviews?|details?|how to use|description|about|product info)/i.test(text);
    }).first();

    let elementsAfterInactive;
    if (nextSectionHeading.length > 0) {
      console.log('[Skinsort] Found next section heading, using .nextUntil()');
      elementsAfterInactive = inactiveHeading.nextUntil(nextSectionHeading);
    } else {
      console.log('[Skinsort] No next section found, collecting all following siblings');
      elementsAfterInactive = inactiveHeading.nextAll();
    }

    console.log('[Skinsort] Elements after Inactive heading:', elementsAfterInactive.length);

    // Find all <a data-ingredient-id> within those elements
    const inactiveAnchors = elementsAfterInactive.filter('a[data-ingredient-id]');
    console.log('[Skinsort] Direct inactive anchor matches:', inactiveAnchors.length);

    // Search nested anchors
    elementsAfterInactive.each((_, el) => {
      $(el).find('a[data-ingredient-id]').each((__, anchor) => {
        const ingredientText = norm($(anchor).text());

        // Enhanced cleaning for Skinsort
        const cleaned = ingredientText
          .replace(/\bCopy\b/gi, '')
          .replace(/what-it-does:.*/gi, '')
          .replace(/also-called:.*/gi, '')
          .replace(/\(moisturizer\)/gi, '')
          .replace(/\(emollient\)/gi, '')
          .replace(/\(preservative\)/gi, '')
          .replace(/\(surfactant\)/gi, '')
          .split('\n')[0]
          .trim();

        // Skip if looks like UI text or tooltip
        if (/^(show|read|more|click|learn|copy)$/i.test(cleaned)) {
          return;
        }

        // Skip if contains tooltip markers
        if (/what-it-does|also-called|skin conditioning/i.test(cleaned)) {
          return;
        }

        // Must look like INCI ingredient
        if (!/[A-Z]/.test(cleaned) || cleaned.length < 2 || cleaned.length > 80) {
          return;
        }

        if (cleaned && !inactiveIngredients.includes(cleaned)) {
          inactiveIngredients.push(cleaned);
        }
      });
    });

    // Process direct matches
    inactiveAnchors.each((_, anchor) => {
      const ingredientText = norm($(anchor).text());

      // Enhanced cleaning for Skinsort
      const cleaned = ingredientText
        .replace(/\bCopy\b/gi, '')
        .replace(/what-it-does:.*/gi, '')
        .replace(/also-called:.*/gi, '')
        .replace(/\(moisturizer\)/gi, '')
        .replace(/\(emollient\)/gi, '')
        .replace(/\(preservative\)/gi, '')
        .replace(/\(surfactant\)/gi, '')
        .split('\n')[0]
        .trim();

      // Skip if looks like UI text or tooltip
      if (/^(show|read|more|click|learn|copy)$/i.test(cleaned)) {
        return;
      }

      // Skip if contains tooltip markers
      if (/what-it-does|also-called|skin conditioning/i.test(cleaned)) {
        return;
      }

      // Must look like INCI ingredient
      if (!/[A-Z]/.test(cleaned) || cleaned.length < 2 || cleaned.length > 80) {
        return;
      }

      if (cleaned && !inactiveIngredients.includes(cleaned)) {
        inactiveIngredients.push(cleaned);
      }
    });

    console.log('[Skinsort] Inactive ingredients collected:', inactiveIngredients.length);
  }

  console.log('[Skinsort] Raw extraction results:', {
    active: activeIngredients.length,
    inactive: inactiveIngredients.length,
    activePreview: activeIngredients.slice(0, 3),
    inactivePreview: inactiveIngredients.slice(0, 3)
  });

  // STRATEGY 2: Fallback - Search inside <p data-ingredient-list-copy-target="list"> for inline labels
  if (activeIngredients.length === 0 && inactiveIngredients.length === 0) {
    console.log('[Skinsort] Trying fallback: inline ingredient list with labels');

    const inlineListPara = $('p[data-ingredient-list-copy-target="list"]');
    console.log('[Skinsort] Found inline list paragraphs:', inlineListPara.length);

    if (inlineListPara.length > 0) {
      const fullText = norm(inlineListPara.text());
      console.log('[Skinsort] Inline list text length:', fullText.length);

      // Look for "Active Ingredients:" and "Inactive Ingredients:" labels in the text
      const activeMatch = fullText.match(/Active\s+Ingredients?:\s*([^]*?)(?=Inactive\s+Ingredients?:|$)/i);
      const inactiveMatch = fullText.match(/Inactive\s+Ingredients?:\s*([^]*)/i);

      if (activeMatch && activeMatch[1]) {
        const activeText = activeMatch[1].trim();
        console.log('[Skinsort] Found inline active ingredients text:', activeText.slice(0, 100));

        // Find anchors within this section
        inlineListPara.find('a[data-ingredient-id]').each((_, anchor) => {
          const ingredientText = norm($(anchor).text());
          const firstLine = ingredientText.split('\n')[0].trim();
          const cleaned = firstLine.replace(/\s*Copy\s*$/i, '').trim();

          // Simple heuristic: if anchor text appears in active section, it's active
          if (activeText.includes(cleaned)) {
            if (cleaned && cleaned.length > 1 && !activeIngredients.includes(cleaned)) {
              activeIngredients.push(cleaned);
            }
          }
        });
      }

      if (inactiveMatch && inactiveMatch[1]) {
        const inactiveText = inactiveMatch[1].trim();
        console.log('[Skinsort] Found inline inactive ingredients text:', inactiveText.slice(0, 100));

        inlineListPara.find('a[data-ingredient-id]').each((_, anchor) => {
          const ingredientText = norm($(anchor).text());
          const firstLine = ingredientText.split('\n')[0].trim();
          const cleaned = firstLine.replace(/\s*Copy\s*$/i, '').trim();

          if (inactiveText.includes(cleaned)) {
            if (cleaned && cleaned.length > 1 && !inactiveIngredients.includes(cleaned)) {
              inactiveIngredients.push(cleaned);
            }
          }
        });
      }

      console.log('[Skinsort] Inline fallback results:', {
        active: activeIngredients.length,
        inactive: inactiveIngredients.length
      });
    }
  }

  // Filter tokens through standard validation
  const filteredActive: string[] = [];
  const filteredInactive: string[] = [];

  for (const token of activeIngredients) {
    const reason = { value: '' };
    const filtered = filterToken(token, reason);
    if (filtered) {
      filteredActive.push(filtered);
    } else {
      console.log('[Skinsort] Dropped active ingredient:', token, '(reason:', reason.value + ')');
    }
  }

  for (const token of inactiveIngredients) {
    const reason = { value: '' };
    const filtered = filterToken(token, reason);
    if (filtered) {
      filteredInactive.push(filtered);
    } else {
      console.log('[Skinsort] Dropped inactive ingredient:', token, '(reason:', reason.value + ')');
    }
  }

  // Combine: ACTIVE FIRST, then inactive
  const combined = [...filteredActive, ...filteredInactive];

  if (combined.length >= 3) {
    const list = dedupeJoin(combined);
    console.log(`[Skinsort] ✅ Extracted ${combined.length} ingredients (${filteredActive.length} active, ${filteredInactive.length} inactive)`);
    return list;
  }

  console.log('[Skinsort] ❌ No ingredients found or too few tokens (<3)');
  return null;
}

/**
 * OpenFoodFacts extractor: Extracts ingredients from world.openfoodfacts.org product pages
 *
 * Strategy 1: Look for #panel_ingredients_content
 * Strategy 2: Extract from embedded JSON var product = {...}
 * Strategy 3: Generic search for ingredient text
 */
function extractFromOpenFoodFacts($: cheerio.CheerioAPI): string | null {
  console.log('[OpenFoodFacts] Starting extraction...');

  /**
   * Enhanced cleaning helper for OpenFoodFacts
   * Removes UI elements, labels, numbers, and marketing text
   */
  const cleanOpenFoodFactsText = (text: string): string => {
    return text
      // Remove ingredient count labels
      .replace(/^\d+\s+ingredients?:?\s*/i, '')
      .replace(/\(\d+\s+ingredients?\)/gi, '')

      // Remove UI elements and labels
      .replace(/ingredients?:?\s*/gi, '')
      .replace(/^ingredients?\s*$/gmi, '')
      .replace(/\bshow\s+more\b/gi, '')
      .replace(/\bread\s+more\b/gi, '')
      .replace(/\bclick\s+to\s+expand\b/gi, '')
      .replace(/\bview\s+all\b/gi, '')

      // Replace arrows/separators with commas
      .replace(/\s*→\s*/g, ', ')
      .replace(/\s*›\s*/g, ', ')
      .replace(/\s*»\s*/g, ', ')

      // Remove marketing phrases
      .replace(/\borganic\b/gi, '')
      .replace(/\bfair\s+trade\b/gi, '')
      .replace(/\bnon-gmo\b/gi, '')
      .replace(/\bgluten[- ]free\b/gi, '')

      // Remove percentages in parentheses (standalone)
      .replace(/\(\d+\.?\d*%\)/g, '')

      // Remove section headers
      .replace(/nutrition\s+facts?:?/gi, '')
      .replace(/supplement\s+facts?:?/gi, '')
      .replace(/allergen\s+info:?/gi, '')
      .replace(/may\s+contain:?/gi, '')

      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  };

  /**
   * Validate OpenFoodFacts ingredient list
   * Returns true if text looks like a valid ingredient list
   */
  const validateOpenFoodFactsList = (text: string): boolean => {
    if (!text || text.length < 30) {
      console.log('[OpenFoodFacts] Validation failed: too short');
      return false;
    }

    // Must contain commas (list format)
    const commaCount = (text.match(/,/g) || []).length;
    if (commaCount < 2) {
      console.log('[OpenFoodFacts] Validation failed: not enough commas (need 2+, found', commaCount + ')');
      return false;
    }

    // Should contain some numbers or chemical names (food products often have numbers)
    const hasNumbersOrChemicals = /\d+|acid|ate|ose|ium|ide|yl|ene/i.test(text);
    if (!hasNumbersOrChemicals) {
      console.log('[OpenFoodFacts] Validation failed: no numbers or chemical names found');
      return false;
    }

    // Should NOT be mostly numbers (avoid nutrition tables)
    const numberRatio = (text.match(/\d+/g) || []).join('').length / text.length;
    if (numberRatio > 0.3) {
      console.log('[OpenFoodFacts] Validation failed: too many numbers (ratio:', numberRatio.toFixed(2) + ')');
      return false;
    }

    console.log('[OpenFoodFacts] ✅ Validation passed');
    return true;
  };

  // Strategy 1: Look for #panel_ingredients_content panel (more specific targeting)
  // Try multiple selectors for the ingredients panel
  const panelSelectors = [
    '#panel_ingredients_content div[class*="text"]', // Text content inside panel
    '#panel_ingredients_content p',                   // Paragraph inside panel
    '#panel_ingredients_content',                     // The panel itself (fallback)
  ];

  for (const selector of panelSelectors) {
    const panel = $(selector);
    if (panel.length) {
      const text = norm(panel.text());
      if (text && text.length > 20) {
        console.log('[OpenFoodFacts] Found via selector:', selector, ', length:', text.length);

        // Apply enhanced cleaning
        const cleaned = cleanOpenFoodFactsText(text);

        // Validate the cleaned result
        if (validateOpenFoodFactsList(cleaned)) {
          console.log('[OpenFoodFacts] ✅ Strategy 1 success:', cleaned.slice(0, 100));
          return cleaned;
        }
      }
    }
  }

  // Strategy 2: Look for embedded JSON product object
  // OpenFoodFacts embeds: var product = {"ingredients_text":"..."}
  const scripts = $('script:not([src])').toArray();
  for (const script of scripts) {
    const scriptText = $(script).html() || '';

    // Look for var product = {...}
    const match = scriptText.match(/var\s+product\s*=\s*(\{[^]*?\});/);
    if (match && match[1]) {
      try {
        const productData = JSON.parse(match[1]);

        // Check for ingredients_text field
        if (productData.ingredients_text && typeof productData.ingredients_text === 'string') {
          const ingredientsText = productData.ingredients_text.trim();

          // Apply enhanced cleaning
          const cleaned = cleanOpenFoodFactsText(ingredientsText);

          // Validate the cleaned result
          if (validateOpenFoodFactsList(cleaned)) {
            console.log('[OpenFoodFacts] ✅ Strategy 2 success via embedded JSON, length:', cleaned.length);
            return cleaned;
          }
        }
      } catch (e) {
        // JSON parse failed, continue to next strategy
        console.log('[OpenFoodFacts] Failed to parse embedded JSON');
      }
    }
  }

  // Strategy 3: Look for elements with "ingredient" in class/id
  const ingredientElements = $('[class*="ingredient"], [id*="ingredient"]');
  if (ingredientElements.length) {
    console.log('[OpenFoodFacts] Trying Strategy 3: found', ingredientElements.length, 'ingredient elements');

    for (const el of ingredientElements.toArray()) {
      const text = norm($(el).text());

      // Must have commas (list format) and be reasonable length
      if (text.includes(',') && text.length > 30 && text.length < 2000) {
        // Apply enhanced cleaning
        const cleaned = cleanOpenFoodFactsText(text);

        // Validate the cleaned result
        if (validateOpenFoodFactsList(cleaned)) {
          console.log('[OpenFoodFacts] ✅ Strategy 3 success via ingredient element, length:', cleaned.length);
          return cleaned;
        }
      }
    }
  }

  // Strategy 4: Generic search for any element with "ingredients:" label
  const candidates = $('div, section, p, span').toArray();
  for (const el of candidates) {
    const text = norm($(el).text());

    // Look for "Ingredients:" followed by a list
    if (/ingredients?:\s*/i.test(text) && text.includes(',') && text.length > 30 && text.length < 2000) {
      // Extract text after "Ingredients:"
      const match = text.match(/ingredients?:\s*(.+)/i);
      if (match && match[1]) {
        const extracted = match[1].trim();

        // Apply enhanced cleaning
        const cleaned = cleanOpenFoodFactsText(extracted);

        // Validate the cleaned result
        if (validateOpenFoodFactsList(cleaned)) {
          console.log('[OpenFoodFacts] ✅ Strategy 4 success via generic search, length:', cleaned.length);
          return cleaned;
        }
      }
    }
  }

  console.log('[OpenFoodFacts] ❌ No valid ingredients found');
  return null;
}

/**
 * Priority 0: Simple text-based extractor (runs FIRST before all DOM extractors)
 *
 * Extract all visible text from page HTML and search for ingredient markers.
 * Takes the first valid ingredient list found.
 *
 * This is simpler and more robust than complex DOM traversal - if the page HTML
 * contains ingredients anywhere, this will find them.
 */
function extractFromPlainText($: cheerio.CheerioAPI): string | null {
  console.log('[PlainText] Starting simple text-based extraction');

  // Step 1: Remove only scripts/styles (keep "hidden" content - might contain ingredients)
  // Modern sites use CSS classes for hiding collapsed sections, not inline styles
  // We need to extract ALL text including "hidden" content to find ingredients in accordions
  $('script, style, noscript').remove();

  // Step 2: Extract all text from body (including hidden/collapsed content)
  const fullText = $('body').text();

  if (!fullText || fullText.length < 100) {
    console.log('[PlainText] ❌ Body text too short');
    return null;
  }

  console.log('[PlainText] Extracted body text, length:', fullText.length);

  // Step 3: Ingredient marker patterns (both cosmetic and food products)
  const ingredientMarkers = [
    /\bingredients?:\s*/i,
    /\bactive\s+ingredients?:\s*/i,
    /\binactive\s+ingredients?:\s*/i,
    /\bother\s+ingredients?:\s*/i,
    /\bingredient\s+list:\s*/i,
    /\bfull\s+ingredient\s+list:\s*/i,
    /\bcontains?:\s*/i,
    /\bmade\s+with:\s*/i,
    /\bformula:\s*/i,
    /\blabel\s+info:\s*/i,
    /\bwhat'?s\s+in\s+it:\s*/i,
    /\bproduct\s+ingredients?:\s*/i,
    /\bnutrition\s+information:\s*/i,
  ];

  // Step 4: Search for ingredient markers in the full text
  for (const marker of ingredientMarkers) {
    const match = fullText.match(marker);

    if (match && match.index !== undefined) {
      // Found a marker! Extract text starting from this point
      const startIndex = match.index + match[0].length;
      const remainingText = fullText.substring(startIndex);

      // Step 5: Extract until we hit non-ingredient content
      const extracted = extractUntilNonIngredient(remainingText);

      if (extracted && extracted.length > 40) {
        // Step 6: Validate using looksLikeIngredients
        console.log('[PlainText] Found candidate after marker:', marker.source, ', length:', extracted.length);

        if (looksLikeIngredients(extracted)) {
          console.log('[PlainText] ✅ Valid ingredient list found, length:', extracted.length);
          return extracted;
        } else {
          console.log('[PlainText] ⚠️ Candidate failed validation');
        }
      }
    }
  }

  console.log('[PlainText] ❌ No valid ingredient lists found');
  return null;
}

/**
 * Helper: Extract text until we hit non-ingredient content
 * Stops at:
 * - Marketing phrases
 * - Navigation elements
 * - Directions/warnings
 * - INCIdecoder/Skinsort metadata (category labels, ratings, explanations)
 * - Multiple newlines (section breaks)
 */
function extractUntilNonIngredient(text: string): string | null {
  // Normalize whitespace
  const normalized = text.replace(/\s+/g, ' ').trim();

  // Stop markers that indicate we've left the ingredient section
  const stopMarkers = [
    /\b(directions?|usage|how to use|warnings?|caution|storage|keep out of reach)\b/i,
    /\b(nutrition facts|supplement facts|serving size|amount per serving)\b/i,
    /\b(add to cart|buy now|shop now|free shipping|customer reviews)\b/i,
    /\b(you may also like|related products|similar items)\b/i,
    /\b(description|about this|product details|benefits)\b/i,
    // INCIdecoder/Skinsort metadata markers
    /\bshow all ingredients by function\b/i,
    /\bingredients explained\b/i,
    /\bwhat-it-does\b/i,
    /\balso-called\b/i,
    /\bid-rating\b/i,
    /\bsurfactant\s*\/\s*cleansing\b/i,
    /\bemollient\b.*\bviscosity controlling\b/i,
    /\bperfuming\s+(icky|goodie|superstar)\b/i,
    /\b(icky|goodie|superstar)\s*\d+\s*-?\s*\d*\b/i,  // Ratings like "icky", "0 2-3"
    /\[\s*more\s*\]/i,
    /\[\s*less\s*\]/i,
    // JavaScript code markers (leaked scripts, selectors, code)
    /#[a-zA-Z][\w-]*\s*>\s*/i,  // CSS selectors like "#productDescription > div"
    /\b(function|var|let|const|return|if|else)\s*[\(\{=]/i,  // JS keywords with syntax
    /\$\s*[-+\(\)]/,  // jQuery operators
    /\bwidth\s*[+\-*/=]/i,  // JavaScript variable operations
  ];

  // Marketing phrases that indicate we've hit promotional copy
  const marketingStops = [
    /\b(our|your)\s+(supplements?|products?|formula)\s+(are|is)\b/i,
    /\b(designed|formulated|created)\s+to\s+/i,
    /\b(supports?|helps?|promotes?|boosts?)\s+(your|healthy|optimal)/i,
    /\bunlock\s+(your|the)\s+potential\b/i,
    /\bmade\s+(from|with)\s+pure\b/i,
    /\bwithout\s+fillers\b/i,
    /\bwhy\s+choose\b/i,
    /\bperfect\s+for\b/i,
  ];

  // Find the first stop marker
  let stopIndex = normalized.length;

  for (const marker of [...stopMarkers, ...marketingStops]) {
    const match = normalized.match(marker);
    if (match && match.index !== undefined && match.index < stopIndex) {
      stopIndex = match.index;
    }
  }

  // Extract text up to the stop point
  let extracted = normalized.substring(0, stopIndex).trim();

  // Also stop at sentence boundaries if we hit 500+ chars
  // This prevents extracting entire paragraphs of marketing copy
  if (extracted.length > 500) {
    // Find the last period before 500 chars
    const truncated = extracted.substring(0, 500);
    const lastPeriod = truncated.lastIndexOf('.');

    if (lastPeriod > 100) {
      extracted = extracted.substring(0, lastPeriod + 1).trim();
    }
  }

  // Clean up trailing incomplete text
  // If it ends mid-word or with a comma, that's fine (ingredient lists do this)
  // But if it ends with "and" or "or", trim back to last comma
  if (/\b(and|or)\s*$/i.test(extracted)) {
    const lastComma = extracted.lastIndexOf(',');
    if (lastComma > 0) {
      extracted = extracted.substring(0, lastComma + 1).trim();
    }
  }

  return extracted.length > 40 ? extracted : null;
}

/**
 * Generic: find a heading that says "Ingredients" and read the next block.
 * Restrict to smallest container around ingredients section. Do NOT scan entire body.
 */
function extractGeneric($: cheerio.CheerioAPI): string | null {
  const candidateBlocks: Array<{ block: string; hasHeading: boolean }> = [];

  // Try supplement-specific patterns first (structured elements)
  const supplementPatterns = [
    '[class*="supplement"], [id*="supplement"]',
    '[class*="nutrition"], [id*="nutrition"]',
    '[class*="facts"], [id*="facts"]',
    '[class*="ingredient"], [id*="ingredient"]'
  ];

  for (const pattern of supplementPatterns) {
    const el = $(pattern);
    if (el.length) {
      let text = norm(el.text());

      // Strip common section headings if they're at the start (fixes "Active Ingredient NameMilk" issue)
      text = text.replace(/^(Ingredients?|Active Ingredients?|Inactive Ingredients?|Other Ingredients?|Supplement Facts|Drug Facts|Active Ingredient Name):?\s*/i, '');

      if (text.length > 40 && text.length < 3000) {
        candidateBlocks.push({ block: text, hasHeading: false });
      }
    }
  }

  // Check for collapsed/dropdown/accordion content (Target, modern retailers)
  // These are often hidden with CSS but present in HTML
  const collapsiblePatterns = [
    '[class*="collapsed"], [class*="accordion"], [class*="expandable"]',
    '[class*="dropdown"], [class*="panel"], [class*="details"]',
    '[class*="label-info"], [class*="product-info"]',
    'details, summary'  // Native HTML5 details/summary elements
  ];

  for (const pattern of collapsiblePatterns) {
    $(pattern).each((_, containerEl) => {
      const containerText = norm($(containerEl).text());

      // Only process if it mentions ingredients/label info
      if (/\b(ingredients?|label info|nutrition|supplement facts)\b/i.test(containerText)) {
        // Look for bold/strong tags within the collapsed content
        $(containerEl).find('strong, b, label, dt').each((_, headingEl) => {
          const headingText = norm($(headingEl).text());

          if (/\b(ingredients?|active ingredients?|inactive ingredients?|other ingredients?)\b/i.test(headingText)) {
            // Get the next sibling or parent's remaining text
            const nextSibling = $(headingEl).next();
            if (nextSibling.length) {
              const siblingText = norm(nextSibling.text());
              if (siblingText && siblingText.length > 20 && siblingText.length < 2000) {
                candidateBlocks.push({ block: siblingText, hasHeading: true });
              }
            }

            // Also try getting parent's text (for inline ingredients)
            const parentText = norm($(headingEl).parent().text());
            if (parentText && parentText.length > headingText.length + 50 && parentText.length < 1500) {
              // Remove the heading text from parent text
              const cleanParentText = parentText.replace(headingText, '').trim();
              if (cleanParentText.length > 20) {
                candidateBlocks.push({ block: cleanParentText, hasHeading: true });
              }
            }
          }
        });
      }
    });
  }

  // Look for headings with "Ingredients", "Supplement Facts", etc.
  // Enhanced to support both COSMETICS and FOOD products
  // Including Target's "Label Info" dropdown and other retailer patterns
  const supplementHeadingRe = /(ingredients?|supplement facts?|nutrition facts?|active ingredients?|inactive ingredients?|other ingredients?|ingredient list|full ingredient list|full list|product ingredients|label info|what's in it|contains|formula|made with|nutrition information)\b/i;

  $('h1,h2,h3,h4,h5,h6,strong,b,label,dt,th,span,div').each((_, el) => {
    const t = norm($(el).text());

    // Check if element itself contains ingredients pattern
    if (supplementHeadingRe.test(t)) {
      // Strategy 1: Get immediate next sibling (primary - fast and clean)
      const nextSibling = $(el).next();
      if (nextSibling.length) {
        const siblingText = norm(nextSibling.text());
        if (siblingText && siblingText.length > 20 && siblingText.length < 2000) {
          candidateBlocks.push({ block: siblingText, hasHeading: true });
        }
      }

      // Strategy 2: Get parent element's text (captures ingredients in same container)
      const parentText = norm($(el).parent().text());
      if (parentText && parentText.length > t.length + 50 && parentText.length < 1500) {
        candidateBlocks.push({ block: parentText, hasHeading: true });
      }

      // Strategy 3: Expand to next 2-3 siblings (for ingredients split across elements)
      // Stops at marketing text, headings, or blank siblings
      let current = $(el).next();
      const siblingTexts: string[] = [];
      for (let i = 0; i < 3 && current.length; i++) {
        const sibText = norm(current.text());

        // Stop at next heading
        const tagName = current.prop('tagName')?.toLowerCase();
        if (tagName && /^h[1-6]$/.test(tagName)) break;

        // Stop at marketing/junk text
        if (sibText && (containsStopPhrases(sibText) || looksLikeMarketing(sibText))) break;

        // Collect non-empty siblings
        if (sibText && sibText.length > 10 && sibText.length < 1500) {
          siblingTexts.push(sibText);
        }

        current = current.next();
      }

      if (siblingTexts.length > 0) {
        const combined = siblingTexts.join(' ');
        candidateBlocks.push({ block: combined, hasHeading: true });
      }
    }
  });

  // IMPORTANT: Do NOT fall back to entire body. Return null if no candidates.
  if (candidateBlocks.length === 0) return null;

  // Score and select best block
  const scoredBlocks = candidateBlocks.map(({ block, hasHeading }) => {
    // Check for stop phrases first
    if (containsStopPhrases(block)) {
      return { block, confidence: -10, ingredients: [], tokenCount: 0 };
    }

    // Clean the block: strip markers, then clean food-specific data
    let cleanBlock = stripAfterMarkers(block);
    cleanBlock = cleanFoodIngredients(cleanBlock);  // Remove nutrition facts, allergens, etc.

    const confidence = calculateConfidence(cleanBlock, hasHeading);
    const { ingredients } = splitAndFilterTokens(cleanBlock);

    return { block, confidence, ingredients, tokenCount: ingredients.length };
  });

  scoredBlocks.sort((a, b) => {
    // Sort by confidence, then by token count
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return b.tokenCount - a.tokenCount;
  });

  const best = scoredBlocks[0];

  // Require confidence >= 2 and at least 3 tokens
  if (best && best.confidence >= 2 && best.tokenCount >= 3) {
    const list = dedupeJoin(best.ingredients);
    console.log(`[Generic] Extracted ${best.tokenCount} ingredients, confidence: ${best.confidence}`);
    return list;
  }

  return null;
}

// ============ Public API ============

/**
 * Attempt to extract a clean, comma-separated INCI list.
 * Pass the page URL when available so we can apply domain rules.
 *
 * Deterministic flow:
 * 1. Normalize punctuation
 * 2. Find best block (structured first, then heading-based; stop at next heading)
 * 3. Strip "cut markers" after block selection
 * 4. Split with parentheses preserved
 * 5. Apply token filters
 * 6. Dedupe
 * 7. Return ingredients
 */
export function extractBestIngredientsFromHtml(html: string, url?: string): Out {
  try {
    const $ = cheerio.load(html);
    const host = (() => {
      try { return url ? new URL(url).hostname.replace(/^www\./, '') : ''; }
      catch { return ''; }
    })();

    // ========== Phase A: JSON-LD First Pass (Shadow Mode) ==========
    // Extract page signals for JSON-LD sanity checking
    const pageSignals: PageSignals = {
      title: $('title').text() || $('meta[property="og:title"]').attr('content') || '',
      h1: $('h1').first().text() || '',
      breadcrumbs: $('[itemtype*="BreadcrumbList"] a, .breadcrumbs a').map((_, el) => $(el).text()).get(),
      urlHost: host
    };

    // Try JSON-LD extraction if feature flag enabled
    if (flags.jsonldFirst) {
      console.log('[Extract] Attempting JSON-LD extraction (Phase A shadow mode)');
      const jsonldResult = extractJsonLdProduct(html, pageSignals);

      if (jsonldResult.ingredients) {
        console.log('[Extract] JSON-LD found ingredients:', {
          len: jsonldResult.ingredients.length,
          warnings: jsonldResult.warnings,
          preview: jsonldResult.ingredients.slice(0, 100)
        });

        // In Phase A, we log but don't use JSON-LD ingredients yet
        // Phase C will integrate JSON-LD into reconciliation engine
        console.log('[Extract] JSON-LD shadow: would use as candidate source');
      } else {
        console.log('[Extract] JSON-LD shadow: no ingredients found');
      }
    }

    let text: string | null = null;
    let where: string | null = null;

    // List of specialized domains that have custom extractors
    // Plain text extraction should NOT run on these (their extractors are better)
    const hasSpecializedExtractor =
      /dailymed\.nlm\.nih\.gov/i.test(host) ||
      /incidecoder\.com$/i.test(host) ||
      /skinsort\.com$/i.test(host) ||
      /openfoodfacts\.org$/i.test(host) ||
      /walmart\.com$/i.test(host) ||
      /sephora\.com$/i.test(host) ||
      /ulta\.com$/i.test(host) ||
      /amazon\./i.test(host);

    // Priority 0: Simple text-based extraction (FIRST for generic sites)
    // Extract all visible text and search for ingredient markers
    // ONLY runs on generic sites (Target, CVS, etc.) - specialized databases use custom extractors
    if (!text && !hasSpecializedExtractor) {
      console.log('[Extract] Attempting plain text extraction (generic site)');
      text = extractFromPlainText($);
      if (text) where = 'plaintext';
    }

    // Priority 1: Government sources (most reliable)
    if (!text && /dailymed\.nlm\.nih\.gov/i.test(host)) {
      text = extractFromDailyMed($);
      if (text) where = 'dailymed';
    }

    // Priority 2: Specialized databases
    if (!text && /incidecoder\.com$/i.test(host)) {
      text = extractFromInciDecoder($);
      if (text) where = 'incidecoder';
    }

    // Priority 2.5: Skinsort (MUST run before generic!)
    if (!text && /skinsort\.com$/i.test(host)) {
      text = extractFromSkinsort($);
      if (text) where = 'skinsort';
    }

    // Priority 2.6: OpenFoodFacts (food products, supplements)
    if (!text && /openfoodfacts\.org$/i.test(host)) {
      text = extractFromOpenFoodFacts($);
      if (text) where = 'openfoodfacts';
    }

    // Priority 2.7: Walmart (retail products)
    if (!text && /walmart\.com$/i.test(host)) {
      text = extractFromWalmart($);
      if (text) where = 'walmart';
    }

    if (!text && /sephora\.com$/i.test(host)) {
      text = extractFromSephora($);
      if (text) where = 'sephora';
    }

    if (!text && /ulta\.com$/i.test(host)) {
      text = extractFromUlta($);
      if (text) where = 'ulta';
    }

    if (!text && /amazon\./i.test(host)) {
      text = extractFromAmazon($);
      if (text) where = 'amazon';
    }

    if (!text) {
      text = extractGeneric($);
      if (text) where = 'generic';
    }

    // Fallback: If generic extractor also failed, try plain text extraction as last resort
    // This handles cases where specialized extractors exist but fail
    if (!text) {
      console.log('[Extract] All extractors failed, trying plain text fallback');
      text = extractFromPlainText($);
      if (text) where = 'plaintext-fallback';
    }

    // Final sanity: ensure it looks like an INCI list
    if (!text) return { text: null, where: null };

    // Guardrails: drop if too few tokens
    const tokenCount = text.split(',').length;
    if (tokenCount < 3) {
      console.log(`[Extract] Rejected: only ${tokenCount} tokens`);
      return { text: null, where: null };
    }

    console.log(`[Extract] SUCCESS from ${where}: ${tokenCount} ingredients`);
    return { text, where };
  } catch (err) {
    console.error('[Extract] Error:', err);
    return { text: null, where: null };
  }
}

/**
 * Helper for Stage B/C: split and filter model-returned arrays.
 * Ensures model output follows same validation rules as Stage A.
 */
export function processModelIngredients(rawText: string): string {
  const { ingredients } = splitAndFilterTokens(rawText);
  return dedupeJoin(ingredients);
}
