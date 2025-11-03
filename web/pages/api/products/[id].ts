// web/pages/api/products/[id].ts
// API endpoint for manual product edits with automatic re-grading

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServer } from '../../../lib/supabaseServer';
import { updateProductWithEdits, haveIngredientsChanged, deleteProduct } from '../../../lib/productLookup';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const supabase = getSupabaseServer(req, res);

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const productId = req.query.id as string;

    if (!productId) {
      return res.status(400).json({ error: 'Product ID required' });
    }

    // ========== GET: Fetch product details ==========
    if (req.method === 'GET') {
      const { data: product, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .eq('user_id', user.id) // RLS enforcement
        .single();

      if (error || !product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      return res.status(200).json({ product });
    }

    // ========== PATCH: Update product with manual edits ==========
    if (req.method === 'PATCH') {
      const { product_title, ingredients, product_subtype, custom_tag_name, custom_tag_color } = req.body;

      console.log('[PRODUCT_EDIT] Updating product:', {
        id: productId,
        userId: user.id,
        hasNewTitle: !!product_title,
        hasNewIngredients: !!ingredients,
        hasNewProductSubtype: !!product_subtype,
        hasCustomTagName: !!custom_tag_name,
        hasCustomTagColor: !!custom_tag_color
      });

      // Fetch existing product first
      const { data: existingProduct, error: fetchError } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .eq('user_id', user.id) // RLS enforcement
        .single();

      if (fetchError || !existingProduct) {
        console.error('[PRODUCT_EDIT] ❌ Product not found:', fetchError);
        return res.status(404).json({ error: 'Product not found' });
      }

      // Check if ingredients actually changed
      const ingredientsChanged = ingredients && haveIngredientsChanged(
        existingProduct.ingredients,
        ingredients
      );

      console.log('[PRODUCT_EDIT] Ingredients changed?', ingredientsChanged);

      let gradeResult: any = null;

      // If ingredients changed, re-grade the product
      if (ingredientsChanged) {
        console.log('[PRODUCT_EDIT] 🤖 Re-grading product with new ingredients...');

        try {
          const gradeResponse = await fetch(
            `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/ai-grade`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ingredients,
                title: product_title || existingProduct.product_title
              })
            }
          );

          if (!gradeResponse.ok) {
            console.error('[PRODUCT_EDIT] ❌ Grading failed:', gradeResponse.status);
            return res.status(500).json({ error: 'Failed to grade updated ingredients' });
          }

          gradeResult = await gradeResponse.json();

          console.log('[PRODUCT_EDIT] ✅ New grade:', gradeResult.grade);

        } catch (gradeError: any) {
          console.error('[PRODUCT_EDIT] ❌ Grading error:', gradeError.message);
          return res.status(500).json({ error: 'Failed to grade updated ingredients' });
        }
      }

      // Build updates object
      const updates: any = {};

      if (product_title && product_title !== existingProduct.product_title) {
        updates.product_title = product_title;
      }

      if (ingredientsChanged) {
        updates.ingredients = ingredients;
      }

      // Update tag fields (allow null to clear custom values)
      // Note: product_subtype is user-editable (5 display categories)
      // product_type is NOT editable by users (FOOD/COSMETIC for extraction system only)
      if (product_subtype !== undefined && product_subtype !== existingProduct.product_subtype) {
        updates.product_subtype = product_subtype;
      }

      if (custom_tag_name !== undefined && custom_tag_name !== existingProduct.custom_tag_name) {
        updates.custom_tag_name = custom_tag_name || null;
      }

      if (custom_tag_color !== undefined && custom_tag_color !== existingProduct.custom_tag_color) {
        updates.custom_tag_color = custom_tag_color || null;
      }

      if (gradeResult) {
        updates.grade = gradeResult.grade;
        updates.numeric_grade = gradeResult.numericGrade || null;
        updates.beneficial_ingredients = gradeResult.beneficialIngredients || [];
        updates.issues = gradeResult.harmfulIngredients || [];
        updates.analysis = {
          ...existingProduct.analysis,
          numericGrade: gradeResult.numericGrade,
          perIngredient: gradeResult.perIngredient,
          suggestions: gradeResult.suggestions,
          beneficial: gradeResult.beneficialIngredients,
          harmful: gradeResult.harmfulIngredients,
          manuallyEdited: true,
          lastEditedAt: new Date().toISOString()
        };
      }

      // If no changes, return existing product
      if (Object.keys(updates).length === 0) {
        console.log('[PRODUCT_EDIT] No changes detected');
        return res.status(200).json({ product: existingProduct });
      }

      // Update product in database
      console.log('[PRODUCT_EDIT] 💾 Saving updates to database...');

      const updatedProduct = await updateProductWithEdits(supabase, productId, updates);

      if (!updatedProduct) {
        console.error('[PRODUCT_EDIT] ❌ Database update failed');
        return res.status(500).json({ error: 'Failed to update product' });
      }

      console.log('[PRODUCT_EDIT] ✅ Product updated successfully');

      return res.status(200).json({
        product: updatedProduct,
        regraded: ingredientsChanged
      });
    }

    // ========== DELETE: Remove product from database ==========
    if (req.method === 'DELETE') {
      console.log('[PRODUCT_DELETE] Deleting product:', {
        id: productId,
        userId: user.id
      });

      const success = await deleteProduct(supabase, user.id, productId);

      if (!success) {
        console.error('[PRODUCT_DELETE] ❌ Deletion failed');
        return res.status(500).json({ error: 'Failed to delete product' });
      }

      console.log('[PRODUCT_DELETE] ✅ Product deleted successfully');

      return res.status(200).json({ success: true });
    }

    // Unsupported method
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error: any) {
    console.error('[PRODUCT_API] ❌ Error:', error.message);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
