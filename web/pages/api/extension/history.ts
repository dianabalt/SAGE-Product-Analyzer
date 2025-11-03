// web/pages/api/extension/history.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServer } from '../../../lib/supabaseServer';

type Alternative = {
  id: string;
  alternative_title: string;
  alternative_url: string;
  alternative_ingredients: string | null;
  alternative_grade: string;
  alternative_score: number;
  beneficial_ingredients: string[] | null;
  harmful_ingredients: string[] | null;
  category: string | null;
};

type ProductRow = {
  id: string;
  product_title: string | null;
  product_url: string;
  grade: string | null;
  numeric_grade: number | null;
  beneficial_ingredients: string[] | null;
  issues: string[] | null;
  sources: string[] | null;
  ingredients: string | null;
  created_at: string;
  analysis: any;
  product_alternatives?: Alternative[];
  alternatives_count?: number;
  has_alternatives?: boolean;
};

type HistoryResponse = {
  products: ProductRow[];
} | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<HistoryResponse>) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    console.log('[EXTENSION_HISTORY] Request received');

    const supabase = getSupabaseServer(req, res);

    // Auth check - support both cookie auth (web) and Bearer token (extension)
    let user = null;

    // First try cookie-based auth (for web app)
    const cookieAuth = await supabase.auth.getUser();
    if (cookieAuth.data.user) {
      user = cookieAuth.data.user;
      console.log('[EXTENSION_HISTORY] Authenticated via cookies');
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
          console.log('[EXTENSION_HISTORY] Authenticated via Bearer token');
        } else {
          console.error('[EXTENSION_HISTORY] Bearer token invalid:', error?.message);
        }
      }
    }

    if (!user) {
      console.error('[EXTENSION_HISTORY] No user found - not authenticated');
      return res.status(401).json({ error: 'Not logged in' });
    }

    console.log('[EXTENSION_HISTORY] Fetching products for user:', user.id);

    // Query products with their alternatives (LEFT JOIN)
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        product_alternatives!source_product_id (
          id,
          alternative_title,
          alternative_url,
          alternative_ingredients,
          alternative_grade,
          alternative_score,
          beneficial_ingredients,
          harmful_ingredients,
          category
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[EXTENSION_HISTORY] Database error:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      return res.status(500).json({ error: error.message });
    }

    console.log('[EXTENSION_HISTORY] ✅ Successfully fetched', data?.length || 0, 'products');

    // Add alternatives count and has_alternatives flags
    const productsWithAlternatives = (data || []).map(p => ({
      ...p,
      alternatives_count: Array.isArray(p.product_alternatives) ? p.product_alternatives.length : 0,
      has_alternatives: Array.isArray(p.product_alternatives) && p.product_alternatives.length > 0
    }));

    console.log('[EXTENSION_HISTORY] Products with alternatives:',
      productsWithAlternatives.filter(p => p.has_alternatives).length
    );

    return res.status(200).json({
      products: productsWithAlternatives
    });

  } catch (e: any) {
    console.error('[EXTENSION_HISTORY] Unexpected error:', e?.message, e?.stack);
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}
