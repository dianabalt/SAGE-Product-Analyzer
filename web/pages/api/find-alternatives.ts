// web/pages/api/find-alternatives.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServer } from '../../lib/supabaseServer';

// GPT-based product categorization
async function getProductCategory(
  productTitle: string,
  ingredients: string
): Promise<{category: string, productType: string}> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const systemPrompt = `You are an expert at categorizing consumer products (beauty, skincare, supplements, food). Analyze the product and determine its specific category and general product type.`;

  const userPrompt = `Categorize this product:

Product Name: ${productTitle}
Ingredients: ${ingredients.substring(0, 300)}${ingredients.length > 300 ? '...' : ''}

Determine:
1. **Specific category**: Be as specific as possible (e.g., "mineral sunscreen", "vitamin D3 supplement", "whey protein powder")
2. **General product type**: Choose ONE from: skincare, beauty, supplement, food

Return ONLY valid JSON:
{
  "category": "specific category here",
  "productType": "skincare|beauty|supplement|food"
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 150,
      temperature: 0.1,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error('Failed to categorize product with GPT');
  }

  const data = await response.json();
  const result = JSON.parse(data.choices[0].message.content);

  return {
    category: result.category || 'wellness product',
    productType: result.productType || 'skincare'
  };
}

// Detect product category from title and ingredients (FALLBACK - used if GPT fails)
function detectCategory(title: string, ingredients?: string): string {
  const titleLower = title.toLowerCase();
  const ingredientsLower = (ingredients || '').toLowerCase();
  const combined = `${titleLower} ${ingredientsLower}`;

  // Skincare categories
  if (combined.match(/\b(sunscreen|spf|sun protection|uv protection)\b/)) return 'sunscreen';
  if (combined.match(/\b(moisturizer|cream|lotion|hydrating|hydration)\b/)) return 'moisturizer';
  if (combined.match(/\b(serum|essence|concentrate)\b/)) return 'serum';
  if (combined.match(/\b(cleanser|face wash|cleansing)\b/)) return 'cleanser';
  if (combined.match(/\b(toner|astringent)\b/)) return 'toner';
  if (combined.match(/\b(mask|clay mask|sheet mask)\b/)) return 'face mask';
  if (combined.match(/\b(exfoliant|exfoliator|scrub|peel)\b/)) return 'exfoliant';
  if (combined.match(/\b(eye cream|under eye)\b/)) return 'eye cream';
  if (combined.match(/\b(lip balm|lip care|chapstick)\b/)) return 'lip balm';
  if (combined.match(/\b(body lotion|body cream|body butter)\b/)) return 'body lotion';
  if (combined.match(/\b(shampoo|hair wash)\b/)) return 'shampoo';
  if (combined.match(/\b(conditioner|hair conditioner)\b/)) return 'conditioner';

  // Health/supplement categories
  if (combined.match(/\b(vitamin|supplement|multivitamin|mineral)\b/)) return 'supplement';
  if (combined.match(/\b(protein powder|protein shake|whey|plant protein)\b/)) return 'protein powder';
  if (combined.match(/\b(probiotic|digestive health|gut health)\b/)) return 'probiotic';
  if (combined.match(/\b(omega|fish oil|dha|epa)\b/)) return 'omega supplement';

  // Default to generic category
  if (combined.match(/\b(skin|face|facial|derma)\b/)) return 'skincare';
  if (combined.match(/\b(hair|scalp)\b/)) return 'hair care';
  if (combined.match(/\b(supplement|capsule|tablet|pill)\b/)) return 'supplement';

  return 'beauty product';
}

// GPT-based product recommendations
async function getGPTProductRecommendations(
  productTitle: string,
  ingredients: string,
  category: string,
  productType: string,
  currentGrade: string,
  currentScore: number,
  harmfulIngredients: string[]
): Promise<Array<{brand: string, product: string, reasoning: string}>> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  // Product type-specific language
  let expertiseArea = 'product ingredient analysis';
  let healthCriteria = 'cleaner, safer ingredients';
  let availabilityNote = 'major retailers (Sephora, Ulta, Target, Amazon, Dermstore)';

  if (productType === 'supplement') {
    expertiseArea = 'supplement quality and bioavailability';
    healthCriteria = 'higher quality, more bioavailable forms with minimal fillers';
    availabilityNote = 'major retailers (iHerb, Vitacost, Amazon, Target, Walmart)';
  } else if (productType === 'food') {
    expertiseArea = 'food ingredient quality and processing';
    healthCriteria = 'whole food ingredients with minimal processing and no artificial additives';
    availabilityNote = 'major retailers (Whole Foods, Target, Walmart, Amazon)';
  } else if (productType === 'beauty') {
    expertiseArea = 'cosmetic ingredient safety';
    healthCriteria = 'non-toxic, cleaner formulations';
    availabilityNote = 'major beauty retailers (Sephora, Ulta, Target, Dermstore)';
  }

  const systemPrompt = `You are an expert in ${expertiseArea}. Recommend specific, real products with healthier formulations.`;

  const userPrompt = `Recommend 5 healthier alternatives to this product:

**Current Product:**
- Name: ${productTitle}
- Category: ${category}
- Current Grade: ${currentGrade} (${currentScore}/100)
- Sample Ingredients: ${ingredients.substring(0, 400)}...
- Concerning Ingredients: ${harmfulIngredients.slice(0, 5).join(', ') || 'None identified'}

**Requirements:**
1. Same category: ${category}
2. Healthier: ${healthCriteria}
3. Available at: ${availabilityNote}
4. REAL products with known ingredient lists (INCIdecoder, Skinsort, OpenFoodFacts, or retailer sites)
5. Different brands (do NOT recommend multiple products from same brand)

**CRITICAL Naming Rules:**
- "brand": ONLY the brand name (e.g., "CeraVe", "Blue Lizard", "Nature Made", "Quest")
- "product": Product name WITHOUT repeating the brand (e.g., "UV Clear SPF 46" NOT "CeraVe UV Clear SPF 46")
- Be concise: "Hydrating Mineral Sunscreen SPF 30" NOT "Hydrating Mineral Sunscreen Face Lotion SPF 30 1.7oz"
- Include key identifiers: SPF number, variant name, active ingredient/flavor if relevant
- Products must be currently available for purchase at major retailers

**Naming Examples by Product Type:**
- Skincare: brand="CeraVe", product="Hydrating Mineral Sunscreen SPF 30"
- Supplements: brand="Nature Made", product="Vitamin D3 2000 IU"
- Food: brand="Quest", product="Protein Bar Chocolate Chip" (no "Quest Protein Bar Chocolate Chip")
- Food (specific): brand="Orgain", product="Organic Protein Powder Vanilla 2lb"

**Response Format (JSON only):**
{
  "recommendations": [
    {
      "brand": "Brand Name Only",
      "product": "Concise product name without brand prefix",
      "reasoning": "Why it's healthier (1 sentence)"
    }
  ]
}

Provide exactly 5 recommendations.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 800,
      temperature: 0.3,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error('Failed to get GPT recommendations');
  }

  const data = await response.json();
  const result = JSON.parse(data.choices[0].message.content);

  return result.recommendations || [];
}

// Find product URL using Tavily (category-aware domain selection)
async function findProductUrl(searchQuery: string, productType: string, category: string): Promise<string | null> {
  const key = process.env.SEARCH_API_KEY;
  if (!key) {
    console.log('[ALTERNATIVES] No Tavily API key');
    return null;
  }

  // Select domains based on product type (from GPT categorization)
  let preferredDomains: string[];

  if (productType === 'supplement') {
    preferredDomains = [
      'iherb.com',
      'vitacost.com',
      'amazon.com',
      'target.com',
      'walmart.com'
    ];
  } else if (productType === 'food') {
    preferredDomains = [
      'world.openfoodfacts.org',
      'amazon.com',
      'target.com',
      'walmart.com'
    ];
  } else {
    // skincare/beauty
    preferredDomains = [
      'incidecoder.com',
      'skinsort.com',
      'sephora.com',
      'ulta.com',
      'dermstore.com',
      'target.com'
    ];
  }

  try {
    // Add category to search query for more specific results
    const enhancedQuery = `"${searchQuery}" ${category} ingredients`;
    console.log('[ALTERNATIVES] Enhanced search query:', enhancedQuery);

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        query: enhancedQuery,
        search_depth: 'basic',
        max_results: 8, // Increased to find better matches
        include_domains: preferredDomains
      })
    });

    if (!response.ok) {
      console.log('[ALTERNATIVES] Tavily error:', response.status);
      return null;
    }

    const data = await response.json();
    const results = data.results || [];

    // Extract category keywords for validation
    const categoryKeywords = category.toLowerCase().split(' ');

    // Return first result that looks like a product page AND matches category
    for (const result of results) {
      const url = result.url;
      const title = (result.title || '').toLowerCase();
      const content = (result.content || '').toLowerCase();

      // Check for product page patterns
      const isProductPage = url.match(/\/(product|products|p|item|dp|gp|ip)\/|\/[A-Z0-9]{8,}/);

      // Reject brand landing pages and category pages
      const isBrandOrCategoryPage = url.match(/\/(brand|brands|shop|category|categories|collections?|all-products)[\/?]/i);

      // Check if title/content contains category keywords
      const matchesCategory = categoryKeywords.some(kw => title.includes(kw) || content.includes(kw));

      if (isProductPage && !isBrandOrCategoryPage && matchesCategory) {
        console.log('[ALTERNATIVES] ✅ Found matching product page:', url);
        return url;
      } else {
        if (!isProductPage) console.log('[ALTERNATIVES] ⏭️  Skipped (not a product page):', url);
        else if (isBrandOrCategoryPage) console.log('[ALTERNATIVES] ⏭️  Skipped (brand/category page):', url);
        else if (!matchesCategory) console.log('[ALTERNATIVES] ⏭️  Skipped (category mismatch):', url);
      }
    }

    // Fallback: return first result that's at least a product page
    for (const result of results) {
      const url = result.url;
      const isBrandOrCategoryPage = url.match(/\/(brand|brands|shop|category|categories|collections?|all-products)[\/?]/i);
      if (url.match(/\/(product|products|p|item|dp|gp|ip)\/|\/[A-Z0-9]{8,}/) && !isBrandOrCategoryPage) {
        console.log('[ALTERNATIVES] ⚠️  Using fallback product page (no category match):', url);
        return url;
      }
    }

    console.log('[ALTERNATIVES] ⚠️  No suitable product pages found');
    return null;
  } catch (error) {
    console.error('[ALTERNATIVES] Tavily search error:', error);
    return null;
  }
}

// Extract and grade a product from a URL
async function gradeProductFromUrl(url: string, originalCategory: string): Promise<any | null> {
  try {
    // Stage 1: Resolve ingredients via DOM extraction
    const resolveRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/resolve-ingredients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_url: url })
    });

    let productData = await resolveRes.json();
    let ingredients = productData.ingredients || '';
    let productTitle = productData.productName || ''; // resolve-ingredients returns 'productName' not 'product_title'

    // Stage 2: Research fallback if no ingredients
    if (!ingredients) {
      console.log('[ALTERNATIVES] DOM extraction failed, trying research...');
      const researchRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/research-ingredients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_title: productTitle, product_url: url })
      });

      const researchData = await researchRes.json();
      ingredients = researchData.ingredients || '';
      if (researchData.detectedName) productTitle = researchData.detectedName; // research-ingredients returns 'detectedName' not 'product_title'
    }

    // If still no ingredients, skip this product
    if (!ingredients || ingredients.length < 20) {
      console.log('[ALTERNATIVES] Insufficient ingredients for:', productTitle);
      return null;
    }

    // Stage 2.5: Validate product category matches original
    // This prevents finding lip products when searching for mascara, etc.
    console.log('[ALTERNATIVES] Validating category match for:', productTitle);

    const altProductName = productTitle.toLowerCase();

    // Define cosmetic category groups for validation
    const cosmeticCategories = {
      mascara: ['mascara'],
      lipstick: ['lipstick', 'lip stick', 'lip color', 'lip stain'],
      lipBalm: ['lip balm', 'lip shine', 'lip gloss', 'lip butter', 'lip moisturizer', 'lip treatment', 'lip oil'],
      eyeshadow: ['eyeshadow', 'eye shadow'],
      eyeliner: ['eyeliner', 'eye liner'],
      foundation: ['foundation'],
      concealer: ['concealer'],
      blush: ['blush'],
      bronzer: ['bronzer'],
      primer: ['primer'],
      moisturizer: ['moisturizer', 'moisturizing cream', 'hydrating cream', 'face cream', 'facial cream'],
      cleanser: ['cleanser', 'face wash', 'facial wash', 'cleansing'],
      serum: ['serum'],
      toner: ['toner'],
      sunscreen: ['sunscreen', 'sun screen', 'spf'],
      exfoliator: ['exfoliator', 'exfoliating', 'scrub'],
      mask: ['mask', 'facial mask', 'face mask']
    };

    // Check if original is in a specific category
    let originalCategoryType: string | null = null;
    let altCategoryType: string | null = null;

    for (const [categoryType, keywords] of Object.entries(cosmeticCategories)) {
      if (keywords.some(kw => originalCategory.toLowerCase().includes(kw))) {
        originalCategoryType = categoryType;
      }
      if (keywords.some(kw => altProductName.includes(kw))) {
        altCategoryType = categoryType;
      }
    }

    // Reject if categories don't match
    if (originalCategoryType && altCategoryType && originalCategoryType !== altCategoryType) {
      console.log(`[ALTERNATIVES] ❌ Category mismatch: original="${originalCategoryType}", alternative="${altCategoryType}" (${productTitle})`);
      return null;
    }

    console.log(`[ALTERNATIVES] ✅ Category validation passed for: ${productTitle}`);


    // Stage 3: Grade the product
    const gradeRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/ai-grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredients })
    });

    const gradeData = await gradeRes.json();

    // ai-grade returns camelCase: numericGrade, beneficialIngredients, harmfulIngredients
    if (!gradeData.grade || !gradeData.numericGrade) {
      console.log('[ALTERNATIVES] Failed to grade:', productTitle);
      console.log('[ALTERNATIVES] gradeData response:', JSON.stringify(gradeData, null, 2));
      return null;
    }

    return {
      title: productTitle,
      url: url,
      ingredients: ingredients,
      grade: gradeData.grade,
      numeric_grade: gradeData.numericGrade, // ai-grade returns camelCase 'numericGrade'
      beneficial_ingredients: gradeData.beneficialIngredients || [], // ai-grade returns 'beneficialIngredients'
      harmful_ingredients: gradeData.harmfulIngredients || [] // ai-grade returns 'harmfulIngredients'
    };
  } catch (error) {
    console.error('[ALTERNATIVES] Error grading product:', error);
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { product_id, product_title, numeric_grade, grade, ingredients } = req.body;

    if (!product_title) {
      return res.status(400).json({ error: 'product_title is required' });
    }

    // Auth check - support both cookie auth (web) and Bearer token (extension)
    const supabase = getSupabaseServer(req, res);
    let user = null;

    // First try cookie-based auth (for web app)
    const cookieAuth = await supabase.auth.getUser();
    if (cookieAuth.data.user) {
      user = cookieAuth.data.user;
    } else {
      // Try Authorization header (for extension)
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { createClient } = await import('@supabase/supabase-js');
        const supabaseAdmin = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        const { data: { user: tokenUser }, error } = await supabaseAdmin.auth.getUser(token);
        if (tokenUser && !error) {
          user = tokenUser;
        }
      }
    }

    if (!user) {
      console.error('[ALTERNATIVES] No user found - not authenticated');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('[ALTERNATIVES] Finding alternatives for:', product_title);
    console.log('[ALTERNATIVES] Current grade:', grade, 'Score:', numeric_grade);

    // Check cache first (if product_id provided)
    if (product_id) {
      // Use adaptive threshold: must be better than source by at least 1 point
      const cacheMinScore = numeric_grade ? Math.max(numeric_grade + 1, 65) : 75;

      const { data: cached } = await supabase
        .from('product_alternatives')
        .select('*')
        .eq('source_product_id', product_id)
        .gte('alternative_score', cacheMinScore) // Adaptive threshold
        .order('alternative_score', { ascending: false })
        .limit(3);

      if (cached && cached.length > 0) {
        console.log('[ALTERNATIVES] Returning', cached.length, 'cached alternatives');
        return res.json({
          success: true,
          alternatives: cached.map(alt => ({
            title: alt.alternative_title,
            url: alt.alternative_url,
            ingredients: alt.alternative_ingredients,
            grade: alt.alternative_grade,
            numeric_grade: alt.alternative_score,
            beneficial_ingredients: alt.beneficial_ingredients || [],
            harmful_ingredients: alt.harmful_ingredients || []
          })),
          cached: true
        });
      }
    }

    // ===== NEW GPT-FIRST FLOW =====

    // Step 1: Use GPT to determine product category and type
    console.log('[ALTERNATIVES] Using GPT to categorize product...');
    let category: string;
    let productType: string;

    try {
      const categorization = await getProductCategory(product_title, ingredients || '');
      category = categorization.category;
      productType = categorization.productType;
      console.log('[ALTERNATIVES] GPT categorization:', { category, productType });
    } catch (error) {
      console.error('[ALTERNATIVES] GPT categorization failed, using fallback');
      category = detectCategory(product_title, ingredients);
      productType = 'skincare'; // Default fallback
      console.log('[ALTERNATIVES] Fallback categorization:', { category, productType });
    }

    // Step 2: Get GPT product recommendations
    console.log('[ALTERNATIVES] Getting GPT recommendations...');
    let recommendations: Array<{brand: string, product: string, reasoning: string}> = [];

    try {
      // Extract harmful ingredients for GPT context
      const harmfulIngredients: string[] = [];
      // Parse ingredients for concerning ones (simplified - AI will do heavy lifting)
      if (ingredients) {
        const ingredientList = ingredients.split(',').map((i: string) => i.trim());
        // Just pass a few for context (GPT already has comprehensive knowledge)
        harmfulIngredients.push(...ingredientList.slice(0, 5));
      }

      recommendations = await getGPTProductRecommendations(
        product_title,
        ingredients || '',
        category,
        productType,
        grade || 'N/A',
        numeric_grade || 0,
        harmfulIngredients
      );

      console.log('[ALTERNATIVES] GPT recommended', recommendations.length, 'products:');
      recommendations.forEach((rec, idx) => {
        console.log(`  ${idx + 1}. ${rec.brand} - ${rec.product}`);
        console.log(`     Reasoning: ${rec.reasoning}`);
      });
    } catch (error) {
      console.error('[ALTERNATIVES] GPT recommendations failed:', error);
      return res.json({
        success: true,
        alternatives: [],
        message: 'Unable to generate recommendations at this time. Please try again later.',
        category: category
      });
    }

    if (recommendations.length === 0) {
      return res.json({
        success: true,
        alternatives: [],
        message: 'No recommendations generated. Your product may already be optimal in its category.',
        category: category
      });
    }

    // Step 3: Research and grade each GPT recommendation
    const alternatives: any[] = [];

    // Adaptive threshold: must be better than source by at least 1 point
    // Set reasonable floor at 65 (D grade) to avoid showing terrible alternatives
    const minScore = numeric_grade ? Math.max(numeric_grade + 1, 65) : 75;
    console.log('[ALTERNATIVES] Minimum score threshold:', minScore, `(source: ${numeric_grade || 'N/A'})`);

    const maxAttempts = 10; // Try up to 10 products (increased from 5)
    const batchSize = 3; // Process 3 products at a time for parallelization

    // Helper function to grade a single recommendation
    const gradeRecommendation = async (rec: {brand: string, product: string}, index: number) => {
      const searchQuery = `${rec.brand} ${rec.product}`;
      console.log(`[ALTERNATIVES] [${index + 1}/${Math.min(recommendations.length, maxAttempts)}] Searching for: "${searchQuery}"`);

      // Find product URL using category-aware search
      const productUrl = await findProductUrl(searchQuery, productType, category);

      if (!productUrl) {
        console.log(`[ALTERNATIVES] ⚠️  No URL found for: ${searchQuery}`);
        return null;
      }

      console.log(`[ALTERNATIVES] Found URL: ${productUrl}`);

      // Grade the product (with category validation)
      const graded = await gradeProductFromUrl(productUrl, category);

      if (graded) {
        // Check if alternative meets adaptive threshold (better than source by 1+ points)
        const meetsThreshold = graded.numeric_grade >= minScore;

        if (meetsThreshold) {
          const improvement = numeric_grade ? `+${graded.numeric_grade - numeric_grade}` : 'N/A';
          console.log(`[ALTERNATIVES] ✅ Added: ${graded.title} - Grade: ${graded.grade} (${graded.numeric_grade}) - Improvement: ${improvement}`);
          return graded;
        } else {
          console.log(`[ALTERNATIVES] ⏭️  Skipped (not better than source): ${graded.title} - Score: ${graded.numeric_grade} (need ${minScore}+)`);
          return null;
        }
      } else {
        console.log(`[ALTERNATIVES] ⚠️  Failed to grade: ${searchQuery}`);
        return null;
      }
    };

    // Process recommendations in batches of 3 for parallel grading
    for (let i = 0; i < Math.min(recommendations.length, maxAttempts); i += batchSize) {
      // Stop if we have 3 good alternatives
      if (alternatives.length >= 3) {
        console.log('[ALTERNATIVES] Found 3 alternatives, stopping search');
        break;
      }

      // Get next batch of recommendations (up to 3)
      const batch = recommendations.slice(i, Math.min(i + batchSize, recommendations.length, maxAttempts));
      console.log(`[ALTERNATIVES] Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} products in parallel`);

      // Grade all products in batch concurrently
      const batchResults = await Promise.all(
        batch.map((rec, batchIndex) => gradeRecommendation(rec, i + batchIndex))
      );

      // Add successful grades to alternatives
      for (const result of batchResults) {
        if (result && alternatives.length < 3) {
          alternatives.push(result);
        }
      }

      console.log(`[ALTERNATIVES] Progress: ${alternatives.length}/3 alternatives found`);
    }

    // Sort by score descending and take top 3
    alternatives.sort((a, b) => b.numeric_grade - a.numeric_grade);
    const topAlternatives = alternatives.slice(0, 3);

    console.log('[ALTERNATIVES] Final count:', topAlternatives.length);

    // If we didn't find ANY alternatives, return helpful message
    if (topAlternatives.length === 0) {
      return res.json({
        success: true,
        alternatives: [],
        message: `No better alternatives found. Your product (grade ${grade}, score ${numeric_grade}) may already be a strong choice in this category, or alternatives may not have sufficient ingredient data available.`,
        category: category
      });
    }

    // Cache results in database (if product_id provided)
    if (product_id && topAlternatives.length > 0) {
      const alternativeRecords = topAlternatives.map(alt => ({
        source_product_id: product_id,
        source_product_title: product_title,
        source_grade: grade,
        source_score: numeric_grade,
        alternative_title: alt.title,
        alternative_url: alt.url,
        alternative_ingredients: alt.ingredients,
        alternative_grade: alt.grade,
        alternative_score: alt.numeric_grade,
        beneficial_ingredients: alt.beneficial_ingredients,
        harmful_ingredients: alt.harmful_ingredients,
        category: category,
        search_query: `GPT recommendations for ${category}` // Updated to reflect new approach
      }));

      const { error: insertError } = await supabase
        .from('product_alternatives')
        .insert(alternativeRecords);

      if (insertError) {
        console.error('[ALTERNATIVES] Cache error:', insertError);
      } else {
        console.log('[ALTERNATIVES] Cached', topAlternatives.length, 'alternatives');
      }
    }

    return res.json({
      success: true,
      alternatives: topAlternatives.map(alt => ({
        title: alt.title,
        url: alt.url,
        ingredients: alt.ingredients,
        grade: alt.grade,
        numeric_grade: alt.numeric_grade,
        beneficial_ingredients: alt.beneficial_ingredients || [],
        harmful_ingredients: alt.harmful_ingredients || []
      })),
      category: category,
      cached: false
    });

  } catch (error: any) {
    console.error('[ALTERNATIVES] Error:', error);
    return res.status(500).json({
      error: 'Failed to find alternatives',
      message: error.message
    });
  }
}
