// web/lib/productLookup.ts
// Product caching system - lookup and update existing products to avoid duplicate work

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CachedProduct {
  id: string;
  user_id: string;
  product_title: string;
  product_url: string;
  product_type: string | null;
  ingredients: string;
  grade: string;
  numeric_grade: number;
  beneficial_ingredients: string[] | null;
  issues: string[] | null;
  sources: string[] | null;
  analysis: any;
  created_at: string;
  updated_at: string;
}

/**
 * Check if product exists in database by URL or product name
 * Returns cached product if found, null otherwise
 *
 * Lookup strategy:
 * 1. Exact URL match (highest priority - same page)
 * 2. Product name match (case-insensitive - same product, different URL)
 */
export async function findCachedProduct(
  supabase: SupabaseClient,
  userId: string,
  productUrl: string,
  productName?: string | null
): Promise<CachedProduct | null> {

  console.log('[ProductLookup] Searching for cached product:', {
    productUrl: productUrl.substring(0, 100),
    productName
  });

  // Strategy 1: Exact URL match (most reliable - same webpage)
  if (productUrl && productUrl !== 'extension://image-scan') {
    const { data: urlMatch, error: urlError } = await supabase
      .from('products')
      .select('*')
      .eq('user_id', userId)
      .eq('product_url', productUrl)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(); // Use maybeSingle instead of single to avoid errors when not found

    if (urlMatch && !urlError) {
      const age = Math.floor((Date.now() - new Date(urlMatch.updated_at).getTime()) / 1000 / 60);
      console.log('[ProductLookup] ✅ Found by URL:', {
        id: urlMatch.id,
        title: urlMatch.product_title,
        age_minutes: age
      });
      return urlMatch as CachedProduct;
    }

    if (urlError) {
      console.error('[ProductLookup] URL lookup error:', urlError);
    }
  }

  // Strategy 2: Product name match (case-insensitive, for different URLs of same product)
  // Only try this if we have a valid product name (at least 5 characters)
  if (productName && productName.trim().length >= 5) {
    const cleanName = productName.trim();

    const { data: nameMatches, error: nameError } = await supabase
      .from('products')
      .select('*')
      .eq('user_id', userId)
      .ilike('product_title', cleanName) // Case-insensitive exact match
      .order('updated_at', { ascending: false })
      .limit(1);

    if (nameMatches && nameMatches.length > 0 && !nameError) {
      const match = nameMatches[0];
      const age = Math.floor((Date.now() - new Date(match.updated_at).getTime()) / 1000 / 60);
      console.log('[ProductLookup] ✅ Found by name:', {
        id: match.id,
        title: match.product_title,
        url: match.product_url.substring(0, 100),
        age_minutes: age
      });
      return match as CachedProduct;
    }

    if (nameError) {
      console.error('[ProductLookup] Name lookup error:', nameError);
    }
  }

  console.log('[ProductLookup] ❌ No cached product found');
  return null;
}

/**
 * Update existing product with manual edits
 * Triggers updated_at timestamp and optionally re-grades the product
 */
export async function updateProductWithEdits(
  supabase: SupabaseClient,
  productId: string,
  updates: {
    product_title?: string;
    ingredients?: string;
    grade?: string;
    numeric_grade?: number;
    beneficial_ingredients?: string[];
    issues?: string[];
    analysis?: any;
  }
): Promise<CachedProduct | null> {

  console.log('[ProductLookup] Updating product:', productId, 'with fields:', Object.keys(updates));

  // Filter out undefined values
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([_, v]) => v !== undefined)
  );

  const { data, error } = await supabase
    .from('products')
    .update(cleanUpdates)
    .eq('id', productId)
    .select()
    .maybeSingle();

  if (error) {
    console.error('[ProductLookup] Update failed:', error);
    return null;
  }

  if (!data) {
    console.error('[ProductLookup] Product not found:', productId);
    return null;
  }

  console.log('[ProductLookup] ✅ Product updated successfully');
  return data as CachedProduct;
}

/**
 * Delete a product from the database
 * Used when user removes a product from their history
 */
export async function deleteProduct(
  supabase: SupabaseClient,
  userId: string,
  productId: string
): Promise<boolean> {

  console.log('[ProductLookup] Deleting product:', productId);

  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', productId)
    .eq('user_id', userId); // Ensure user owns the product

  if (error) {
    console.error('[ProductLookup] Delete failed:', error);
    return false;
  }

  console.log('[ProductLookup] ✅ Product deleted successfully');
  return true;
}

/**
 * Check if ingredients have changed significantly (for cache invalidation)
 * Returns true if ingredients are significantly different
 */
export function haveIngredientsChanged(
  cachedIngredients: string,
  newIngredients: string,
  threshold: number = 0.2 // 20% difference
): boolean {
  const cachedTokens = new Set(
    cachedIngredients.toLowerCase().split(',').map(s => s.trim())
  );
  const newTokens = new Set(
    newIngredients.toLowerCase().split(',').map(s => s.trim())
  );

  const intersection = new Set([...cachedTokens].filter(x => newTokens.has(x)));
  const union = new Set([...cachedTokens, ...newTokens]);

  const similarity = intersection.size / union.size;
  const difference = 1 - similarity;

  console.log('[ProductLookup] Ingredient comparison:', {
    cachedCount: cachedTokens.size,
    newCount: newTokens.size,
    similarity: Math.round(similarity * 100) + '%',
    significantChange: difference > threshold
  });

  return difference > threshold;
}
