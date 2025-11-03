// web/pages/api/extension/scan.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServer } from '../../../lib/supabaseServer';
import { processModelIngredients } from '../../../lib/ingredientExtract';
import { cleanIngredientsWithAI, joinCleanedIngredients, needsFoodCleaning, needsCosmeticCleaning } from '../../../lib/cleanIngredients';
import { createDebugContext, printScanSummary, trackDroppedToken } from '../../../lib/debugContext';
import { looksLikeFoodIngredients } from '../../../lib/looksLikeIngredients';
import { findCachedProduct } from '../../../lib/productLookup';

type ScanOut = {
  product_title: string;
  ingredients: string;
  grade: string;
  numeric_grade: number;
  grade_explanation?: string;
  beneficial_ingredients: string[];
  harmful_ingredients: string[];
  sources?: string[];
  cached?: boolean;
  cacheAge?: string;
} | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScanOut>) {
  const ctx = createDebugContext();
  const t0 = Date.now();

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const supabase = getSupabaseServer(req, res);

    // Auth check - support both cookie auth (web) and Bearer token (extension)
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
      console.error('[EXTENSION_SCAN] No user found - not authenticated');
      return res.status(401).json({ error: 'Not logged in' });
    }

    const { image, page_url, product_type } = req.body || {};
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'image required (base64 string)' });
    }

    console.log('[EXTENSION_SCAN] start', {
      userId: user.id,
      imageSize: image.length,
      imagePrefix: image.substring(0, 30),
      page_url: page_url || 'none'
    });

    // Use actual page URL if available and valid
    let contextUrl = 'extension://image-scan';
    if (page_url && page_url.trim().length > 0 &&
        !page_url.startsWith('chrome://') &&
        !page_url.startsWith('chrome-extension://') &&
        (page_url.startsWith('http://') || page_url.startsWith('https://'))) {
      contextUrl = page_url;
    }

    ctx.productUrl = contextUrl;
    ctx.scanId = `scan_${Date.now()}_${user.id.substring(0, 8)}`;

    // Validate image format
    if (!image.startsWith('data:image/')) {
      console.error('[EXTENSION_SCAN] Invalid image format, must be data URL');
      return res.status(400).json({ error: 'Invalid image format. Must be a data URL (data:image/png;base64,...)' });
    }

    // Extract ingredients from image using OpenAI Vision
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      console.error('[EXTENSION_SCAN] OpenAI API key not configured');
      return res.status(500).json({ error: 'Vision API not configured. Please add OPENAI_API_KEY to your .env.local file.' });
    }

    // Helper function to call OpenAI Vision with retry logic
    async function extractIngredientsFromImage(imageData: string, retryCount = 0): Promise<{ product_name: string; ingredients: string[] }> {
      const isRetry = retryCount > 0;
      const systemPrompt = isRetry ?
        `CRITICAL: You MUST return ONLY valid JSON. NO prose, NO explanations, NO markdown code blocks.` : '';

      console.log(`[EXTENSION_SCAN] Calling OpenAI Vision API... (attempt ${retryCount + 1})`);

      const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
              content: systemPrompt || 'You are an expert at reading product labels and extracting ingredient lists from supplement and cosmetic product images. Always return strict JSON only.'
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `**TASK:** Extract ONLY the product name from this product image.

**WHAT TO EXTRACT:**
- Look at the front label for the main product title
- Include brand name + product name + flavor/variant (if visible)
- Examples:
  * "Dr. Bronner's Peppermint Pure-Castile Soap"
  * "Optimum Nutrition Gold Standard 100% WHEY French Vanilla Creme"
  * "Premier Protein Shake Chocolate"
  * "Vitamin D3 10,000 IU + K2 (MK-7)"
  * "CLINIQUE Moisture Surge 100H Auto-Replenishing Hydrator"

**IMPORTANT FOR FOOD/SUPPLEMENT PRODUCTS:**
- If this is a food or supplement, ALWAYS include the flavor or variant
- Look for flavor text near the product name (e.g., "Chocolate", "Vanilla", "Strawberry", "French Vanilla Creme")
- Flavors are often in different colors, fonts, or below the main product name
- Include size/count if it's part of the product name (e.g., "100 Count", "2lb")

**WHAT NOT TO EXTRACT:**
- Do NOT extract ingredients (leave ingredients array empty)
- Do NOT extract serving size, calories, or nutritional facts
- Do NOT extract marketing slogans or descriptions like "Build Muscle" or "Great Taste"

**OUTPUT FORMAT (STRICT JSON ONLY - NO MARKDOWN, NO PROSE):**
{
  "product_name": "exact product name from label including flavor",
  "ingredients": []
}

**IMPORTANT:**
- ALWAYS return ingredients as an empty array []
- We will find ingredients using web research instead`
                },
                {
                  type: 'image_url',
                  image_url: { url: imageData }
                }
              ]
            }
          ],
          max_tokens: 1500,
          temperature: 0.1 // Very low temperature for strict extraction
        })
      });

      if (!visionResponse.ok) {
        const errorText = await visionResponse.text();
        console.error('[EXTENSION_SCAN] Vision API error:', {
          status: visionResponse.status,
          statusText: visionResponse.statusText,
          error: errorText
        });

        // Provide more helpful error messages
        if (visionResponse.status === 401) {
          throw new Error('OpenAI API key is invalid. Please check your OPENAI_API_KEY in .env.local');
        } else if (visionResponse.status === 429) {
          throw new Error('OpenAI API rate limit exceeded. Please try again later.');
        } else {
          throw new Error(`Failed to analyze image: ${errorText.substring(0, 200)}`);
        }
      }

      const visionResult = await visionResponse.json();
      console.log('[EXTENSION_SCAN] Vision raw response:', visionResult.choices[0]?.message?.content?.substring(0, 300));

      const extractedText = visionResult.choices[0]?.message?.content?.trim();
      if (!extractedText) {
        throw new Error('Could not extract text from image');
      }

      // Parse the JSON response
      let extractedData: { product_name: string; ingredients: string[] } | undefined;
      try {
        // Remove markdown code blocks if present
        const cleanedText = extractedText
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .replace(/^[^{]*({.*})[^}]*$/s, '$1') // Extract first JSON object
          .trim();

        extractedData = JSON.parse(cleanedText);

        // Ensure extractedData is defined and has correct structure
        if (!extractedData || !extractedData.product_name || !Array.isArray(extractedData.ingredients)) {
          throw new Error('Invalid JSON structure: missing product_name or ingredients array');
        }

        // OCR now ONLY extracts product_name (not ingredients)
        // Web research will always be triggered to find ingredients
        console.log('[EXTENSION_SCAN] ✅ Successfully extracted product name (web research will find ingredients):', {
          product_name: extractedData.product_name
        });

        return extractedData;

      } catch (parseError: any) {
        console.error('[EXTENSION_SCAN] JSON parse failed:', {
          error: parseError.message,
          extractedText: extractedText.substring(0, 500),
          attempt: retryCount + 1
        });

        // Retry once with stricter prompt
        if (!isRetry) {
          console.log('[EXTENSION_SCAN] Retrying with stricter prompt...');
          return extractIngredientsFromImage(imageData, retryCount + 1);
        }

        // Both attempts failed - check if we at least got product_name for web research fallback
        if (extractedData?.product_name) {
          console.log('[EXTENSION_SCAN] ⚠️ JSON parsing failed but got product name, returning for web research fallback');
          // Return what we have - let the main handler trigger web research
          return {
            product_name: extractedData.product_name,
            ingredients: extractedData?.ingredients || []
          };
        }

        // Complete failure - couldn't parse JSON or extract product name
        throw new Error(`Could not extract product information from image. Please ensure the image shows:\n• Clear product label\n• "Ingredients:" or "Supplement Facts" section\n• Well-lit, focused image`);
      }
    }

    // Extract ingredients from image
    console.log('[EXTENSION_SCAN] Starting ingredient extraction...');
    const tOCRStart = Date.now();
    const extractedData = await extractIngredientsFromImage(image);
    const tOCREnd = Date.now();

    const { product_name, ingredients: rawIngredientsArray } = extractedData;

    ctx.productName = product_name;
    ctx.timing.domSeconds = (tOCREnd - tOCRStart) / 1000; // Track OCR time as "DOM" time for now

    console.log('[EXTENSION_SCAN] Extracted from image (raw):', {
      product_name,
      ingredient_count: rawIngredientsArray.length,
      preview: rawIngredientsArray.slice(0, 5).join(', ')
    });

    // ========== CHECK CACHE FIRST ==========
    const cachedProduct = await findCachedProduct(
      supabase,
      user.id,
      contextUrl,
      product_name
    );

    if (cachedProduct) {
      const cacheAge = Math.floor(
        (Date.now() - new Date(cachedProduct.updated_at).getTime()) / 1000 / 60
      );

      console.log('[EXTENSION_SCAN] 🎯 Found cached product - returning immediately', {
        id: cachedProduct.id,
        title: cachedProduct.product_title,
        grade: cachedProduct.grade,
        cacheAge: cacheAge + ' minutes'
      });

      // Return cached data in same format as fresh scan
      return res.status(200).json({
        product_title: cachedProduct.product_title,
        ingredients: cachedProduct.ingredients,
        grade: cachedProduct.grade,
        numeric_grade: cachedProduct.numeric_grade,
        grade_explanation: cachedProduct.grade_explanation || undefined,
        beneficial_ingredients: cachedProduct.beneficial_ingredients || [],
        harmful_ingredients: cachedProduct.issues || [],
        sources: cachedProduct.sources || [],
        cached: true,
        cacheAge: cachedProduct.updated_at
      });
    }

    console.log('[EXTENSION_SCAN] No cache found - proceeding with extraction');

    // VALIDATION: Apply token-level filtering using processModelIngredients
    // Join array into comma-separated string for processing
    const rawIngredientsString = rawIngredientsArray.join(', ');

    // Apply same validation as Stage A/B
    let imageIngredients = processModelIngredients(rawIngredientsString);

    // Additional validation with legacy validators (belt + suspenders)
    const { looksLikeIngredients, stripMarketingCopy, v2Checks } = await import('../../../lib/looksLikeIngredients');
    const { flags } = await import('../../../lib/flags');

    if (imageIngredients) {
      const stripped = stripMarketingCopy(imageIngredients);
      if (stripped && looksLikeIngredients(stripped)) {
        imageIngredients = stripped;
        console.log('[EXTENSION_SCAN] ✅ Image ingredients passed validation:', {
          count: imageIngredients.split(',').length,
          preview: imageIngredients.slice(0, 150)
        });

        // ========== Phase A: Validator V2 (Shadow Mode) ==========
        if (flags.validatorV2) {
          const tokens = imageIngredients.split(',').map(t => t.trim());
          const v2Result = v2Checks(imageIngredients, tokens);

          console.log('[EXTENSION_SCAN] Validator V2 (shadow mode):', {
            commaDensityOk: v2Result.commaDensityOk,
            maxLenOk: v2Result.maxLenOk,
            hasBadPhrases: v2Result.hasBadPhrases,
            dictCoverage: v2Result.dictCoverage,
            mayContain: v2Result.mayContain
          });

          if (!v2Result.commaDensityOk || !v2Result.maxLenOk || v2Result.hasBadPhrases) {
            console.log('[EXTENSION_SCAN] ⚠️ V2 validation concerns detected (but not blocking in shadow mode)');
          } else {
            console.log('[EXTENSION_SCAN] ✅ V2 validation passed');
          }
        }
      } else {
        console.warn('[EXTENSION_SCAN] ⚠️ Extracted text failed validation, will try web search instead');
        imageIngredients = '';
      }
    }

    console.log('[EXTENSION_SCAN] Image ingredients after validation:', imageIngredients ? imageIngredients.slice(0, 100) + '...' : 'none');

    // ========== GPT PRODUCT CLASSIFICATION ==========
    let determinedProductType: string | null = product_type || null;
    let determinedProductSubtype: string | null = null;

    // If user didn't manually specify type, use GPT to classify
    if (!determinedProductType && product_name && product_name.trim().length >= 3) {
      try {
        const { classifyProductType } = await import('../../../lib/productClassifier');
        const classification = await classifyProductType(product_name);
        determinedProductType = classification.type;
        determinedProductSubtype = classification.subtype;

        console.log('[EXTENSION_SCAN] 🤖 GPT Classification:', {
          type: classification.type,
          subtype: classification.subtype,
          confidence: classification.confidence,
          reasoning: classification.reasoning
        });

        // If confidence too low, request user input
        if (classification.confidence < 80 && !product_type) {
          console.log('[EXTENSION_SCAN] ⚠️ Low confidence - requesting user confirmation');
          return res.status(200).json({
            needsUserInput: true,
            productName: product_name,
            suggestedType: classification.type,
            confidence: classification.confidence,
            reasoning: classification.reasoning
          } as any);
        }
      } catch (classifyError) {
        console.error('[EXTENSION_SCAN] GPT classification failed:', classifyError);
        // Continue without classification - not a critical failure
      }
    }

    let webIngredients = '';
    let domIngredients = '';
    let sources: string[] = [];

    // DOM EXTRACTION: If page_url provided, try DOM extraction first (like "Scan Current Page" button)
    // This is ideal when user scans an image while on the product page
    if (page_url && page_url.trim().length > 0 && !page_url.startsWith('chrome://') && !page_url.startsWith('chrome-extension://')) {
      console.log('[EXTENSION_SCAN] 🔍 Attempting DOM extraction from current page:', page_url);

      try {
        // Fetch the HTML from the page_url
        const pageResponse = await fetch(page_url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
          }
        });

        if (pageResponse.ok) {
          const html = await pageResponse.text();
          console.log('[EXTENSION_SCAN] Fetched page HTML, size:', html.length);

          // Use same extraction logic as scan-page.ts
          const { extractBestIngredientsFromHtml } = await import('../../../lib/ingredientExtract');
          const { cleanIngredientsHeading, stripMarketingCopy, looksLikeIngredients, looksLikeFoodIngredients } = await import('../../../lib/looksLikeIngredients');

          const { text: extracted, where } = extractBestIngredientsFromHtml(html, page_url);

          if (extracted) {
            const withoutHeading = cleanIngredientsHeading(extracted);
            const processed = processModelIngredients(withoutHeading);

            // Type-aware validation (same as research-ingredients.ts)
            const isFoodProduct = determinedProductType === 'FOOD';

            if (isFoodProduct) {
              // FOOD/SUPPLEMENT: Use relaxed food validator (no stripMarketingCopy)
              if (looksLikeFoodIngredients(processed)) {
                domIngredients = processed;
                console.log('[EXTENSION_SCAN] ✅ DOM extraction passed food validation via:', where);
                sources.push('dom-extraction:' + new URL(page_url).hostname);
                console.log('[EXTENSION_SCAN] DOM ingredients preview:', domIngredients.slice(0, 150));
              } else {
                console.log('[EXTENSION_SCAN] ⚠️ DOM extracted text failed food validation');
              }
            } else {
              // COSMETIC/BEAUTY: Use strict INCI validator
              const stripped = stripMarketingCopy(processed);
              if (stripped && looksLikeIngredients(stripped)) {
                domIngredients = stripped;
                console.log('[EXTENSION_SCAN] ✅ DOM extraction passed INCI validation via:', where);
                sources.push('dom-extraction:' + new URL(page_url).hostname);
                console.log('[EXTENSION_SCAN] DOM ingredients preview:', domIngredients.slice(0, 150));
              } else {
                console.log('[EXTENSION_SCAN] ⚠️ DOM extracted text failed INCI validation');
              }
            }
          } else {
            console.log('[EXTENSION_SCAN] ⚠️ No ingredients extracted from DOM');
          }
        } else {
          console.log('[EXTENSION_SCAN] ⚠️ Failed to fetch page:', pageResponse.status);
        }
      } catch (domError: any) {
        console.error('[EXTENSION_SCAN] DOM extraction error (will try web research):', domError.message);
      }
    }

    // WEB RESEARCH: If DOM extraction failed, fallback to web research via Tavily
    // OCR extracts only product name, web research finds ingredients from authoritative sources
    const needsWebResearch = !domIngredients && (!imageIngredients || imageIngredients.split(',').length < 5);

    if (needsWebResearch && product_name && product_name.trim().length >= 3) {
      console.log('[EXTENSION_SCAN] 🔍 Using web research to find ingredients for:', product_name);

      try {
        const tResearchStart = Date.now();
        ctx.pipeline.webResearchAttempted = true;

        // Call the existing research-ingredients API (same as URL mode)
        const researchResponse = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/research-ingredients`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            product_title: product_name,
            product_type: determinedProductType || undefined
          })
        });

        const tResearchEnd = Date.now();
        ctx.timing.researchSeconds = (tResearchEnd - tResearchStart) / 1000;

        if (researchResponse.ok) {
          const researchData = await researchResponse.json();
          console.log('[EXTENSION_SCAN] Web research response:', {
            found: !!researchData.ingredients,
            sources: researchData.sources?.length || 0,
            confidence: researchData.confidence,
            productType: researchData.productType || 'none'
          });

          // Capture GPT classification from research response (if not already set)
          if (researchData.productType && !determinedProductType) {
            determinedProductType = researchData.productType;
            console.log('[EXTENSION_SCAN] GPT classified via research as:', determinedProductType);
          }

          if (researchData.ingredients) {
            webIngredients = researchData.ingredients;
            sources = researchData.sources || ['web-research'];
            ctx.pipeline.webResearchSuccess = true;
            ctx.pipeline.webResearchSources = sources;
            console.log('[EXTENSION_SCAN] ✅ Found web ingredients, count:', webIngredients.split(',').length);
            console.log('[EXTENSION_SCAN] Web ingredients preview:', webIngredients.slice(0, 150));
          }
        } else {
          console.log('[EXTENSION_SCAN] ⚠️ Web research failed:', researchResponse.status);
        }
      } catch (searchError) {
        console.error('[EXTENSION_SCAN] Web research error (continuing with image-only):', searchError);
      }
    }

    // Compare and merge ingredients from all sources (priority: DOM > Image > Web)
    let finalIngredients = '';

    if (domIngredients) {
      // DOM extraction is most reliable (from actual product page)
      console.log('[EXTENSION_SCAN] ✅ Using DOM ingredients (from current page)');
      finalIngredients = domIngredients;
    } else if (imageIngredients && webIngredients) {
      // Both sources found ingredients - use the longer/more complete list
      const imageCount = imageIngredients.split(',').length;
      const webCount = webIngredients.split(',').length;

      console.log('[EXTENSION_SCAN] Dual-source comparison:', {
        imageCount,
        webCount,
        imageLengthChars: imageIngredients.length,
        webLengthChars: webIngredients.length
      });

      // Use the source with more ingredients OR longer text (more detailed)
      if (webCount > imageCount * 1.2 || webIngredients.length > imageIngredients.length * 1.3) {
        // Web has significantly more ingredients
        console.log('[EXTENSION_SCAN] ✅ Using WEB ingredients (more complete)');
        finalIngredients = webIngredients;
      } else if (imageCount > webCount * 1.2 || imageIngredients.length > webIngredients.length * 1.3) {
        // Image has significantly more ingredients
        console.log('[EXTENSION_SCAN] ✅ Using IMAGE ingredients (more complete)');
        finalIngredients = imageIngredients;
        sources.unshift('image-scan'); // Add image as primary source
      } else {
        // Similar - merge them intelligently
        console.log('[EXTENSION_SCAN] ✅ Merging BOTH sources (similar completeness)');
        // Prefer image scan as primary, but note web verification
        finalIngredients = imageIngredients;
        sources.unshift('image-scan');
        sources.push('verified-with-web');
      }
    } else if (imageIngredients) {
      // Only image found ingredients
      console.log('[EXTENSION_SCAN] ✅ Using IMAGE ingredients only');
      finalIngredients = imageIngredients;
      sources.push('image-scan');
    } else if (webIngredients) {
      // Only web found ingredients
      console.log('[EXTENSION_SCAN] ✅ Using WEB ingredients only');
      finalIngredients = webIngredients;
    } else {
      // Neither source found ingredients - offer manual input
      if (!product_name || product_name.trim().length < 3) {
        return res.status(400).json({
          error: 'Could not identify product name from image. Please ensure the product label is clearly visible.',
          needsManualInput: true
        } as any);
      }
      return res.status(400).json({
        error: `Could not find ingredients for "${product_name}". Would you like to enter them manually?`,
        needsManualInput: true,
        productName: product_name
      } as any);
    }

    // ✨ Apply AI cleaning ONLY to OCR-extracted ingredients (not web research)
    // OCR can have text merging issues like "IngredientsWater" that AI can fix
    // But web research ingredients are already clean and AI adds hallucinations
    const isOCRSource = sources.includes('image-scan') || (sources.length === 0 && imageIngredients);

    if (isOCRSource && imageIngredients) {
      console.log('[EXTENSION_SCAN] Applying AI cleaning to OCR ingredients (fixes text merging)...');
      try {
        const aiCleaned = await cleanIngredientsWithAI(finalIngredients, product_name);
        if (aiCleaned.ingredients.length > 0) {
          const beforeCount = finalIngredients.split(',').length;
          finalIngredients = joinCleanedIngredients(aiCleaned);
          console.log('[EXTENSION_SCAN] ✅ AI cleaning complete:', {
            beforeCount,
            afterCount: aiCleaned.ingredients.length,
            preview: finalIngredients.slice(0, 150)
          });
        } else {
          console.log('[EXTENSION_SCAN] ⚠️ AI cleaning returned empty, keeping original');
        }
      } catch (cleanError) {
        console.error('[EXTENSION_SCAN] ⚠️ AI cleaning failed, using original:', cleanError);
        // Continue with original ingredients if AI cleaning fails
      }
    } else {
      console.log('[EXTENSION_SCAN] ℹ️ Skipping AI cleaning (web research source - already clean)');
    }

    // 🍔 Apply AI cleaning to FOOD products with filler text
    // Removes section headers, marketing phrases, explanatory parentheses, allergen statements, etc.
    if (determinedProductType === 'FOOD' && finalIngredients && needsFoodCleaning(finalIngredients)) {
      console.log('[EXTENSION_SCAN] 🧹 Food product contains filler text, applying AI cleaning...');
      try {
        const aiCleaned = await cleanIngredientsWithAI(finalIngredients, product_name, 'FOOD');
        const cleanedText = joinCleanedIngredients(aiCleaned);

        // Validate cleaned output
        const hasMinimumIngredients = aiCleaned.ingredients.length >= 3;
        const passesValidation = looksLikeFoodIngredients(cleanedText);
        const notEmpty = cleanedText.length > 0;

        if (notEmpty && passesValidation && hasMinimumIngredients) {
          const beforeCount = finalIngredients.split(',').length;
          finalIngredients = cleanedText;
          console.log('[EXTENSION_SCAN] ✅ Food cleaning complete:', {
            beforeCount,
            afterCount: aiCleaned.ingredients.length,
            removedCount: beforeCount - aiCleaned.ingredients.length,
            preview: finalIngredients.slice(0, 150)
          });

          // If allergens were extracted, log them (we could save these separately in future)
          if (aiCleaned.contains.length > 0) {
            console.log('[EXTENSION_SCAN] 📋 Extracted allergens (contains):', aiCleaned.contains.join(', '));
          }
          if (aiCleaned.mayContain.length > 0) {
            console.log('[EXTENSION_SCAN] 📋 Extracted allergens (may contain):', aiCleaned.mayContain.join(', '));
          }
        } else {
          console.log('[EXTENSION_SCAN] ⚠️ Food cleaning failed validation, using original:', {
            notEmpty,
            passesValidation,
            hasMinimumIngredients,
            cleanedLength: cleanedText.length,
            cleanedCount: aiCleaned.ingredients.length
          });
        }
      } catch (cleanError) {
        console.error('[EXTENSION_SCAN] ⚠️ Food cleaning error, using original:', cleanError);
        // Continue with original ingredients if AI cleaning fails
      }
    } else if (determinedProductType === 'FOOD') {
      console.log('[EXTENSION_SCAN] ℹ️ Food product but no filler patterns detected, skipping cleaning');
    }

    // 💄 Apply AI cleaning to COSMETIC products with filler text
    // Removes tool tips, UI elements, functional descriptions, marketing claims, etc.
    if (determinedProductType === 'COSMETIC' && finalIngredients && needsCosmeticCleaning(finalIngredients)) {
      console.log('[EXTENSION_SCAN] 🧹 Cosmetic product contains filler text, applying AI cleaning...');
      try {
        const aiCleaned = await cleanIngredientsWithAI(finalIngredients, product_name, 'COSMETIC');
        const cleanedText = joinCleanedIngredients(aiCleaned);

        // Validate cleaned output
        const hasMinimumIngredients = aiCleaned.ingredients.length >= 3;
        const passesValidation = cleanedText.length > 0 && /[a-zA-Z]{3,}/.test(cleanedText);
        const notEmpty = cleanedText.length > 0;

        if (notEmpty && passesValidation && hasMinimumIngredients) {
          const beforeCount = finalIngredients.split(',').length;
          finalIngredients = cleanedText;
          console.log('[EXTENSION_SCAN] ✅ Cosmetic cleaning complete:', {
            beforeCount,
            afterCount: aiCleaned.ingredients.length,
            removedCount: beforeCount - aiCleaned.ingredients.length,
            preview: finalIngredients.slice(0, 150)
          });

          // Log any allergen info if extracted
          if (aiCleaned.contains.length > 0) {
            console.log('[EXTENSION_SCAN] 📋 Extracted allergens (contains):', aiCleaned.contains.join(', '));
          }
          if (aiCleaned.mayContain.length > 0) {
            console.log('[EXTENSION_SCAN] 📋 Extracted allergens (may contain):', aiCleaned.mayContain.join(', '));
          }
        } else {
          console.log('[EXTENSION_SCAN] ⚠️ Cosmetic cleaning failed validation, using original:', {
            notEmpty,
            passesValidation,
            hasMinimumIngredients,
            cleanedLength: cleanedText.length,
            cleanedCount: aiCleaned.ingredients.length
          });
        }
      } catch (cleanError) {
        console.error('[EXTENSION_SCAN] ⚠️ Cosmetic cleaning error, using original:', cleanError);
        // Continue with original ingredients if AI cleaning fails
      }
    } else if (determinedProductType === 'COSMETIC') {
      console.log('[EXTENSION_SCAN] ℹ️ Cosmetic product but no filler patterns detected, skipping cleaning');
    }

    // Grade the ingredients using the existing ai-grade endpoint
    console.log('[EXTENSION_SCAN] Calling ai-grade with', finalIngredients.length, 'chars of ingredients...');
    const tGradeStart = Date.now();

    const gradeResponse = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/ai-grade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ingredients: finalIngredients,
        title: product_name || 'Product from Image Scan',
        product_type: determinedProductType, // Pass type for type-aware grading (FOOD vs COSMETIC)
      })
    });

    if (!gradeResponse.ok) {
      console.error('[EXTENSION_SCAN] ai-grade failed');
      return res.status(500).json({ error: 'Failed to grade ingredients' });
    }

    const gradeResult = await gradeResponse.json();
    const tGradeEnd = Date.now();
    ctx.timing.gradingSeconds = (tGradeEnd - tGradeStart) / 1000;

    console.log('[EXTENSION_SCAN] Grade result:', gradeResult);

    // Extract beneficial and harmful ingredients from the AI response
    const beneficial: string[] = gradeResult.beneficialIngredients || [];
    const harmful: string[] = gradeResult.harmfulIngredients || [];
    const gradeExplanation: string = gradeResult.gradeExplanation || '';

    console.log('[EXTENSION_SCAN] Beneficial:', beneficial);
    console.log('[EXTENSION_SCAN] Harmful:', harmful);
    console.log('[EXTENSION_SCAN] Grade explanation:', gradeExplanation);

    // Update debug context with grading results
    ctx.extraction.totalIngredients = finalIngredients.split(',').length;
    ctx.grading = {
      grade: gradeResult.grade || 'C',
      numericGrade: gradeResult.numericGrade || 50,
      issuesCount: harmful.length
    };

    // Save to database
    console.log('[EXTENSION_SCAN] Saving to database for user:', user.id);
    const tDBStart = Date.now();

    // Use actual page URL if available and valid (not chrome:// or chrome-extension://)
    let finalProductUrl = 'extension://image-scan';
    if (page_url && page_url.trim().length > 0 &&
        !page_url.startsWith('chrome://') &&
        !page_url.startsWith('chrome-extension://') &&
        (page_url.startsWith('http://') || page_url.startsWith('https://'))) {
      finalProductUrl = page_url;
      console.log('[EXTENSION_SCAN] Using page URL:', finalProductUrl);
    } else {
      console.log('[EXTENSION_SCAN] No valid page URL, using fallback:', finalProductUrl);
    }

    const insertPayload = {
      user_id: user.id,
      product_url: finalProductUrl,
      product_title: product_name || 'Product from Image Scan',
      ingredients: finalIngredients,
      grade: gradeResult.grade,
      numeric_grade: gradeResult.numericGrade || null, // Add top-level numeric_grade for dashboard compatibility
      grade_explanation: gradeExplanation || null, // Add GPT explanation for why this grade was assigned
      beneficial_ingredients: beneficial, // Add top-level beneficial_ingredients for dashboard compatibility
      issues: harmful, // Use harmful array for issues (same as harmfulIngredients)
      sources,
      product_type: determinedProductType, // Save GPT classification or user selection (FOOD or COSMETIC for extraction)
      product_subtype: determinedProductSubtype, // Save GPT subtype classification (5 categories for user display)
      analysis: {
        numericGrade: gradeResult.numericGrade,
        perIngredient: gradeResult.perIngredient,
        suggestions: gradeResult.suggestions,
        beneficial,
        harmful
      }
    };

    console.log('[EXTENSION_SCAN] Insert payload:', {
      ...insertPayload,
      ingredients: insertPayload.ingredients?.slice(0, 100) + '...',
      analysis: 'truncated'
    });

    const { data: insertedData, error: dbError } = await supabase
      .from('products')
      .insert(insertPayload)
      .select()
      .single();

    const tDBEnd = Date.now();
    ctx.timing.dbSeconds = (tDBEnd - tDBStart) / 1000;

    if (dbError) {
      console.error('[EXTENSION_SCAN] ❌ Database insert failed:', dbError);
      console.error('[EXTENSION_SCAN] Error details:', {
        message: dbError.message,
        details: dbError.details,
        hint: dbError.hint,
        code: dbError.code
      });
      // Continue even if DB insert fails
    } else {
      console.log('[EXTENSION_SCAN] ✅ Successfully saved to database! ID:', insertedData?.id);

      // OPTIONAL: Track ingredients for autocomplete (requires ingredient_suggestions table)
      /*
      if (finalIngredients) {
        try {
          const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
          await fetch(`${base}/api/track-ingredients`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': req.headers.cookie || ''
            },
            body: JSON.stringify({ ingredients: finalIngredients }),
          });
          console.log('[EXTENSION_SCAN] ingredients-tracked');
        } catch (trackError: any) {
          console.warn('[EXTENSION_SCAN] Failed to track ingredients:', trackError?.message);
        }
      }
      */
    }

    // Calculate total time and print summary
    ctx.timing.totalSeconds = (Date.now() - t0) / 1000;
    ctx.pipeline.domAttempted = true;
    ctx.pipeline.domSuccess = !!finalIngredients;
    ctx.pipeline.webResearchNeeded = needsWebResearch;

    printScanSummary(ctx);

    console.log('[EXTENSION_SCAN] Complete!');
    return res.status(200).json({
      product_title: product_name || 'Product from Image Scan',
      ingredients: finalIngredients,
      grade: gradeResult.grade || 'C',
      numeric_grade: gradeResult.numericGrade || 50,
      grade_explanation: gradeExplanation,
      beneficial_ingredients: beneficial,
      harmful_ingredients: harmful,
      sources
    });

  } catch (e: any) {
    console.error('[EXTENSION_SCAN] error', { error: e?.message, stack: e?.stack });
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
