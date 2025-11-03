// web/lib/validateIngredients.ts
// AI-powered validator to verify if extracted text is real ingredients or junk/marketing
// AI is used as a JUDGE (not an editor) - we never use AI-modified text

export interface IngredientValidation {
  isValid: boolean;
  reason: string;
  confidence: number;
  junkPhrases?: string[]; // Specific junk phrases to strip for refinement
}

/**
 * Validate if extracted text is a real ingredient list using AI
 *
 * IMPORTANT: AI is used as a validator ONLY. We never use AI's modified version.
 * - If AI says "valid" → use original extracted text
 * - If AI says "invalid" → try different extraction method
 *
 * @param text - The extracted text to validate
 * @param productName - Optional product name for context
 * @returns Validation result with isValid, reason, and confidence score
 */
export async function validateIngredientsWithAI(
  text: string,
  productName?: string
): Promise<IngredientValidation> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_API_KEY) {
    console.warn('[AI Validator] No OpenAI API key, skipping validation');
    // Fallback: assume valid if we got here (rule-based validators already passed)
    return { isValid: true, reason: 'No API key - using rule-based validation only', confidence: 0.5 };
  }

  try {
    console.log('[AI Validator] Validating text:', {
      productName,
      textLength: text.length,
      preview: text.substring(0, 100)
    });

    const prompt = buildValidationPrompt(text, productName);

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
            content: 'You are an expert at identifying real ingredient lists vs marketing copy, ratings, or junk text. Always respond with strict JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2, // Slightly higher for less rigid responses
        max_tokens: 200,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AI Validator] API error:', {
        status: response.status,
        error: errorText.substring(0, 200)
      });
      // Fallback: assume valid
      return { isValid: true, reason: 'API error - using rule-based validation only', confidence: 0.5 };
    }

    const result = await response.json();
    const content = result.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No content in API response');
    }

    // Parse JSON response
    const validation: IngredientValidation = JSON.parse(content);

    console.log('[AI Validator] Result:', {
      isValid: validation.isValid,
      confidence: validation.confidence,
      reason: validation.reason
    });

    return validation;

  } catch (error: any) {
    console.error('[AI Validator] Validation error:', error.message);
    // Fallback: assume valid if error (rule-based validators already passed)
    return { isValid: true, reason: `Validation error: ${error.message}`, confidence: 0.5 };
  }
}

/**
 * Build the validation prompt for AI
 */
function buildValidationPrompt(text: string, productName?: string): string {
  const productContext = productName ? `Product: ${productName}\n\n` : '';

  return `${productContext}Text to validate:
"""
${text}
"""

TASK: Is this a REAL ingredient list or is it marketing copy/junk text?

VALID EXAMPLES (real ingredient lists - ALL of these are valid):
- "Water, Glycerin, Sodium Hyaluronate, Niacinamide, Panthenol, Tocopherol"
- "Organic Coconut Oil, Potassium Hydroxide, Organic Olive Oil, Mentha Arvensis"
- "Aqua (Water), Butylene Glycol, Dimethicone, Cetyl Alcohol, Glyceryl Stearate"
- "Water, Mineral Oil, Petroleum, Fragrance, Parfum, Limonene, Linalool, Citral" (mineral oil and petroleum ARE valid)
- "Coconut Oil*, Potassium Hydroxide+, Palm Kernel Oil*, Olive Oil*, Mentha Piperita" (symbols like * and + are OK)
- "Water, Glycerin (5%), Niacinamide, Tocopherol (Vitamin E)" (percentages and clarifications are OK)

INVALID EXAMPLES (not ingredient lists):
- "This product is only rated 91% top allergen free, all ingredients that have scent are natural herbal scents"
- "Our supplements are made from pure ingredients without fillers or additives"
- "Water, Glycerin, [read more], click here, Add to cart, Shop now"
- "Supports bone health, promotes wellness, clinically proven formula"
- "Suitable for all skin types, hypoallergenic, dermatologist tested"
- "Free from parabens, sulfates, and artificial fragrances"

IMPORTANT NOTES:
- ALL of these ARE valid ingredients (do NOT reject them): mineral oil, petroleum, fragrance, parfum, essential oils, limonene, linalool, citral, geraniol, linoleic, oleic, linolenic, palmitic, stearic, lauric, myristic, squalene, squalane, tocopherol, retinol, cholecalciferol, ascorbic
- Fatty acids (linoleic, oleic, palmitic, stearic, lauric) and their derivatives ARE legitimate ingredients
- Asterisks (*), plus signs (+), percentages (%), parenthetical clarifications are normal in ingredient lists
- Be tolerant of organic/natural labels like "Organic Coconut Oil" or "Palm Kernel Oil*"
- Be tolerant of partial ingredient names without full chemical notation (e.g., "linoleic" instead of "linoleic acid")
- ONLY reject if text contains OBVIOUS junk: product ratings (91% top allergen free), marketing claims (our supplements are made from), UI elements ([more], click here, read all), health claims (supports bone health)

RULES:
- VALID = comma-separated list of chemical names, botanical names, or INCI ingredient names
- INVALID = marketing claims, product ratings, allergen info, health claims, certifications, navigation text
- CLOSE MATCH = mostly valid ingredients but contains a FEW junk phrases like UI elements ([more], click here, read all the geeky)

Respond with JSON ONLY (no markdown, no explanation):
{
  "isValid": true or false,
  "reason": "brief explanation of why valid or invalid",
  "confidence": 0.0 to 1.0 (how confident are you),
  "junkPhrases": ["specific", "junk", "phrases", "to", "remove"] (only if close match)
}

If the text is MOSTLY valid ingredients but contains a few junk phrases (UI elements, function labels), return isValid=false but include the specific junk phrases in junkPhrases array so they can be stripped.`;
}
