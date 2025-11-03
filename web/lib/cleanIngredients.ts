// web/lib/cleanIngredients.ts
// AI-powered ingredient cleaning service
// Removes headings, marketing copy, and validates ingredient names

type CleanedIngredients = {
  ingredients: string[];
  contains: string[];
  mayContain: string[];
  rawText?: string;
};

/**
 * Use AI to clean and validate ingredient list.
 * Removes headings like "Ingredients", "IngredientsWater", section markers,
 * marketing phrases, and separates allergen information.
 *
 * @param rawIngredients - Raw extracted ingredient text (may contain junk)
 * @param productName - Product name for context (helps AI understand what to extract)
 * @param productType - Type of product (FOOD or COSMETIC) for context-specific cleaning
 * @returns Cleaned ingredient arrays
 */
export async function cleanIngredientsWithAI(
  rawIngredients: string,
  productName?: string,
  productType?: 'FOOD' | 'COSMETIC'
): Promise<CleanedIngredients> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_API_KEY) {
    console.error('[AI_CLEANER] No OpenAI API key, returning raw ingredients');
    // Fallback: return raw ingredients split by comma
    return {
      ingredients: rawIngredients.split(',').map(i => i.trim()).filter(Boolean),
      contains: [],
      mayContain: [],
      rawText: rawIngredients
    };
  }

  console.log('[AI_CLEANER] Cleaning ingredients...', {
    rawLength: rawIngredients.length,
    productName: productName || 'unknown',
    preview: rawIngredients.slice(0, 100)
  });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert ingredient list cleaner. Return ONLY valid JSON. No prose, no explanations, no markdown.'
          },
          {
            role: 'user',
            content: `Clean this ingredient list for "${productName || 'product'}" (${productType || 'COSMETIC'} product).

**RAW INGREDIENT TEXT:**
${rawIngredients}

**YOUR TASK:**
Extract ONLY actual ingredient names. Remove all junk and categorize properly.

**REMOVE THESE:**
- Heading words stuck to ingredients: "IngredientsWater" → "Water"
- Standalone headings: "Ingredients", "Other Ingredients", "Supplement Facts"
- Section labels: "Active Ingredients:", "Inactive Ingredients:", "Full Ingredients List"
- Marketing phrases: "made from", "pure", "organic", "without fillers"
- Instructions: "Apply daily", "Take with food"
- Percentages/dosages that are ALONE: "500mg", "10%", "2g" (keep if attached to ingredient name)
- Certifications: "Non-GMO", "Gluten-Free", "Made in USA"
${productType === 'FOOD' ? `
**ADDITIONAL REMOVALS FOR FOOD PRODUCTS:**
- Wrong headings: "Active Ingredient Name" (this is for supplements, not food!)
- Quantity labels: "Contains 2% or less of:", "LESS THAN 2% OF:", "Less Than 2% Of:"
- Section headers: "Vitamins and Minerals:", "Vitamin and Mineral Blend:"
- Marketing: "Added to Preserve Freshness", "Freshness Preserved by BHT", "To Maintain Freshness"
- Explanatory parentheses: "(a Milk Derivative)", "(Non-Nutritive Sweetener)", "(for color)", "(for freshness)"
- Function descriptions in braces: {Vitamin B1}, {Color}, {Preservative}
- Standalone allergen statements: "CONTAINS: MILK, SOY, WHEAT" (move to "contains" array instead)
- Negative statements: "No Nitrites or Nitrates Added", "Uncured", "Without Added X"
- Nutritional disclaimers: "Not a Significant Source of X"
` : ''}
**CATEGORIZE:**
1. **ingredients**: Main ingredient list (chemicals, botanicals, excipients)
2. **contains**: Items after "Contains:", "Includes:" (usually allergens)
3. **mayContain**: Items after "May contain:", "May include:", "Possible traces of:"

**RULES:**
- Keep parentheses content: "Aqua (Water, Eau)" stays as "Aqua (Water, Eau)"
- Keep dosage if attached to name: "Vitamin D3 (500 IU)" is valid
- Keep botanical names: "Camellia Sinensis (Green Tea) Leaf Extract" is valid
- Split merged headings: "IngredientsWater\\Aqua\\Eau" → ["Water\\Aqua\\Eau"]
- Each ingredient should be a separate array item
- Remove duplicates (case-insensitive)
${productType === 'FOOD' ? `- Keep sub-ingredients: "Enriched Flour (wheat flour, niacin, iron)" is valid
- Keep chemical names: "Vitamin E (mixed tocopherols)" is valid
- Only remove explanatory text like "(for color)" or "(a Milk Derivative)"
- Distinguish between sub-ingredients (KEEP) and explanatory text (REMOVE)
` : ''}
${productType === 'COSMETIC' ? `
**ADDITIONAL REMOVALS FOR COSMETIC PRODUCTS:**
- Tool tips: "What-it-does:", "Also-called:", "Skin conditioning"
- Functional descriptions in parentheses: "(moisturizer)", "(emollient)", "(preservative)", "(surfactant)", "(antioxidant)", "(fragrance)", "(colorant)", "(pH adjuster)"
- UI elements: "Copy", "Show more", "Read more", "Click to", "Learn more"
- Marketing claims: "organic", "natural", "free from", "dermatologically tested", "clinically proven"
- Warnings: "May contain traces of", "For external use only", "Avoid contact with eyes"
- Standalone concentration percentages: "0.1%", "10%" (keep if attached to ingredient name like "Zinc Oxide 10%")
- Section headers: "Active Ingredients:", "Inactive Ingredients:", "Full Ingredients List", "Ingredients overview"
- Wrong headings: "Ingredients" (standalone heading word, not part of ingredient name)
` : ''}
**CRITICAL:**
- DO NOT add ingredients that were not in the original raw text
- Only clean/format what's already there
- Keep ALL actual ingredients from the original list

**OUTPUT FORMAT (strict JSON only):**
{
  "ingredients": ["ingredient1", "ingredient2", "ingredient3", ...],
  "contains": ["allergen1", "allergen2", ...],
  "mayContain": ["trace1", "trace2", ...]
}

Return ONLY this JSON, nothing else.`
          }
        ],
        temperature: 0.1, // Low temperature for consistent output
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      console.error('[AI_CLEANER] OpenAI error:', response.status, response.statusText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const result = await response.json();
    const content = result.choices[0]?.message?.content?.trim();

    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    console.log('[AI_CLEANER] Raw response:', content.substring(0, 200));

    // Parse JSON response
    let parsed: CleanedIngredients;
    try {
      // Remove markdown code blocks if present
      const cleanedContent = content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .replace(/^[^{]*({.*})[^}]*$/s, '$1') // Extract first JSON object
        .trim();

      parsed = JSON.parse(cleanedContent);
    } catch (parseError) {
      console.error('[AI_CLEANER] JSON parse error:', parseError);
      console.error('[AI_CLEANER] Content was:', content);
      throw new Error('Failed to parse AI response as JSON');
    }

    // Validate structure
    if (!Array.isArray(parsed.ingredients)) {
      console.error('[AI_CLEANER] Invalid structure, ingredients not an array');
      parsed.ingredients = [];
    }
    if (!Array.isArray(parsed.contains)) {
      parsed.contains = [];
    }
    if (!Array.isArray(parsed.mayContain)) {
      parsed.mayContain = [];
    }

    // Filter out empty strings and duplicates
    const cleanIngredients = [...new Set(parsed.ingredients.filter(i => i && i.trim()))];
    const cleanContains = [...new Set(parsed.contains.filter(i => i && i.trim()))];
    const cleanMayContain = [...new Set(parsed.mayContain.filter(i => i && i.trim()))];

    console.log('[AI_CLEANER] ✅ Success!', {
      ingredientCount: cleanIngredients.length,
      containsCount: cleanContains.length,
      mayContainCount: cleanMayContain.length,
      preview: cleanIngredients.slice(0, 5).join(', ')
    });

    return {
      ingredients: cleanIngredients,
      contains: cleanContains,
      mayContain: cleanMayContain,
      rawText: rawIngredients
    };

  } catch (error: any) {
    console.error('[AI_CLEANER] ❌ Error:', error.message);
    console.error('[AI_CLEANER] Falling back to basic split');

    // Fallback: basic split on commas
    const fallbackIngredients = rawIngredients
      .split(',')
      .map(i => i.trim())
      .filter(i => i && i.length > 2 && i.length < 150);

    return {
      ingredients: fallbackIngredients,
      contains: [],
      mayContain: [],
      rawText: rawIngredients
    };
  }
}

/**
 * Helper: Join cleaned ingredients back into comma-separated string
 */
export function joinCleanedIngredients(cleaned: CleanedIngredients): string {
  return cleaned.ingredients.join(', ');
}

/**
 * Helper: Get full ingredient text including contains/may contain sections
 */
export function getFullIngredientText(cleaned: CleanedIngredients): string {
  let text = cleaned.ingredients.join(', ');

  if (cleaned.contains.length > 0) {
    text += '. Contains: ' + cleaned.contains.join(', ');
  }

  if (cleaned.mayContain.length > 0) {
    text += '. May contain: ' + cleaned.mayContain.join(', ');
  }

  return text;
}

/**
 * Detect if food ingredient text contains filler patterns that need cleaning
 * @param ingredientText - Raw ingredient text to check
 * @returns true if text contains known filler patterns
 */
export function needsFoodCleaning(ingredientText: string): boolean {
  const patterns = [
    // Headings
    /^Ingredients?\s*:?\s*/i,
    /Active Ingredient Name/i,

    // Section headers
    /Vitamins? and Minerals?:/i,
    /Vitamin and Mineral Blend:/i,

    // Quantity labels
    /Contains? \d+%/i,
    /Less than \d+%/i,
    /LESS THAN \d+% OF/i,

    // Marketing/preservation phrases
    /Added to Preserve/i,
    /Freshness Preserved by/i,
    /To Maintain Freshness/i,

    // Allergen statements (should be moved to contains array)
    /\bCONTAINS?:\s*[A-Z]/,

    // Explanatory parentheses
    /\(a Milk Derivative\)/i,
    /\(Non-Nutritive Sweetener\)/i,
    /\(for color\)/i,
    /\(for freshness\)/i,
    /\(Color\)/i,

    // Function descriptions in braces
    /\{Vitamin B\d+\}/i,
    /\{Color\}/i,
    /\{Preservative\}/i,

    // Negative statements
    /No Nitrites or Nitrates Added/i,
    /Uncured/i,
    /Without Added/i,

    // Nutritional disclaimers
    /Not a Significant Source of/i,

    // Product description marketing (Amazon/retail - from Kashi cereal issue)
    /makes a (tasty|great|perfect|delicious|nutritious)/i,
    /wholesome serving/i,
    /provides \d+g? of (protein|fiber|carbs|carbohydrates)/i,
    /(before|after) (the gym|workout|work)/i,
    /at work/i,
    /on the go/i,
    /\d+%? daily value/i,
    /per serving provides/i,
    /each (serving|scoop|bar|pack|portion) provides/i,
    /(great|perfect|ideal|tasty) (snack|meal|choice|option)/i,
    /(fuel|power|boost|energize|satisfy) (your|you)/i,
  ];

  const matchCount = patterns.filter(pattern => pattern.test(ingredientText)).length;

  if (matchCount > 0) {
    console.log(`[needsFoodCleaning] ✅ Detected ${matchCount} filler pattern(s), cleaning needed`);
    return true;
  }

  console.log('[needsFoodCleaning] ℹ️ No filler patterns detected, skipping cleaning');
  return false;
}

/**
 * Detect if cosmetic ingredient text contains filler patterns that need cleaning
 * @param ingredientText - Raw ingredient text to check
 * @returns true if text contains known filler patterns
 */
export function needsCosmeticCleaning(ingredientText: string): boolean {
  const patterns = [
    // Headings
    /^Ingredients?\s*:?\s*/i,
    /^Ingredients? overview/i,
    /Full Ingredients? List/i,

    // INCI tool tips and labels (from INCIdecoder, Skinsort)
    /What-it-does:/i,
    /Also-called:/i,
    /Skin conditioning/i,
    /\bEmollient\b/i,
    /\bMoisturizer\b/i,
    /\bSurfactant\b/i,

    // Functional descriptions in parentheses
    /\(moisturizer\)/i,
    /\(emollient\)/i,
    /\(preservative\)/i,
    /\(surfactant\)/i,
    /\(antioxidant\)/i,
    /\(fragrance\)/i,
    /\(colorant\)/i,
    /\(pH adjuster\)/i,

    // UI elements
    /\bCopy\b/,
    /Show more/i,
    /Read more/i,
    /Click to/i,
    /Learn more/i,

    // Marketing/certifications
    /\borganic\b/i,
    /\bnatural\b/i,
    /free from/i,
    /dermatologically tested/i,
    /clinically proven/i,

    // Warnings
    /May contain traces of/i,
    /For external use only/i,
    /Avoid contact with eyes/i,

    // Concentration percentages (standalone)
    /^\d+(\.\d+)?%\s*$/,

    // Active/Inactive labels (might slip through extractors)
    /^Active Ingredients?:?\s*$/i,
    /^Inactive Ingredients?:?\s*$/i,
  ];

  const matchCount = patterns.filter(pattern => pattern.test(ingredientText)).length;

  if (matchCount > 0) {
    console.log(`[needsCosmeticCleaning] ✅ Detected ${matchCount} filler pattern(s), cleaning needed`);
    return true;
  }

  console.log('[needsCosmeticCleaning] ℹ️ No filler patterns detected, skipping cleaning');
  return false;
}
