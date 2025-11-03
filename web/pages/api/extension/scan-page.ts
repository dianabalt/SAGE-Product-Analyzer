// web/pages/api/extension/scan-page.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServer } from '../../../lib/supabaseServer';
import { extractBestIngredientsFromHtml, processModelIngredients } from '../../../lib/ingredientExtract';
import { extractBestProductNameFromHtml, deriveNameFromUrl } from '../../../lib/productName';
import { looksLikeIngredients, stripMarketingCopy, cleanIngredientsHeading } from '../../../lib/looksLikeIngredients';
import { findCachedProduct } from '../../../lib/productLookup';

type ScanPageOut = {
  product_title: string;
  ingredients: string;
  grade: string;
  numeric_grade: number;
  beneficial_ingredients: string[];
  harmful_ingredients: string[];
  sources?: string[];
  extraction_method?: string;
  cached?: boolean;
  cacheAge?: string;
} | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScanPageOut>) {
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
      console.error('[EXTENSION_SCAN_PAGE] No user found - not authenticated');
      return res.status(401).json({ error: 'Not logged in' });
    }

    const { html, url, product_type } = req.body || {};
    if (!html || typeof html !== 'string') {
      return res.status(400).json({ error: 'html required (string)' });
    }

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url required (string)' });
    }

    console.log('[EXTENSION_SCAN_PAGE] start', {
      userId: user.id,
      htmlSize: html.length,
      url: url.substring(0, 100)
    });

    // Extract product name and ingredients from HTML
    const host = (() => {
      try { return new URL(url).hostname.replace(/^www\./, ''); }
      catch { return ''; }
    })();

    console.log('[EXTENSION_SCAN_PAGE] Extracting from host:', host);

    // Extract product name
    let productName = extractBestProductNameFromHtml(html) || deriveNameFromUrl(url) || 'Unknown Product';
    console.log('[EXTENSION_SCAN_PAGE] Product name:', productName);

    // ========== CHECK CACHE FIRST ==========
    const cachedProduct = await findCachedProduct(
      supabase,
      user.id,
      url,
      productName
    );

    if (cachedProduct) {
      const cacheAge = Math.floor(
        (Date.now() - new Date(cachedProduct.updated_at).getTime()) / 1000 / 60
      );

      console.log('[EXTENSION_SCAN_PAGE] 🎯 Found cached product - returning immediately', {
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
        beneficial_ingredients: cachedProduct.beneficial_ingredients || [],
        harmful_ingredients: cachedProduct.issues || [],
        sources: cachedProduct.sources || [],
        extraction_method: 'cached',
        cached: true,
        cacheAge: cachedProduct.updated_at
      });
    }

    console.log('[EXTENSION_SCAN_PAGE] No cache found - proceeding with extraction');

    // Extract ingredients using improved extraction with token-level filtering
    const { text, where } = extractBestIngredientsFromHtml(html, url);
    let domIngredients: string | null = null;
    let extractionMethod = 'none';

    if (text) {
      // First remove headings/footers with rule-based cleaning (100% reliable)
      const withoutHeading = cleanIngredientsHeading(text);

      // Apply processModelIngredients for consistent filtering
      const processed = processModelIngredients(withoutHeading);

      // Belt + suspenders: Also validate with legacy validators
      const cleaned = stripMarketingCopy(processed);
      if (cleaned && looksLikeIngredients(cleaned)) {
        console.log('[EXTENSION_SCAN_PAGE] ✅ DOM extraction passed rule-based validation via:', where);
        domIngredients = cleaned;
        extractionMethod = where || 'dom-generic';
        console.log('[EXTENSION_SCAN_PAGE] Ingredient count:', domIngredients.split(',').length);
        console.log('[EXTENSION_SCAN_PAGE] Ingredients preview:', domIngredients.slice(0, 150));
      } else {
        console.log('[EXTENSION_SCAN_PAGE] ⚠️ DOM extracted text failed rule-based validation');
      }
    } else {
      console.log('[EXTENSION_SCAN_PAGE] ⚠️ No ingredients extracted from HTML');
    }

    let webIngredients = '';
    let sources: string[] = [];

    // If DOM extraction failed or found incomplete data, try web research
    if (!domIngredients || domIngredients.split(',').length < 5) {
      const SEARCH_API_KEY = process.env.SEARCH_API_KEY;

      if (productName && productName.trim().length >= 3 && SEARCH_API_KEY) {
        console.log('[EXTENSION_SCAN_PAGE] Running web research for:', productName);

        try {
          const searchResponse = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              api_key: SEARCH_API_KEY,
              query: `${productName} full ingredients list`,
              search_depth: 'advanced',
              max_results: 5,
              include_domains: ['incidecoder.com', 'sephora.com', 'ulta.com', 'target.com']
            })
          });

          if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            console.log('[EXTENSION_SCAN_PAGE] Web search results:', searchData.results?.length || 0, 'found');

            // Try to extract ingredients from search results
            for (const result of searchData.results || []) {
              if (result.content && result.content.length > 50) {
                // Check if content contains ingredient-like text
                if (/\bingredient/i.test(result.content)) {
                  // Extract the ingredient list from the content
                  const extracted = result.content
                    .replace(/ingredients?:?\s*/i, '')
                    .split(/[.;\n]/)
                    .find((part: string) => part.length > 30 && part.length < 1500) || '';

                  if (extracted && extracted.length > 30) {
                    // Remove headings/footers first (rule-based)
                    const withoutHeading = cleanIngredientsHeading(extracted);
                    const cleaned = stripMarketingCopy(withoutHeading);
                    if (cleaned && looksLikeIngredients(cleaned)) {
                      console.log('[EXTENSION_SCAN_PAGE] ✅ Web candidate passed rule-based validation from:', result.url);
                      webIngredients = cleaned;
                      sources.push('web-research:' + new URL(result.url).hostname);
                      extractionMethod = 'web-research';
                      console.log('[EXTENSION_SCAN_PAGE] Web ingredients preview:', webIngredients.slice(0, 150));
                      break;
                    }
                  }
                }
              }
            }
          }
        } catch (searchError) {
          console.error('[EXTENSION_SCAN_PAGE] Web search error:', searchError);
        }
      }
    }

    // Determine final ingredients
    let finalIngredients = '';

    if (domIngredients && webIngredients) {
      // Both sources found ingredients - use the more complete one
      const domCount = domIngredients.split(',').length;
      const webCount = webIngredients.split(',').length;

      if (webCount > domCount * 1.2) {
        finalIngredients = webIngredients;
        extractionMethod = 'web-research';
      } else {
        finalIngredients = domIngredients;
        extractionMethod = where || 'dom-generic';
        sources.unshift('dom-extraction:' + (where || 'generic'));
      }
    } else if (domIngredients) {
      finalIngredients = domIngredients;
      extractionMethod = where || 'dom-generic';
      sources.push('dom-extraction:' + (where || 'generic'));
    } else if (webIngredients) {
      finalIngredients = webIngredients;
      extractionMethod = 'web-research';
    } else {
      return res.status(400).json({
        error: `Could not extract ingredients for "${productName}" from this page. The page may not contain ingredient information.`
      });
    }

    console.log('[EXTENSION_SCAN_PAGE] Final ingredients extracted (rule-based cleaning):', {
      length: finalIngredients.length,
      ingredientCount: finalIngredients.split(',').length,
      method: extractionMethod,
      preview: finalIngredients.slice(0, 100)
    });

    // ========== GPT PRODUCT CLASSIFICATION ==========
    let determinedProductType: string | null = product_type || null;

    // If user didn't manually specify type, use GPT to classify
    if (!determinedProductType && productName && productName.trim().length >= 3) {
      try {
        const { classifyProductType } = await import('../../../lib/productClassifier');
        const classification = await classifyProductType(productName);
        determinedProductType = classification.type;

        console.log('[EXTENSION_SCAN_PAGE] 🤖 GPT Classification:', {
          type: classification.type,
          confidence: classification.confidence,
          reasoning: classification.reasoning
        });

        // If confidence too low, request user input
        if (classification.confidence < 80 && !product_type) {
          console.log('[EXTENSION_SCAN_PAGE] ⚠️ Low confidence - requesting user confirmation');
          return res.status(200).json({
            needsUserInput: true,
            productName: productName,
            suggestedType: classification.type,
            confidence: classification.confidence,
            reasoning: classification.reasoning
          } as any);
        }
      } catch (classifyError) {
        console.error('[EXTENSION_SCAN_PAGE] GPT classification failed:', classifyError);
        // Continue without classification - not a critical failure
      }
    }

    // Grade the ingredients using the existing ai-grade endpoint
    console.log('[EXTENSION_SCAN_PAGE] Calling ai-grade...');
    const gradeResponse = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/ai-grade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ingredients: finalIngredients,
        title: productName
      })
    });

    if (!gradeResponse.ok) {
      console.error('[EXTENSION_SCAN_PAGE] ai-grade failed');
      return res.status(500).json({ error: 'Failed to grade ingredients' });
    }

    const gradeResult = await gradeResponse.json();
    console.log('[EXTENSION_SCAN_PAGE] Grade result:', gradeResult.grade);

    // Extract beneficial and harmful ingredients from the AI response
    const beneficial: string[] = gradeResult.beneficialIngredients || [];
    const harmful: string[] = gradeResult.harmfulIngredients || [];

    // Save to database
    console.log('[EXTENSION_SCAN_PAGE] Saving to database for user:', user.id);
    const insertPayload = {
      user_id: user.id,
      product_url: url,
      product_title: productName,
      ingredients: finalIngredients,
      grade: gradeResult.grade,
      numeric_grade: gradeResult.numericGrade || null,
      beneficial_ingredients: beneficial,
      issues: harmful,
      sources,
      product_type: determinedProductType, // Save GPT classification or user selection
      analysis: {
        numericGrade: gradeResult.numericGrade,
        perIngredient: gradeResult.perIngredient,
        suggestions: gradeResult.suggestions,
        beneficial,
        harmful,
        extractionMethod
      }
    };

    const { data: insertedData, error: dbError } = await supabase
      .from('products')
      .insert(insertPayload)
      .select()
      .single();

    if (dbError) {
      console.error('[EXTENSION_SCAN_PAGE] ❌ Database insert failed:', dbError);
      // Continue even if DB insert fails
    } else {
      console.log('[EXTENSION_SCAN_PAGE] ✅ Successfully saved to database! ID:', insertedData?.id);
    }

    console.log('[EXTENSION_SCAN_PAGE] Complete!');
    return res.status(200).json({
      product_title: productName,
      ingredients: finalIngredients,
      grade: gradeResult.grade || 'C',
      numeric_grade: gradeResult.numericGrade || 50,
      beneficial_ingredients: beneficial,
      harmful_ingredients: harmful,
      sources,
      extraction_method: extractionMethod
    });

  } catch (e: any) {
    console.error('[EXTENSION_SCAN_PAGE] error', { error: e?.message, stack: e?.stack });
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
