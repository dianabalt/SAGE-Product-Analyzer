// web/pages/api/ai-grade.ts
import type { NextApiRequest, NextApiResponse } from 'next';

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // put this in .env.local (server only)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { ingredients, title, product_type } = req.body ?? {};
    if (!ingredients || typeof ingredients !== 'string') {
      return res.status(200).json({ grade: null, issues: [], analysis: null });
    }

    if (!OPENAI_API_KEY) {
      // Fallback so devs can still test without a key
      return res.status(200).json({
        grade: 'C',
        issues: ['Dev mode (no AI key)'],
        analysis: { source: 'dev-fallback', title, sample: true }
      });
    }

    // ========== TYPE-AWARE GRADING PROMPTS ==========
    // Select appropriate prompt based on product type
    const isFoodProduct = product_type === 'FOOD';

    const FOOD_PROMPT = [
      `You are a food and nutrition safety analyst specializing in packaged foods, supplements, and health products.`,
      `Given a food ingredient list, analyze it and return a strict JSON object with:`,
      `  numericGrade: integer from 0-100 (0=worst, 100=best)`,
      `  letterGrade: string in {A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F}`,
      `  gradeExplanation: string (3-4 sentences explaining why you assigned this specific grade, focusing on the key factors that influenced your decision such as beneficial ingredients, harmful ingredients, processing level, and overall safety profile)`,
      `  beneficialIngredients: array of ingredient names that are nutritious/beneficial (e.g., "Whole Wheat Flour", "Organic Vegetables", "Omega-3", "Vitamin D3", "Probiotics")`,
      `  harmfulIngredients: array of ingredient names that are concerning/harmful (e.g., "High Fructose Corn Syrup", "Artificial Dyes", "Sodium Benzoate", "Partially Hydrogenated Oils", "BHA", "BHT")`,
      `  perIngredient: array of { name, risk: "low"|"medium"|"high", notes, isBeneficial: boolean }`,
      `  suggestions: array of healthier alternatives or ingredients to avoid`,
      ``,
      `IMPORTANT: Only flag ingredients that are ACTUALLY PRESENT in the provided ingredient list. Do not hallucinate or assume ingredients.`,
      ``,
      `IMPORTANT: We do NOT know the quantities of ingredients. Common food ingredients like Heavy Cream, Milk, Wheat Flour, Butter, Salt, Sugar, Natural Flavors, and natural colorants like Annatto are NORMAL food ingredients and should NOT be flagged as harmful. Only flag ingredients that are definitively harmful regardless of amount (artificial chemicals, banned substances, etc.).`,
      ``,
      `Grading scale for FOOD products:`,
      `  90-100 (A+, A, A-): Whole food ingredients, minimal processing, clean label, high nutritional value`,
      `  80-89 (B+, B, B-): Mostly whole foods with some processing, acceptable preservatives, good nutritional profile`,
      `  70-79 (C+, C, C-): Moderate processing, some artificial additives, average nutritional value`,
      `  60-69 (D+, D, D-): Highly processed, multiple artificial additives, low nutritional value`,
      `  0-59 (F): Dangerous additives, banned ingredients, severe health concerns`,
      ``,
      `Focus on:`,
      `- Nutritional value: whole grains, vegetables, fruits, lean proteins, healthy fats`,
      `- Processing level: minimal vs highly processed, whole foods vs refined`,
      `- Additives: preservatives (natural vs artificial), artificial colors/flavors, sweeteners`,
      `- Allergens: common allergens (milk, eggs, soy, wheat, nuts, shellfish) - note but don't penalize heavily`,
      `- Harmful compounds to FLAG: trans fats (partially hydrogenated oils), high fructose corn syrup, artificial dyes (Red 40, Yellow 5, Blue 1, etc.), synthetic preservatives (BHA, BHT, TBHQ, sodium benzoate), aluminum compounds (sodium aluminum phosphate, aluminum sulfate), artificial sweeteners (aspartame, sucralose, acesulfame K), MSG, carrageenan. DO NOT flag normal ingredients like sugar, salt, or natural flavors.`,
      `- Supplements: bioavailability of nutrients, presence of fillers (magnesium stearate, silicon dioxide are acceptable), active ingredient quality`,
      ``,
      `Keep output strictly valid JSON.`,
      ``,
      `Product Title: ${title ?? 'Unknown'}`,
      `Ingredients: ${ingredients}`
    ].join('\n');

    const COSMETIC_PROMPT = [
      `You are a cosmetic and skincare safety analyst specializing in beauty products and personal care items.`,
      `Given a cosmetic/beauty product ingredient list (INCI format), analyze it and return a strict JSON object with:`,
      `  numericGrade: integer from 0-100 (0=worst, 100=best)`,
      `  letterGrade: string in {A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F}`,
      `  gradeExplanation: string (3-4 sentences explaining why you assigned this specific grade, focusing on the key factors that influenced your decision such as beneficial actives, harmful ingredients, irritation potential, and overall safety profile)`,
      `  beneficialIngredients: array of ingredient names that are good for skin/hair (e.g., "Niacinamide", "Hyaluronic Acid", "Ceramides", "Vitamin C", "Peptides")`,
      `  harmfulIngredients: array of ingredient names that are irritating/harmful (e.g., "Parabens", "Fragrance", "Denatured Alcohol", "Formaldehyde Releasers", "Phthalates")`,
      `  perIngredient: array of { name, risk: "low"|"medium"|"high", notes, isBeneficial: boolean }`,
      `  suggestions: array of safer alternatives or ingredients to avoid`,
      ``,
      `IMPORTANT: Only flag ingredients that are ACTUALLY PRESENT in the provided ingredient list. Do not hallucinate or assume ingredients.`,
      ``,
      `Grading scale for COSMETIC products:`,
      `  90-100 (A+, A, A-): Clean formulation, beneficial actives, non-toxic, minimal irritants`,
      `  80-89 (B+, B, B-): Safe formulation with some beneficial ingredients, low irritation risk`,
      `  70-79 (C+, C, C-): Moderate safety, some concerning ingredients, potential irritants`,
      `  60-69 (D+, D, D-): Multiple concerning ingredients, high irritation risk, questionable safety`,
      `  0-59 (F): Toxic ingredients, banned substances, severe safety concerns`,
      ``,
      `Focus on:`,
      `- Beneficial actives: niacinamide, hyaluronic acid, ceramides, peptides, antioxidants (vitamin C, E), retinoids, AHAs/BHAs`,
      `- Irritants: fragrance (parfum), denatured alcohol (alcohol denat), essential oils (high concentrations), harsh sulfates (SLS, SLES)`,
      `- Preservatives: parabens (methylparaben, propylparaben), formaldehyde releasers (DMDM hydantoin, quaternium-15), safe alternatives (phenoxyethanol, caprylyl glycol)`,
      `- Sensitizers: dyes, artificial colors, strong fragrances`,
      `- Endocrine disruptors: phthalates, certain UV filters (oxybenzone, octinoxate)`,
      `- Sunscreen filters: mineral (zinc oxide, titanium dioxide - safe) vs chemical (avobenzone, octinoxate - concerns for some)`,
      `- Carcinogens/toxins: formaldehyde, 1,4-dioxane, heavy metals`,
      ``,
      `Keep output strictly valid JSON.`,
      ``,
      `Product Title: ${title ?? 'Unknown'}`,
      `Ingredients: ${ingredients}`
    ].join('\n');

    // Select prompt based on product type (default to COSMETIC for backward compatibility)
    const prompt = isFoodProduct ? FOOD_PROMPT : COSMETIC_PROMPT;

    console.log('[AI_GRADE] Using prompt type:', isFoodProduct ? 'FOOD' : 'COSMETIC');

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
    });

    const json = await r.json();
    const text = json?.choices?.[0]?.message?.content ?? '';
    // Attempt to parse JSON from the modelâ€™s response safely:
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const parsed = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;

    // Cross-validate: ensure AI-flagged ingredients actually exist in the input
    const ingredientsLower = ingredients.toLowerCase();

    const validateIngredients = (arr: string[] | undefined): string[] => {
      if (!Array.isArray(arr)) return [];
      return arr.filter(ing => {
        // Check if ingredient name appears in the actual ingredient list
        const ingLower = ing.toLowerCase();
        // Remove parentheses and special chars for matching
        const normalized = ingLower.replace(/[()]/g, '');
        return ingredientsLower.includes(normalized) ||
               ingredientsLower.includes(ingLower) ||
               // Also check if it's a partial match (e.g., "Parabens" matches "Methylparaben")
               ingredientsLower.split(/[,;]/).some(item =>
                 item.trim().includes(normalized) || normalized.includes(item.trim())
               );
      });
    };

    const letterGrade = parsed?.letterGrade ?? parsed?.grade ?? null;
    const numericGrade = parsed?.numericGrade ?? null;
    const gradeExplanation = parsed?.gradeExplanation ?? '';
    const beneficialIngredients = validateIngredients(parsed?.beneficialIngredients);
    const harmfulIngredients = validateIngredients(parsed?.harmfulIngredients);
    // Keep old 'issues' field for backward compatibility
    const issues = harmfulIngredients.length > 0 ? harmfulIngredients :
                   (Array.isArray(parsed?.issues) ? validateIngredients(parsed.issues) : []);
    const analysis = parsed ?? null;

    return res.status(200).json({
      grade: letterGrade,
      numericGrade,
      gradeExplanation,
      beneficialIngredients,
      harmfulIngredients,
      issues, // backward compatibility
      analysis
    });
  } catch (e) {
    return res.status(200).json({
      grade: null,
      numericGrade: null,
      gradeExplanation: '',
      beneficialIngredients: [],
      harmfulIngredients: [],
      issues: [],
      analysis: null
    });
  }
}