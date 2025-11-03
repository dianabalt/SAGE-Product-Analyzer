// web/pages/api/save-product.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServer } from '../../lib/supabaseServer';
import { isBotProtectionName } from '../../lib/detectBotProtection';
import { deriveNameFromUrl } from '../../lib/productName';
import { findCachedProduct } from '../../lib/productLookup';
import { cleanIngredientsWithAI, joinCleanedIngredients, needsFoodCleaning, needsCosmeticCleaning } from '../../lib/cleanIngredients';
import { looksLikeFoodIngredients } from '../../lib/looksLikeIngredients';

type SaveOut = { product: any; cached?: boolean; cacheAge?: string } | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<SaveOut>) {
  const t0 = Date.now();
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const supabase = getSupabaseServer(req, res);

    // Auth from Supabase cookie
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Not logged in' });

    const {
      product_url,
      product_title,                  // optional: dashboard "title" or extracted product name
      ingredients: clientIngredients, // optional textarea from dashboard
      product_type,                   // optional: user-specified or extracted product type (FOOD or COSMETIC)
      product_subtype,                // optional: extracted product subtype (FOOD, HEALTH_SUPPLEMENT, etc.)
    } = req.body || {};

    if (!product_url) return res.status(400).json({ error: 'product_url required' });

    console.log('[SAVE] start', {
      userId: user.id,
      product_url,
      clientTitle: product_title || null,
      clientProductType: product_type || null,
      clientProductSubtype: product_subtype || null
    });

    const sources: string[] = [];
    let ingredientsText: string = (clientIngredients || '').trim();
    let effectiveName: string | null = product_title || null; // Use dashboard-provided title if available (from resolve-ingredients)
    let determinedProductType: string | null = product_type || null; // Will be updated by GPT if not manually specified
    let determinedProductSubtype: string | null = product_subtype || null; // Will be set by GPT classification or from dashboard

    const addHost = (url: string) => {
      try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        if (!sources.includes(host)) sources.push(host);
      } catch {}
    };

    // ========== CHECK CACHE FIRST (Skip if manual ingredients provided) ==========
    if (!ingredientsText) {
      const cachedProduct = await findCachedProduct(
        supabase,
        user.id,
        product_url,
        product_title
      );

      if (cachedProduct) {
        const cacheAge = Math.floor(
          (Date.now() - new Date(cachedProduct.updated_at).getTime()) / 1000 / 60
        );

        console.log('[SAVE] 🎯 Found cached product - returning immediately', {
          id: cachedProduct.id,
          title: cachedProduct.product_title,
          grade: cachedProduct.grade,
          cacheAge: cacheAge + ' minutes',
          ms: Date.now() - t0
        });

        // Return cached data immediately (no extraction, no grading, no API calls)
        return res.status(200).json({
          product: cachedProduct,
          cached: true,
          cacheAge: cachedProduct.updated_at
        });
      }

      console.log('[SAVE] No cache found - proceeding with full scan');
    } else {
      console.log('[SAVE] Manual ingredients provided - skipping cache lookup');
    }

    // -------- Stage A: try extract from THIS page --------
    if (!ingredientsText) {
      try {
        const base = req.headers.origin || `http://${req.headers.host}`;
        const r = await fetch(`${base}/api/resolve-ingredients`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_url, product_title })
        });
        const jr = await r.json();

        if (jr?.productName && !effectiveName) {
          // Validate the product name isn't from bot protection
          if (isBotProtectionName(jr.productName)) {
            console.log('[SAVE] bot-protection-name-from-resolve', { name: jr.productName });
            effectiveName = deriveNameFromUrl(product_url) || null;
          } else {
            effectiveName = jr.productName;
          }
        }

        if (jr?.ingredients) {
          ingredientsText = jr.ingredients;
          if (jr?.source) sources.push(jr.source);
          if (jr?.sourceUrl) addHost(jr.sourceUrl);
        }

        // Capture product type from resolve-ingredients (if available)
        if (jr?.productType && !determinedProductType) {
          determinedProductType = jr.productType;
          console.log('[SAVE] Type from resolve:', determinedProductType);
        }
        if (jr?.productSubtype && !determinedProductSubtype) {
          determinedProductSubtype = jr.productSubtype;
          console.log('[SAVE] Subtype from resolve:', determinedProductSubtype);
        }
      } catch {}
    }

    // -------- Stage B: Tavily research fallback --------
    if (!ingredientsText && process.env.SEARCH_API_KEY) {
      try {
        const base = req.headers.origin || `http://${req.headers.host}`;
        const r2 = await fetch(`${base}/api/research-ingredients`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_url,
            product_title: effectiveName || product_title || null,
            product_type: product_type || undefined, // Pass user-specified type to GPT classifier
          })
        });
        const j2 = await r2.json();

        // Check if GPT classification needs user input
        if (j2?.needsUserInput) {
          console.log('[SAVE] GPT needs user input for classification');
          return res.status(200).json(j2); // Pass through the needsUserInput response
        }

        if (j2?.ingredients) {
          ingredientsText = j2.ingredients;

          if (Array.isArray(j2.sources)) {
            for (const u of j2.sources.slice(0, 3)) addHost(u);
          }
          if (!sources.includes('research')) sources.push('research');

          if (j2?.detectedName && !effectiveName) effectiveName = j2.detectedName;
        }

        // Capture GPT product classification if returned (moved outside ingredients check)
        if (j2?.productType && !determinedProductType) {
          determinedProductType = j2.productType;
          console.log('[SAVE] GPT classified type as:', determinedProductType);
        }
        if (j2?.productSubtype) {
          determinedProductSubtype = j2.productSubtype;
          console.log('[SAVE] GPT classified subtype as:', determinedProductSubtype);
        }
      } catch {}
    }

    // Debug: what we are about to grade
    const preview = (ingredientsText || '').replace(/\s+/g, ' ').slice(0, 300);
    console.log('[SAVE] grade-input-preview', {
      len: (ingredientsText || '').length,
      preview,
      sources,
      effectiveName
    });

    // 🍔 Apply AI cleaning to FOOD products with filler text
    // Removes section headers, marketing phrases, explanatory parentheses, allergen statements, etc.
    if (determinedProductType === 'FOOD' && ingredientsText && needsFoodCleaning(ingredientsText)) {
      console.log('[SAVE] 🧹 Food product contains filler text, applying AI cleaning...');
      try {
        const aiCleaned = await cleanIngredientsWithAI(ingredientsText, effectiveName || undefined, 'FOOD');
        const cleanedText = joinCleanedIngredients(aiCleaned);

        // Validate cleaned output
        const hasMinimumIngredients = aiCleaned.ingredients.length >= 3;
        const passesValidation = looksLikeFoodIngredients(cleanedText);
        const notEmpty = cleanedText.length > 0;

        if (notEmpty && passesValidation && hasMinimumIngredients) {
          const beforeCount = ingredientsText.split(',').length;
          ingredientsText = cleanedText;
          console.log('[SAVE] ✅ Food cleaning complete:', {
            beforeCount,
            afterCount: aiCleaned.ingredients.length,
            removedCount: beforeCount - aiCleaned.ingredients.length,
            preview: ingredientsText.slice(0, 150)
          });

          // If allergens were extracted, log them (we could save these separately in future)
          if (aiCleaned.contains.length > 0) {
            console.log('[SAVE] 📋 Extracted allergens (contains):', aiCleaned.contains.join(', '));
          }
          if (aiCleaned.mayContain.length > 0) {
            console.log('[SAVE] 📋 Extracted allergens (may contain):', aiCleaned.mayContain.join(', '));
          }
        } else {
          console.log('[SAVE] ⚠️ Food cleaning failed validation, using original:', {
            notEmpty,
            passesValidation,
            hasMinimumIngredients,
            cleanedLength: cleanedText.length,
            cleanedCount: aiCleaned.ingredients.length
          });
        }
      } catch (cleanError) {
        console.error('[SAVE] ⚠️ Food cleaning error, using original:', cleanError);
        // Continue with original ingredients if AI cleaning fails
      }
    } else if (determinedProductType === 'FOOD') {
      console.log('[SAVE] ℹ️ Food product but no filler patterns detected, skipping cleaning');
    }

    // 💄 Apply AI cleaning to COSMETIC products with filler text
    // Removes tool tips, UI elements, functional descriptions, marketing claims, etc.
    if (determinedProductType === 'COSMETIC' && ingredientsText && needsCosmeticCleaning(ingredientsText)) {
      console.log('[SAVE] 🧹 Cosmetic product contains filler text, applying AI cleaning...');
      try {
        const aiCleaned = await cleanIngredientsWithAI(ingredientsText, effectiveName || undefined, 'COSMETIC');
        const cleanedText = joinCleanedIngredients(aiCleaned);

        // Validate cleaned output
        const hasMinimumIngredients = aiCleaned.ingredients.length >= 3;
        const passesValidation = cleanedText.length > 0 && /[a-zA-Z]{3,}/.test(cleanedText);
        const notEmpty = cleanedText.length > 0;

        if (notEmpty && passesValidation && hasMinimumIngredients) {
          const beforeCount = ingredientsText.split(',').length;
          ingredientsText = cleanedText;
          console.log('[SAVE] ✅ Cosmetic cleaning complete:', {
            beforeCount,
            afterCount: aiCleaned.ingredients.length,
            removedCount: beforeCount - aiCleaned.ingredients.length,
            preview: ingredientsText.slice(0, 150)
          });

          // If allergens were extracted, log them (we could save these separately in future)
          if (aiCleaned.contains.length > 0) {
            console.log('[SAVE] 📋 Extracted allergens (contains):', aiCleaned.contains.join(', '));
          }
          if (aiCleaned.mayContain.length > 0) {
            console.log('[SAVE] 📋 Extracted allergens (may contain):', aiCleaned.mayContain.join(', '));
          }
        } else {
          console.log('[SAVE] ⚠️ Cosmetic cleaning failed validation, using original:', {
            notEmpty,
            passesValidation,
            hasMinimumIngredients,
            cleanedLength: cleanedText.length,
            cleanedCount: aiCleaned.ingredients.length
          });
        }
      } catch (cleanError) {
        console.error('[SAVE] ⚠️ Cosmetic cleaning error, using original:', cleanError);
        // Continue with original ingredients if AI cleaning fails
      }
    } else if (determinedProductType === 'COSMETIC') {
      console.log('[SAVE] ℹ️ Cosmetic product but no filler patterns detected, skipping cleaning');
    }

    // -------- Grade (only if we have ingredients) --------
    let grade: string | null = null;
    let numericGrade: number | null = null;
    let gradeExplanation: string | null = null;
    let beneficialIngredients: string[] | null = null;
    let issues: string[] | null = null;
    let analysis: any = { input: { preview, len: (ingredientsText || '').length, sources, effectiveName } };

    if (ingredientsText) {
      try {
        const base = req.headers.origin || `http://${req.headers.host}`;
        const ai = await fetch(`${base}/api/ai-grade`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ingredients: ingredientsText,
            title: effectiveName || null,
            product_type: determinedProductType, // Pass type for type-aware grading (FOOD vs COSMETIC)
          }),
        }).then(r => r.json());

        grade = ai?.grade ?? null;
        numericGrade = ai?.numericGrade ?? null;
        gradeExplanation = ai?.gradeExplanation ?? null;
        beneficialIngredients = Array.isArray(ai?.beneficialIngredients) ? ai.beneficialIngredients : null;
        issues = Array.isArray(ai?.harmfulIngredients) ? ai.harmfulIngredients :
                 (Array.isArray(ai?.issues) ? ai.issues : null);
        analysis = { ...analysis, ai: ai?.analysis ?? null };

        // Update product type from AI if not already set
        if (ai?.productType && !determinedProductType) {
          determinedProductType = ai.productType;
          console.log('[SAVE] AI classified product type as:', determinedProductType);
        }

        console.log('[SAVE] grade-done', { grade, numericGrade, gradeExplanation, beneficialIngredients, issues, productType: determinedProductType });
      } catch {
        // ignore; insert ungraded
      }
    } else {
      console.log('[SAVE] no-ingredients-to-grade');
      // Add a warning message for the user when ingredients cannot be found
      analysis = {
        ...analysis,
        warning: 'no-ingredients-found',
        message: 'Ingredients could not be automatically extracted. Please use the SAGE Chrome Extension to scan the product image for better results.'
      };
    }

    // -------- Insert into DB --------
    const insertPayload = {
      user_id: user.id,
      product_title: effectiveName || null,
      product_url,
      ingredients: ingredientsText || null,
      grade,
      numeric_grade: numericGrade,
      grade_explanation: gradeExplanation, // GPT explanation for why this grade was assigned
      beneficial_ingredients: beneficialIngredients,
      issues,
      sources: sources.length ? sources : null,
      analysis, // requires jsonb column; remove if not present
      product_type: determinedProductType, // Save GPT classification or user selection (FOOD or COSMETIC for extraction)
      product_subtype: determinedProductSubtype, // Save GPT subtype classification (5 categories for user display)
    };

    const { data, error } = await supabase
      .from('products')
      .insert([insertPayload])
      .select()
      .single();

    if (error) {
      console.log('[SAVE] db-error', { ms: Date.now() - t0, error: error.message });
      return res.status(200).json({ error: error.message });
    }

    console.log('[SAVE] db-inserted', {
      ms: Date.now() - t0,
      id: data?.id,
      grade: data?.grade ?? null,
      issues: data?.issues ?? null,
      sources: data?.sources ?? null,
      title: data?.product_title ?? null
    });

    // -------- Track ingredients for autocomplete suggestions --------
    // OPTIONAL: Uncomment this if you want to learn from scanned products (requires ingredient_suggestions table)
    /*
    if (ingredientsText) {
      try {
        const base = req.headers.origin || `http://${req.headers.host}`;
        await fetch(`${base}/api/track-ingredients`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ingredients: ingredientsText }),
        });
        console.log('[SAVE] ingredients-tracked');
      } catch (trackError: any) {
        console.warn('[SAVE] Failed to track ingredients:', trackError?.message);
      }
    }
    */

    // Include warning if ingredients weren't found
    const responsePayload: any = { product: data };
    if (!ingredientsText) {
      responsePayload.warning = 'no-ingredients-found';
      responsePayload.message = 'Ingredients could not be automatically extracted. Please use the SAGE Chrome Extension to scan the product image for better results.';
    }

    return res.status(200).json(responsePayload);
  } catch (e: any) {
    console.log('[SAVE] error', { ms: Date.now() - t0, error: e?.message });
    return res.status(200).json({ error: e?.message || 'unknown error' });
  }
}