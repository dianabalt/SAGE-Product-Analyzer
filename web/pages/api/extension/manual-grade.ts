// web/pages/api/extension/manual-grade.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServer } from '../../../lib/supabaseServer';
import { looksLikeIngredients } from '../../../lib/looksLikeIngredients';

type ManualGradeOut = {
  product_title: string;
  ingredients: string;
  grade: string;
  numeric_grade: number;
  beneficial_ingredients: string[];
  harmful_ingredients: string[];
  sources: string[];
} | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ManualGradeOut>) {
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
      console.error('[MANUAL_GRADE] No user found - not authenticated');
      return res.status(401).json({ error: 'Not logged in' });
    }

    const { product_name, ingredients } = req.body || {};

    if (!product_name || typeof product_name !== 'string') {
      return res.status(400).json({ error: 'product_name required (string)' });
    }

    if (!ingredients || typeof ingredients !== 'string') {
      return res.status(400).json({ error: 'ingredients required (string)' });
    }

    console.log('[MANUAL_GRADE] start', {
      userId: user.id,
      productName: product_name,
      ingredientsLength: ingredients.length
    });

    // Validate ingredients format
    const trimmedIngredients = ingredients.trim();

    if (trimmedIngredients.length < 10) {
      return res.status(400).json({ error: 'Ingredients list too short. Please enter at least a few ingredients.' });
    }

    if (!trimmedIngredients.includes(',')) {
      return res.status(400).json({ error: 'Please separate ingredients with commas' });
    }

    // Validate it looks like ingredients (not marketing copy)
    if (!looksLikeIngredients(trimmedIngredients)) {
      console.log('[MANUAL_GRADE] ⚠️ Ingredients failed validation (marketing copy or invalid format)');
      return res.status(400).json({
        error: 'The text does not appear to be a valid ingredient list. Please paste only the ingredient list separated by commas.'
      });
    }

    console.log('[MANUAL_GRADE] ✅ Ingredients passed validation');

    // Grade ingredients using AI
    console.log('[MANUAL_GRADE] Calling ai-grade with', trimmedIngredients.length, 'chars of ingredients');

    const gradeResponse = await fetch(`${req.headers.host?.startsWith('localhost') ? 'http' : 'https'}://${req.headers.host}/api/ai-grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredients: trimmedIngredients }),
    });

    if (!gradeResponse.ok) {
      const errText = await gradeResponse.text();
      console.error('[MANUAL_GRADE] ❌ ai-grade failed:', errText);
      return res.status(500).json({ error: 'Failed to grade ingredients' });
    }

    const gradeData = await gradeResponse.json();
    console.log('[MANUAL_GRADE] Grade result:', {
      grade: gradeData.grade,
      numericGrade: gradeData.numericGrade,
      beneficialCount: gradeData.beneficialIngredients?.length,
      harmfulCount: gradeData.harmfulIngredients?.length
    });

    // Save to database
    const insertPayload = {
      user_id: user.id,
      product_url: 'extension://manual-entry',
      product_title: product_name.trim(),
      ingredients: trimmedIngredients,
      grade: gradeData.grade || gradeData.letterGrade || 'N/A',
      numeric_grade: gradeData.numericGrade || 0,
      beneficial_ingredients: gradeData.beneficialIngredients || [],
      issues: gradeData.harmfulIngredients || [],
      sources: ['Manual Entry'],
      analysis: gradeData.analysis || {}
    };

    console.log('[MANUAL_GRADE] Saving to database...', {
      user_id: insertPayload.user_id,
      product_title: insertPayload.product_title,
      grade: insertPayload.grade
    });

    const { data: insertedProduct, error: insertError } = await supabase
      .from('products')
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) {
      console.error('[MANUAL_GRADE] ❌ Database insert failed:', insertError);
      return res.status(500).json({ error: 'Failed to save product to database' });
    }

    console.log('[MANUAL_GRADE] ✅ Successfully saved to database! ID:', insertedProduct.id);

    // OPTIONAL: Track ingredients for autocomplete (requires ingredient_suggestions table)
    /*
    try {
      const base = `${req.headers.host?.startsWith('localhost') ? 'http' : 'https'}://${req.headers.host}`;
      await fetch(`${base}/api/track-ingredients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': req.headers.cookie || ''
        },
        body: JSON.stringify({ ingredients: trimmedIngredients }),
      });
      console.log('[MANUAL_GRADE] ingredients-tracked');
    } catch (trackError: any) {
      console.warn('[MANUAL_GRADE] Failed to track ingredients:', trackError?.message);
    }
    */

    // Return result in ScanResult format
    return res.status(200).json({
      product_title: product_name.trim(),
      ingredients: trimmedIngredients,
      grade: gradeData.grade || gradeData.letterGrade || 'N/A',
      numeric_grade: gradeData.numericGrade || 0,
      beneficial_ingredients: gradeData.beneficialIngredients || [],
      harmful_ingredients: gradeData.harmfulIngredients || [],
      sources: ['Manual Entry']
    });

  } catch (error: any) {
    console.error('[MANUAL_GRADE] ❌ Unexpected error:', error);
    return res.status(500).json({
      error: error.message || 'An unexpected error occurred while grading ingredients'
    });
  }
}
