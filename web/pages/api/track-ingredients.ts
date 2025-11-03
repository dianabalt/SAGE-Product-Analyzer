// web/pages/api/track-ingredients.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServer } from '../../lib/supabaseServer';

/**
 * POST /api/track-ingredients
 * Extracts individual ingredients from a product's ingredient list
 * and stores them in ingredient_suggestions table for autocomplete.
 *
 * This should be called automatically after a product is saved.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = getSupabaseServer(req, res);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { ingredients } = req.body;

    if (!ingredients || typeof ingredients !== 'string') {
      return res.status(400).json({ error: 'Invalid ingredients' });
    }

    console.log('[TRACK_INGREDIENTS] Parsing ingredients for user:', user.id);

    // Parse ingredient list (comma-separated)
    const ingredientList = ingredients
      .split(',')
      .map((ing) => ing.trim())
      .filter((ing) => ing.length > 0 && ing.length < 100); // Filter out empty and too-long entries

    console.log('[TRACK_INGREDIENTS] Parsed', ingredientList.length, 'ingredients');

    // Insert or update each ingredient in the suggestions table
    const now = new Date().toISOString();
    let successCount = 0;
    let errorCount = 0;

    for (const ingredient of ingredientList) {
      try {
        // Check if exists
        const { data: existing } = await supabase
          .from('ingredient_suggestions')
          .select('id, frequency')
          .eq('user_id', user.id)
          .eq('ingredient', ingredient)
          .maybeSingle(); // Use maybeSingle() instead of single() to avoid error when no row found

        if (existing) {
          // Update frequency and last_seen
          const { error: updateError } = await supabase
            .from('ingredient_suggestions')
            .update({
              frequency: existing.frequency + 1,
              last_seen: now
            })
            .eq('id', existing.id);

          if (updateError) {
            console.error('[TRACK_INGREDIENTS] Update error:', updateError);
            throw updateError;
          }
        } else {
          // Insert new
          const { error: insertError } = await supabase
            .from('ingredient_suggestions')
            .insert({
              user_id: user.id,
              ingredient,
              frequency: 1,
              last_seen: now
            });

          if (insertError) {
            // Log the full error for debugging
            console.error('[TRACK_INGREDIENTS] Insert error:', {
              message: insertError.message,
              details: insertError.details,
              hint: insertError.hint,
              code: insertError.code
            });
            throw insertError;
          }
        }

        successCount++;
      } catch (err: any) {
        console.error('[TRACK_INGREDIENTS] Error tracking ingredient:', ingredient, err?.message || err);
        errorCount++;
      }
    }

    console.log('[TRACK_INGREDIENTS] Tracked', successCount, 'ingredients,', errorCount, 'errors');

    return res.status(200).json({
      success: true,
      tracked: successCount,
      errors: errorCount
    });
  } catch (error: any) {
    console.error('[TRACK_INGREDIENTS] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
