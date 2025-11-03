// web/pages/api/ingredient-suggestions.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServer } from '../../lib/supabaseServer';

/**
 * GET /api/ingredient-suggestions?search=...
 * Returns ingredient suggestions based on:
 * 1. User's past scanned products (from ingredient_suggestions table)
 * 2. Common cosmetic ingredients (hardcoded list)
 *
 * Ingredients are ranked by:
 * - Frequency (how often they appear in user's scans)
 * - Recency (when they were last seen)
 * - Alphabetical match with search query
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = getSupabaseServer(req, res);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const search = (req.query.search as string || '').toLowerCase().trim();
    const limit = parseInt(req.query.limit as string || '10');

    console.log('[INGREDIENT_SUGGESTIONS] Fetching suggestions for search:', search);

    // For now, we'll skip database lookup and just use the common ingredients list
    // In the future, you can uncomment the code below to enable ingredient learning from scans
    const userSuggestions: Array<{ ingredient: string; frequency: number; last_seen: string }> | null = null;

    /*
    // OPTIONAL: Fetch user's ingredient suggestions from database (requires ingredient_suggestions table)
    const { data: userSuggestions, error } = await supabase
      .from('ingredient_suggestions')
      .select('ingredient, frequency, last_seen')
      .eq('user_id', user.id)
      .order('frequency', { ascending: false })
      .order('last_seen', { ascending: false });

    if (error) {
      console.error('[INGREDIENT_SUGGESTIONS] Database error:', error);
      // Continue with just common ingredients
    }
    */

    // Common cosmetic/supplement ingredients (fallback/default list)
    const commonIngredients = [
      // Beneficial ingredients (common in high-quality products)
      'Hyaluronic Acid', 'Niacinamide', 'Vitamin C', 'Retinol', 'Peptides',
      'Ceramides', 'Glycerin', 'Salicylic Acid', 'Alpha Arbutin', 'Azelaic Acid',
      'Centella Asiatica', 'Green Tea Extract', 'Vitamin E', 'Squalane', 'Panthenol',
      'Allantoin', 'Beta Glucan', 'Snail Mucin', 'Propolis', 'Resveratrol',
      'Bakuchiol', 'Tranexamic Acid', 'Adenosine', 'Caffeine', 'Licorice Root Extract',

      // Potentially concerning ingredients
      'Parabens', 'Methylparaben', 'Propylparaben', 'Butylparaben',
      'Sulfates', 'Sodium Lauryl Sulfate', 'Sodium Laureth Sulfate',
      'Phthalates', 'Dibutyl Phthalate', 'Diethyl Phthalate',
      'Formaldehyde', 'Fragrance', 'Parfum', 'Alcohol', 'Ethanol',
      'Mineral Oil', 'Petrolatum', 'Petroleum Jelly',
      'Silicones', 'Dimethicone', 'Cyclomethicone',
      'Triclosan', 'Triclocarban', 'Oxybenzone',
      'Retinyl Palmitate', 'BHA', 'BHT',
      'Coal Tar', 'Hydroquinone', 'Lead', 'Mercury',
      'Talc', 'Polyethylene', 'PEG', 'Propylene Glycol'
    ];

    // Combine user suggestions with common ingredients
    const allSuggestions = new Map<string, { ingredient: string; score: number }>();

    // Add user's scanned ingredients (higher priority)
    (userSuggestions as Array<{ ingredient: string; frequency: number; last_seen: string }> | null)?.forEach((s) => {
      const ingredient = s.ingredient;
      // Score based on frequency and recency
      const recencyBonus = new Date(s.last_seen).getTime() / 1000000; // Recent = higher score
      const score = (s.frequency * 100) + recencyBonus;
      allSuggestions.set(ingredient.toLowerCase(), { ingredient, score });
    });

    // Add common ingredients (lower priority if not in user's history)
    commonIngredients.forEach((ingredient) => {
      const key = ingredient.toLowerCase();
      if (!allSuggestions.has(key)) {
        allSuggestions.set(key, { ingredient, score: 0 });
      }
    });

    // Filter by search query if provided
    let filtered = Array.from(allSuggestions.values());
    if (search) {
      filtered = filtered.filter((s) =>
        s.ingredient.toLowerCase().includes(search)
      );
    }

    // Sort by score (descending), then alphabetically
    filtered.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.ingredient.localeCompare(b.ingredient);
    });

    // Return top N suggestions
    const suggestions = filtered.slice(0, limit).map((s) => s.ingredient);

    console.log('[INGREDIENT_SUGGESTIONS] Returning', suggestions.length, 'suggestions:', suggestions.slice(0, 3));

    return res.status(200).json({ suggestions });
  } catch (error: any) {
    console.error('[INGREDIENT_SUGGESTIONS] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
