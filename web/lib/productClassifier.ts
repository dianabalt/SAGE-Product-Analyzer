// web/lib/productClassifier.ts
// GPT-based product classification for SAGE ingredient analyzer

import OpenAI from 'openai';

export type ProductType = 'FOOD' | 'COSMETIC';
export type ProductSubtype = 'COSMETIC' | 'SKINCARE' | 'HEALTH_SUPPLEMENT' | 'FOOD' | 'BEAUTY';

export interface ClassificationResult {
  type: ProductType;
  subtype: ProductSubtype;
  confidence: number; // 0-100
  reasoning: string;
}

/**
 * Classify product type using GPT-4o-mini
 *
 * FOOD = Ice cream, supplements, protein powder, vitamins, drinks, snacks, cereal
 * COSMETIC = Face cream, lotion, serum, makeup, shampoo, skincare, beauty products
 *
 * Cost: ~$0.0001 per classification (10 tokens in, 20 tokens out)
 * Speed: ~500ms average
 *
 * @param productName - Full product name including brand
 * @returns Classification result with type, confidence, and reasoning
 */
export async function classifyProductType(productName: string): Promise<ClassificationResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log('[ProductClassifier] 🤖 Classifying:', productName);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1, // Low temperature for consistent classification
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a product classifier. Classify products with TWO categories:

1. TYPE (for extraction pipeline):
   - FOOD = Ice cream, supplements, vitamins, drinks, snacks, protein powder, any edible/ingestible products
   - COSMETIC = Creams, lotions, makeup, shampoo, skincare, any topical products applied to skin/hair

2. SUBTYPE (for user display):
   - COSMETIC = Makeup products (foundation, lipstick, mascara, eyeshadow, blush, concealer)
   - SKINCARE = Skin treatment products (moisturizers, serums, cleansers, toners, sunscreens, lotions, creams)
   - HEALTH_SUPPLEMENT = Vitamins, minerals, supplements, pills, capsules, tablets, protein powders
   - FOOD = Edible products, snacks, beverages, ice cream (excluding supplements)
   - BEAUTY = Hair care, nail care, body care (shampoo, conditioner, nail polish, perfume)

LOGIC:
- If TYPE is FOOD, SUBTYPE must be either FOOD or HEALTH_SUPPLEMENT
- If TYPE is COSMETIC, SUBTYPE must be either COSMETIC, SKINCARE, or BEAUTY

Respond with JSON only in this exact format:
{
  "type": "FOOD" or "COSMETIC",
  "subtype": "COSMETIC" or "SKINCARE" or "HEALTH_SUPPLEMENT" or "FOOD" or "BEAUTY",
  "confidence": 0-100,
  "reasoning": "1 sentence explanation for your choices"
}

Be confident in your classification. Ice cream is TYPE=FOOD, SUBTYPE=FOOD.`
        },
        {
          role: 'user',
          content: `Classify this product: "${productName}"`
        }
      ]
    });

    const content = response.choices[0].message.content || '{}';
    const result = JSON.parse(content);

    // Validate response
    if (!result.type || !['FOOD', 'COSMETIC'].includes(result.type)) {
      throw new Error('Invalid type returned from GPT');
    }

    if (!result.subtype || !['COSMETIC', 'SKINCARE', 'HEALTH_SUPPLEMENT', 'FOOD', 'BEAUTY'].includes(result.subtype)) {
      throw new Error('Invalid subtype returned from GPT');
    }

    console.log('[ProductClassifier] ✅ Result:', {
      type: result.type,
      subtype: result.subtype,
      confidence: result.confidence || 50,
      reasoning: result.reasoning || 'No reasoning provided'
    });

    return {
      type: result.type,
      subtype: result.subtype,
      confidence: result.confidence || 50,
      reasoning: result.reasoning || 'Classification completed'
    };

  } catch (error: any) {
    console.error('[ProductClassifier] ❌ Error:', error.message);

    // Fallback: return low confidence COSMETIC/SKINCARE (safer default)
    return {
      type: 'COSMETIC',
      subtype: 'SKINCARE',
      confidence: 0,
      reasoning: 'Classification failed - using safe default (cosmetic/skincare)'
    };
  }
}

/**
 * Product identity extracted from GPT analysis
 */
export interface ProductIdentity {
  normalizedName: string;  // Standardized product name (e.g., "CeraVe Moisturizing Cream")
  brand: string;           // Brand name (e.g., "CeraVe")
  variant?: string;        // Product variant/line (e.g., "Intensive", "Daily", "SPF 30")
  category: string;        // Product category (e.g., "face cream", "sunscreen", "protein powder")
  productType: ProductType; // FOOD or COSMETIC
}

/**
 * GPT product validation result
 */
export interface GPTValidationResult {
  isSameProduct: boolean;
  confidence: number;      // 0-100
  reasoning: string;
}

/**
 * Identify product details using GPT-4o-mini
 *
 * Extracts: normalized name, brand, variant, category, product type
 * This is used to understand what product we're looking for before searching
 *
 * Cost: ~$0.0002 per call
 *
 * @param productName - Full product name from user scan
 * @param ingredients - Optional ingredient list for additional context
 * @returns Product identity details
 */
export async function identifyProduct(
  productName: string,
  ingredients?: string
): Promise<ProductIdentity | null> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log('[ProductClassifier] 🔍 Identifying product:', productName);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a product analyst. Extract key details from product names.

Respond with JSON in this exact format:
{
  "normalizedName": "Standardized product name with brand",
  "brand": "Brand name only",
  "variant": "Product line/variant (e.g., 'Intensive', 'Daily', 'SPF 30') or null",
  "category": "Specific product category (e.g., 'face moisturizer', 'vitamin d3 supplement', 'whey protein powder')",
  "productType": "FOOD" or "COSMETIC"
}

Examples:
- "Blue Bell Cookies 'n Cream Ice Cream" →
  {
    "normalizedName": "Blue Bell Cookies 'n Cream Ice Cream",
    "brand": "Blue Bell",
    "variant": "Cookies 'n Cream",
    "category": "ice cream",
    "productType": "FOOD"
  }

- "CeraVe Intensive Moisturizing Cream" →
  {
    "normalizedName": "CeraVe Intensive Moisturizing Cream",
    "brand": "CeraVe",
    "variant": "Intensive",
    "category": "face moisturizer",
    "productType": "COSMETIC"
  }

- "Nature Made Vitamin D3 2000 IU" →
  {
    "normalizedName": "Nature Made Vitamin D3 2000 IU",
    "brand": "Nature Made",
    "variant": "2000 IU",
    "category": "vitamin d3 supplement",
    "productType": "FOOD"
  }`
        },
        {
          role: 'user',
          content: ingredients
            ? `Product name: "${productName}"\n\nIngredients: ${ingredients.slice(0, 200)}`
            : `Product name: "${productName}"`
        }
      ]
    });

    const content = response.choices[0].message.content || '{}';
    const result = JSON.parse(content);

    // Validate response
    if (!result.normalizedName || !result.brand || !result.category || !result.productType) {
      throw new Error('Incomplete product identity from GPT');
    }

    console.log('[ProductClassifier] ✅ Product identified:', {
      normalizedName: result.normalizedName,
      brand: result.brand,
      variant: result.variant || 'none',
      category: result.category
    });

    return {
      normalizedName: result.normalizedName,
      brand: result.brand,
      variant: result.variant || undefined,
      category: result.category,
      productType: result.productType
    };

  } catch (error: any) {
    console.error('[ProductClassifier] ❌ Product identification error:', error.message);
    return null;
  }
}

/**
 * Validate if source product matches our intended product using GPT
 *
 * This is a fallback when coded validator has low confidence (<75%).
 * GPT can understand semantic differences that coded validators miss.
 *
 * Cost: ~$0.0003 per validation
 *
 * @param ourProductName - Product we're searching for
 * @param sourceProductName - Product name found on source page
 * @param sourceUrl - URL of source page (for context)
 * @returns Validation result with confidence and reasoning
 */
export async function validateProductMatchGPT(
  ourProductName: string,
  sourceProductName: string,
  sourceUrl: string,
  productType?: 'FOOD' | 'COSMETIC'
): Promise<GPTValidationResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log('[ProductClassifier] 🤖 GPT validating:', {
    our: ourProductName,
    source: sourceProductName,
    productType: productType || 'unknown'
  });

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a product matching expert with deep knowledge of BOTH consumer cosmetics/skincare AND food products/supplements.

${productType === 'FOOD' ? `**IMPORTANT: This is a FOOD/SUPPLEMENT product.**
For supplements, prioritize formulation details (dosage, form, count) over brand names.
Generic and brand-name supplements with same specs are often the SAME product at the same retailer.
` : ''}
**YOUR TASK:**
Determine if these two product names refer to the SAME physical product.

**USE YOUR PRODUCT KNOWLEDGE:**
- Tap into your knowledge base of famous/iconic products (Dove, CeraVe, Quest, Nature Made, etc.)
- Consider regional naming variations (US vs EU vs Asia)
- Consider retailer-specific naming (Target vs Walmart vs Amazon may use different wording)
- Consider that brands often use multiple names for the same product line

**COMMON SCENARIOS:**

=== COSMETIC PRODUCTS ===
1. **Iconic Products with Multiple Names:**
   - Example: "Dove Beauty Bar" = "Dove Cream Bar" = "Dove White Beauty Bar" = "Dove Moisturizing Bar" = "Dove Original Beauty Bar"
   - These are all the SAME product with different names
   - If you recognize this as an iconic product line, ACCEPT variants

2. **Retailer-Specific Descriptions:**
   - Target: "Beauty White Moisturizing Beauty Bar Soap 2pk"
   - Amazon: "Original Moisturizing Cream Beauty Bar (2 Pack)"
   - Same product, different retailer wording → ACCEPT

3. **Product Form Synonyms:**
   - "Bar Soap" = "Beauty Bar" = "Cleansing Bar" = "Soap Bar"
   - "Moisturizing Cream" = "Moisturizer" = "Cream Lotion"

4. **Color/Shade Variations (SAME BASE PRODUCT):**
   - Mascara: "Very Black" vs "Blackest Black" vs "Black Brown" → SAME (ingredients identical except pigments)
   - Foundation: "Shade 120" vs "Shade 240" → SAME base product

=== FOOD/SUPPLEMENT PRODUCTS ===
1. **Iconic Products with Multiple Names:**
   - Example: "Quest Bar" = "Quest Protein Bar" = "Quest Nutrition Bar"
   - Example: "Optimum Nutrition Whey" = "ON Gold Standard Whey" = "Gold Standard 100% Whey"

2. **Flavors are NOT Different Products:**
   - "Chocolate Chip" vs "Peanut Butter" → SAME base product (different flavors)
   - "Vanilla" vs "Chocolate" → SAME base product
   - Flavors have identical INACTIVE ingredients

3. **Sizes are NOT Different Products:**
   - "2lb" vs "5lb" → SAME product
   - "12-pack" vs "6-pack" → SAME product

4. **SPECIAL RULES FOR SUPPLEMENTS (FOOD type only):**
   - Supplements often have generic vs brand-name variants at the SAME retailer
   - Example: "Mutsweet Magnesium Complex" vs "Magnesium Complex 500mg" at walmart.com → LIKELY SAME
   - If both are at the same store (Walmart, Amazon, etc.) AND:
     - Same dosage (e.g., "500mg")
     - Same form (e.g., "Complex", "Glycinate")
     - Same count (e.g., "120 capsules")
     → Treat as SAME product (85%+ confidence)
   - Brand names (Mutsweet, Nature Made, etc.) are less important for supplements than formulation details
   - Store-brand generic supplements are OFTEN the same as branded versions at that store

**Products are the SAME if:**
- Same brand AND same core product line
- Differences only in: flavor, shade/color, size, retailer description, packaging
- You recognize this as a known product with naming variations
- For food: Same base product with different flavor = SAME
- For cosmetics: Same base product with different shade = SAME

**Products are DIFFERENT if:**
- COSMETIC: Different product lines (Beauty Bar vs Body Wash), different SPF levels, different formulations (Intensive vs Regular)
- FOOD: Different formulations (Whey vs Casein), different product types (Bar vs Powder)
- One is food, other is cosmetic
- Example: "Dove Beauty Bar" ≠ "Dove Body Wash" ❌
- Example: "CeraVe Moisturizing Cream" ≠ "CeraVe INTENSIVE Moisturizing Cream" ❌

**CRITICAL:**
- Use your knowledge of famous products in BOTH categories
- Don't be too literal about word-for-word matching
- Focus on: Are these the SAME PHYSICAL BASE PRODUCT?
- Recognize iconic products: Dove Beauty Bar, CeraVe Cream, Quest Bar, etc.

Respond with JSON in this exact format:
{
  "isSameProduct": true or false,
  "confidence": 0-100,
  "reasoning": "Explain using your product knowledge..."
}`
        },
        {
          role: 'user',
          content: `Our product: "${ourProductName}"
Source product: "${sourceProductName}"
Source URL: ${sourceUrl}

Are these the same product?`
        }
      ]
    });

    const content = response.choices[0].message.content || '{}';
    const result = JSON.parse(content);

    console.log('[ProductClassifier] ✅ GPT validation:', {
      isSameProduct: result.isSameProduct,
      confidence: result.confidence || 50,
      reasoning: result.reasoning
    });

    return {
      isSameProduct: result.isSameProduct || false,
      confidence: result.confidence || 50,
      reasoning: result.reasoning || 'No reasoning provided'
    };

  } catch (error: any) {
    console.error('[ProductClassifier] ❌ GPT validation error:', error.message);

    // Conservative fallback: return low confidence "not same product"
    return {
      isSameProduct: false,
      confidence: 0,
      reasoning: 'Validation failed - cannot confirm match'
    };
  }
}
