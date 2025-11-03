// web/lib/jsonld.ts
/**
 * JSON-LD Structured Data Extraction for SAGE v2
 *
 * Extracts product information from <script type="application/ld+json"> nodes.
 * Used as a candidate source for ingredient lists (not gospel truth).
 *
 * Key features:
 * - Parse all JSON-LD nodes from HTML
 * - Find Product nodes (@type: "Product")
 * - Extract: ingredients, brand, name, GTIN, SKU
 * - Sanity check: flag when JSON-LD contradicts visible page signals
 *
 * Warnings:
 * - "jsonld_mismatch": JSON-LD contradicts H1/title (marketplace staleness)
 * - Marketplace JSON-LD is less trustworthy (Amazon, eBay, Walmart)
 *
 * Phase A: Extract as candidate, log mismatches (shadow mode)
 * Phase C: Use in reconciliation engine with weighted trust
 */

import * as cheerio from 'cheerio';
import type { ProductIdentity } from './identity';

// ============ Types ============

export type JsonLdProduct = {
  ingredients?: string | null;
  identity?: Partial<ProductIdentity>;
  warnings: string[];
};

// ============ Parsing ============

/**
 * Parse all JSON-LD nodes from HTML
 * Handles: single nodes, @graph arrays, nested structures
 */
export function parseJsonLd(html: string): any[] {
  try {
    const $ = cheerio.load(html);
    const nodes: any[] = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const text = $(el).html() || '{}';
        const json = JSON.parse(text);
        nodes.push(json);
      } catch (parseError) {
        // Skip invalid JSON (common on malformed pages)
        console.log('[jsonld] Failed to parse JSON-LD node:', parseError);
      }
    });

    return nodes;
  } catch (error) {
    console.error('[jsonld] Error loading HTML:', error);
    return [];
  }
}

/**
 * Find Product node with @type: "Product"
 * Searches: top-level nodes, @graph arrays
 */
export function pickProductNode(nodes: any[]): any | null {
  for (const node of nodes) {
    // Direct match
    if (node['@type'] === 'Product') {
      return node;
    }

    // Check @graph array (common pattern)
    if (node['@graph'] && Array.isArray(node['@graph'])) {
      for (const subNode of node['@graph']) {
        if (subNode['@type'] === 'Product') {
          return subNode;
        }
      }
    }

    // Check array at top level
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item['@type'] === 'Product') {
          return item;
        }
      }
    }
  }

  return null;
}

/**
 * Extract product identity from JSON-LD Product node
 * Fields: brand, name, gtin, sku
 */
export function parseJsonLdIdentity(html: string): Partial<ProductIdentity> {
  const nodes = parseJsonLd(html);
  const product = pickProductNode(nodes);

  if (!product) return {};

  // Handle brand as object or string
  let brandName: string | null = null;
  if (typeof product.brand === 'object' && product.brand?.name) {
    brandName = product.brand.name;
  } else if (typeof product.brand === 'string') {
    brandName = product.brand;
  }

  return {
    brand: brandName || '',
    name: product.name || '',
    gtin: product.gtin || product.gtin13 || product.gtin14 || product.gtin12 || product.gtin8 || null,
    sku: product.sku || product.mpn || null,
    // Note: size, form, scent not typically in JSON-LD (extract from name/description in Phase C)
    size: null,
    sizeUnit: null,
    form: null,
    scentShade: null,
    region: null
  };
}

/**
 * Sanity check: Does JSON-LD contradict visible page signals?
 *
 * Checks:
 * 1. Marketplace staleness: Amazon/eBay/Walmart JSON-LD often stale
 * 2. Brand mismatch: JSON-LD brand ≠ H1/title brand
 * 3. Name mismatch: JSON-LD name has <40% token overlap with title
 *
 * Returns: { warnings: ['jsonld_mismatch', ...] }
 */
export function sanityCheckJsonLd(
  jsonldIngredients: string | null,
  jsonldIdentity: Partial<ProductIdentity>,
  pageSignals: { title: string; h1: string; urlHost: string }
): { warnings: string[] } {
  const warnings: string[] = [];

  if (!jsonldIngredients && !jsonldIdentity.brand) {
    // No JSON-LD data to validate
    return { warnings };
  }

  const isMarketplace = /amazon\.|ebay\.|walmart\.|target\./i.test(pageSignals.urlHost);

  // Warning 1: Marketplace JSON-LD with ingredients (often stale/wrong)
  if (isMarketplace && jsonldIngredients && jsonldIngredients.length > 100) {
    warnings.push('jsonld_mismatch');
    console.log('[jsonld] Warning: Marketplace JSON-LD may be stale');
  }

  // Warning 2: Brand mismatch between JSON-LD and visible page
  if (jsonldIdentity.brand) {
    const visibleText = (pageSignals.title + ' ' + pageSignals.h1).toLowerCase();
    const jsonBrand = jsonldIdentity.brand.toLowerCase();

    if (!visibleText.includes(jsonBrand) && jsonBrand.length > 3) {
      warnings.push('jsonld_mismatch');
      console.log('[jsonld] Warning: Brand mismatch (JSON-LD vs visible)', {
        jsonldBrand: jsonldIdentity.brand,
        visibleText: visibleText.slice(0, 100)
      });
    }
  }

  // Warning 3: Name token overlap too low
  if (jsonldIdentity.name && pageSignals.title) {
    const jsonTokens = jsonldIdentity.name.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    const titleTokens = pageSignals.title.toLowerCase().split(/\s+/);

    const overlap = jsonTokens.filter(tok => titleTokens.some(t => t.includes(tok))).length;
    const overlapRatio = jsonTokens.length > 0 ? overlap / jsonTokens.length : 0;

    if (overlapRatio < 0.4 && jsonTokens.length >= 3) {
      warnings.push('jsonld_mismatch');
      console.log('[jsonld] Warning: Low name token overlap', {
        jsonldName: jsonldIdentity.name,
        pageTitle: pageSignals.title.slice(0, 100),
        overlapRatio
      });
    }
  }

  return { warnings };
}

/**
 * Extract full product data from HTML via JSON-LD
 *
 * Returns:
 * - ingredients: string from JSON-LD (if present)
 * - identity: Partial<ProductIdentity> (brand, name, gtin, sku)
 * - warnings: ['jsonld_mismatch'] if sanity checks fail
 *
 * Phase A: Used as candidate source, logged in shadow mode
 * Phase C: Used in reconciliation with trust weights
 */
export function extractJsonLdProduct(
  html: string,
  pageSignals: { title: string; h1: string; urlHost: string }
): JsonLdProduct {
  const nodes = parseJsonLd(html);

  if (nodes.length === 0) {
    return { warnings: [] };
  }

  const product = pickProductNode(nodes);

  if (!product) {
    return { warnings: [] };
  }

  // Extract ingredients (various field names)
  let ingredients: string | null = null;
  if (product.ingredients) {
    // Handle string or array
    if (typeof product.ingredients === 'string') {
      ingredients = product.ingredients;
    } else if (Array.isArray(product.ingredients)) {
      ingredients = product.ingredients.join(', ');
    }
  }

  // Fallback fields
  if (!ingredients && product.activeIngredient) {
    if (typeof product.activeIngredient === 'string') {
      ingredients = product.activeIngredient;
    } else if (Array.isArray(product.activeIngredient)) {
      ingredients = product.activeIngredient.map((ing: any) => ing.name || ing).join(', ');
    }
  }

  if (!ingredients && product.additionalProperty) {
    // Some sites use additionalProperty for ingredients
    const props = Array.isArray(product.additionalProperty) ? product.additionalProperty : [product.additionalProperty];
    for (const prop of props) {
      if (prop?.name?.toLowerCase().includes('ingredient') && prop.value) {
        ingredients = prop.value;
        break;
      }
    }
  }

  // Extract identity
  const identity = parseJsonLdIdentity(html);

  // Sanity check
  const { warnings } = sanityCheckJsonLd(ingredients, identity, pageSignals);

  console.log('[jsonld] Extracted product', {
    hasIngredients: !!ingredients,
    ingredientsLength: ingredients?.length || 0,
    identity: {
      brand: identity.brand,
      name: identity.name?.slice(0, 50),
      gtin: identity.gtin
    },
    warnings
  });

  return {
    ingredients,
    identity,
    warnings
  };
}
