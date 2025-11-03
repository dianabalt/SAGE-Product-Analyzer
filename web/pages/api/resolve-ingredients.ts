// web/pages/api/resolve-ingredients.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { extractBestIngredientsFromHtml, processModelIngredients } from '../../lib/ingredientExtract';
import { extractBestProductNameFromHtml, deriveNameFromUrl } from '../../lib/productName';
import { looksLikeIngredients, looksLikeFoodIngredients, stripMarketingCopy, cleanIngredientsHeading } from '../../lib/looksLikeIngredients';
import { isBotProtectionPage, isBotProtectionName } from '../../lib/detectBotProtection';
import { flags } from '../../lib/flags';
import { identityScore, type ProductIdentity } from '../../lib/identity';
import { parseJsonLdIdentity } from '../../lib/jsonld';
import { classifyProductType } from '../../lib/productClassifier';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const t0 = Date.now();
  try {
    const { product_url } = req.body || {};
    if (!product_url) return res.status(400).json({ error: 'product_url required' });

    const host = new URL(product_url).hostname.replace(/^www\./,'');
    console.log('[A:resolve] start', { host, product_url });

    // Attempt DOM scrape for all domains (including Walmart)
    const html = await fetch(product_url, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }).then(r => r.text());

    // Check for bot protection before parsing
    if (isBotProtectionPage(html)) {
      const urlDerivedName = deriveNameFromUrl(product_url);
      console.log('[A:resolve] bot-protection-detected', {
        host,
        ms: Date.now() - t0,
        urlDerivedName
      });
      return res.status(200).json({
        ingredients: null,
        productName: urlDerivedName,
        source: 'bot-protection-fallback',
        sourceUrl: product_url,
        debugPreview: 'Bot protection detected'
      });
    }

    const { text, where } = extractBestIngredientsFromHtml(html, product_url);
    // Prioritize URL-derived names (cleaner) over HTML title (often has retailer suffixes)
    let productName =
      deriveNameFromUrl(product_url) || extractBestProductNameFromHtml(html) || null;

    // Filter out bot protection names
    if (isBotProtectionName(productName)) {
      console.log('[A:resolve] bot-protection-name-detected', { productName });
      productName = deriveNameFromUrl(product_url) || null;
    }

    // ========== GPT PRODUCT CLASSIFICATION ==========
    let productType: 'FOOD' | 'COSMETIC' = 'COSMETIC'; // Default to cosmetic
    let productSubtype: string | null = null;

    if (productName && productName.length >= 3) {
      try {
        const classification = await classifyProductType(productName);
        productType = classification.type;
        productSubtype = classification.subtype;

        console.log('[A:resolve] 🤖 GPT Classification:', {
          type: productType,
          subtype: productSubtype,
          confidence: classification.confidence,
          reasoning: classification.reasoning
        });
      } catch (classifyError: any) {
        console.error('[A:resolve] GPT classification failed:', classifyError?.message);
        // Continue with default (COSMETIC)
      }
    }

    // ========== Phase A: Identity Scoring (Shadow Mode) ==========
    if (flags.identityGate) {
      console.log('[A:resolve] Phase A: Identity scoring enabled (shadow mode)');

      // Extract identity from request body (if provided by client)
      const wantIdentity: Partial<ProductIdentity> = {
        brand: req.body.brand || '',
        name: req.body.product_name || productName || '',
        size: req.body.size || null,
        form: req.body.form || null,
        scentShade: req.body.scentShade || req.body.scent || null,
        gtin: req.body.gtin || null,
      };

      // Build page signals from HTML
      const cheerio = await import('cheerio');
      const $ = cheerio.load(html);
      const pageSignals = {
        title: $('title').text() || $('meta[property="og:title"]').attr('content') || '',
        h1: $('h1').first().text() || '',
        breadcrumbs: $('[itemtype*="BreadcrumbList"] a, .breadcrumbs a').map((_, el) => $(el).text()).get(),
        urlHost: host
      };

      // Extract identity from HTML (JSON-LD)
      const pageIdentity = parseJsonLdIdentity(html);

      // Calculate identity score - note: function signature is (pageSignals, jsonldId, want)
      const score = identityScore(pageSignals, pageIdentity, wantIdentity as any);

      console.log('[A:resolve] Identity score:', {
        score: score.score,
        threshold: flags.identityThreshold,
        passed: score.passed,
        breakdown: score.breakdown,
        reason: score.reason
      });

      // In shadow mode, we log but don't block
      if (flags.enforceGate && !score.passed) {
        console.log('[A:resolve] ⚠️ Would BLOCK (enforcement enabled): identity score too low');
        // In Phase B, we would return error here
        // return res.status(400).json({ error: 'Product identity mismatch' });
      } else if (!score.passed) {
        console.log('[A:resolve] ℹ️ Shadow: identity score below threshold (but not blocking)');
      } else {
        console.log('[A:resolve] ✅ Identity score passed');
      }
    }

    let ingredients: string | null = null;
    let preview: string | null = null;
    let source: string | null = null;

    if (text) {
      // First remove headings/footers with rule-based cleaning (100% reliable, no hallucinations)
      const withoutHeading = cleanIngredientsHeading(text);

      // Apply processModelIngredients to ensure consistent filtering and deduplication
      const processed = processModelIngredients(withoutHeading);

      // Type-aware validation (same as extension and research-ingredients)
      const isFoodProduct = productType === 'FOOD';

      if (isFoodProduct) {
        // FOOD/SUPPLEMENT: Use relaxed food validator (no stripMarketingCopy)
        if (looksLikeFoodIngredients(processed)) {
          ingredients = processed;
          preview = ingredients.replace(/\s+/g, ' ').slice(0, 300);
          source = `dom-generic:${where || 'unknown'}`;
          console.log('[A:resolve] ✅ Passed food validation', {
            ingredientCount: ingredients.split(',').length,
            preview: preview
          });
        } else {
          preview = (processed || '').replace(/\s+/g, ' ').slice(0, 150);
          ingredients = null;
          source = null;
          console.log('[A:resolve] ⚠️ Failed food validation');
        }
      } else {
        // COSMETIC/BEAUTY: Use strict INCI validator
        const cleaned = stripMarketingCopy(processed);

        if (cleaned && looksLikeIngredients(cleaned)) {
          ingredients = cleaned;
          preview = ingredients.replace(/\s+/g, ' ').slice(0, 300);
          source = `dom-generic:${where || 'unknown'}`;
          console.log('[A:resolve] ✅ Passed INCI validation', {
            ingredientCount: ingredients.split(',').length,
            preview: preview
          });
        } else {
          preview = (text || '').replace(/\s+/g, ' ').slice(0, 150);
          ingredients = null;
          source = null;
          console.log('[A:resolve] ⚠️ Failed INCI validation (marketing copy or invalid format)');
        }
      }
    } else {
      preview = null;
      ingredients = null;
      source = null;
    }

    console.log('[A:resolve] done', {
      host,
      ms: Date.now() - t0,
      found: !!ingredients,
      where: ingredients ? where : null,
      productName,
      len: (ingredients || '').length,
      preview: preview || ''
    });

    return res.status(200).json({
      ingredients,
      productName,
      productType,        // GPT classification for extraction pipeline
      productSubtype,     // GPT subtype for user display
      source,
      sourceUrl: product_url,
      debugPreview: preview
    });
  } catch (e: any) {
    console.log('[A:resolve] error', { ms: Date.now() - t0, error: e?.message });

    // Bot protection fallback: try to derive product name from URL
    const { product_url } = req.body || {};
    let fallbackName: string | null = null;
    if (product_url) {
      try {
        fallbackName = deriveNameFromUrl(product_url);
        console.log('[A:resolve] bot-protection-fallback', { fallbackName });
      } catch {}
    }

    return res.status(200).json({
      ingredients: null,
      productName: fallbackName,
      source: null,
      sourceUrl: product_url || null,
      error: e?.message
    });
  }
}