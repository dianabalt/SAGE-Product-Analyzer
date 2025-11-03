// web/pages/api/research-ingredients.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { extractBestIngredientsFromHtml, processModelIngredients } from '../../lib/ingredientExtract';
import { extractBestProductNameFromHtml, deriveNameFromUrl } from '../../lib/productName';
import { isBotProtectionPage, isBotProtectionName } from '../../lib/detectBotProtection';
import { generateSearchQueries } from '../../lib/simplifyProductName';
import { looksLikeIngredients, looksLikeFoodIngredients, stripMarketingCopy, cleanIngredientsHeading } from '../../lib/looksLikeIngredients';
import { flags } from '../../lib/flags';
import { identityScore, type ProductIdentity } from '../../lib/identity';
import { parseJsonLdIdentity } from '../../lib/jsonld';
import { classifyProductType, validateProductMatchGPT, type ProductType } from '../../lib/productClassifier';
import { validateProductMatch } from '../../lib/productValidator';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

async function tavilySearch(query: string, max = 8, include?: string[] | null, exclude?: string[] | null) {
  const key = process.env.SEARCH_API_KEY || '';
  if (!key) {
    console.log('[B:research] tavily-no-api-key');
    return [];
  }

  const body: any = {
    query,
    search_depth: 'advanced',
    max_results: Math.min(max, 10),
    include_answer: false,
    include_images: false,
    include_domains: include ?? null,
    exclude_domains: exclude ?? null,
    days: 3650
  };

  console.log('[B:research] tavily-request', {
    query,
    max,
    includeDomains: include?.length || 0,
    excludeDomains: exclude?.length || 0
  });

  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      console.log('[B:research] tavily-error', {
        status: r.status,
        statusText: r.statusText
      });
      return [];
    }

    const j = await r.json();
    const urls = j?.results?.map((x: any) => x.url).filter(Boolean) ?? [];

    console.log('[B:research] tavily-response', {
      resultsCount: urls.length,
      hasError: !!j?.error,
      error: j?.error || null
    });

    return urls;
  } catch (e: any) {
    console.log('[B:research] tavily-fetch-failed', { error: e?.message });
    return [];
  }
}

function isAuthoritative(u: string) {
  const host = new URL(u).hostname.replace(/^www\./,'');
  return /(dailymed\.nlm\.nih\.gov|fda\.gov|nih\.gov|medlineplus\.gov|incidecoder|skinsort|openfoodfacts|clinique|sephora|ulta|boots|target|walgreens|cvs|riteaid|cosdna|skinsafeproducts|skincarisma|beautypedia|ewg|paulaschoice|theordinary|cerave|neutrogena|dermstore|drugs\.com|webmd|healthline|rxlist|mayoclinic|examine|labdoor|consumerlab|uspharmacist)\./i
    .test(host);
}

function dedupeList(raw: string) {
  const s = raw.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');
  const parts = s.split(/[;,]/).map(x => x.trim()).filter(Boolean);
  const seen = new Set<string>(); const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (!seen.has(k)) { out.push(p); seen.add(k); }
  }
  return out.join(', ');
}

/**
 * Strip specific junk phrases from ingredient list (used for refinement)
 */
function stripJunkPhrases(text: string, junkPhrases: string[]): string {
  let cleaned = text;

  for (const junk of junkPhrases) {
    // Case-insensitive removal
    const regex = new RegExp(junk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    cleaned = cleaned.replace(regex, '');
  }

  // Clean up artifacts (double commas, spaces, etc.)
  cleaned = cleaned
    .replace(/,\s*,+/g, ',') // Remove double commas
    .replace(/^\s*,+\s*/g, '') // Remove leading commas
    .replace(/\s*,+\s*$/g, '') // Remove trailing commas
    .replace(/\s{2,}/g, ' ') // Collapse whitespace
    .trim();

  return cleaned;
}

function nameTokens(name: string) {
  return name.toLowerCase().split(/\s+/).filter(w => w.length >= 3 && !['the','and','for','with','from'].includes(w));
}

/**
 * Check if a URL is from a highly authoritative source that should get lenient name matching
 * (INCIdecoder, Skinsort, OpenFoodFacts, brand websites)
 */
function isHighlyAuthoritativeSource(url: string): boolean {
  const host = new URL(url).hostname.replace(/^www\./, '');

  // Highly trusted ingredient databases
  if (/^(incidecoder|skinsort|openfoodfacts)\./.test(host)) return true;

  // Brand websites (domain matches a common brand name)
  const brandDomains = [
    'cerave.com', 'neutrogena.com', 'eltamd.com', 'supergoop.com',
    'theordinary.com', 'paulaschoice.com', 'dermstore.com',
    'clinique.com', 'boots.com', 'aveenocare.com', 'aveeno.com',
    'bluelizardsunscreen.com', 'badgerbalm.com', 'orgain.com',
    'naturemc.com', 'vitafusion.com', 'gardenoflife.com', 'quest.com'
  ];

  return brandDomains.some(brand => host.includes(brand));
}

/**
 * Validate if source product matches our intended product
 *
 * Uses two-tier validation:
 * 1. Exact URL match check (instant, 100% confidence if URLs match)
 * 2. Coded validator first (fast, free, confidence 0-100)
 * 3. GPT validator fallback if coded confidence < 75% (slow, $0.0003, higher accuracy)
 *
 * Only accepts matches with final confidence ≥ 80%
 *
 * @param html - HTML of source page
 * @param ourProductName - Product we're searching for
 * @param url - URL of source page (found by research)
 * @param sourceProductUrl - URL of the product being scanned (optional)
 * @param productType - Type of product (FOOD or COSMETIC) for supplement-aware validation
 * @returns true if source product matches (confidence ≥ 80%), false otherwise
 */
async function validateProductIdentity(html: string, ourProductName: string, url: string, sourceProductUrl?: string, productType?: 'FOOD' | 'COSMETIC'): Promise<boolean> {
  // CRITICAL FIX: If research found the EXACT SAME URL we're scanning, it's 100% match
  if (sourceProductUrl) {
    const normalizeUrl = (u: string) => {
      try {
        const parsed = new URL(u);
        // Remove query params and fragments, lowercase host+path
        return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}`.toLowerCase();
      } catch {
        return u.toLowerCase();
      }
    };

    const normalizedSource = normalizeUrl(sourceProductUrl);
    const normalizedFound = normalizeUrl(url);

    if (normalizedSource === normalizedFound) {
      console.log('[B:research] ✅ EXACT URL MATCH - auto-accepting (100% confidence)');
      console.log('[B:research] Source:', normalizedSource);
      console.log('[B:research] Found:', normalizedFound);
      return true; // Same URL = same product, no need for AI validation
    }
  }

  // Extract product name from source page
  const sourceProductName = extractBestProductNameFromHtml(html) || deriveNameFromUrl(url);

  if (!sourceProductName) {
    console.log('[B:research] ⚠️ Could not extract product name from source page');
    return false;
  }

  console.log('[B:research] 🔍 Validating:', {
    our: ourProductName,
    source: sourceProductName
  });

  // Step 1: Try coded validator first (fast, free)
  const codedResult = validateProductMatch(ourProductName, sourceProductName, url);

  console.log('[B:research] 📊 Coded validator:', {
    confidence: codedResult.confidence,
    isMatch: codedResult.isMatch,
    details: codedResult.details,
    reasons: codedResult.reasons
  });

  // If coded validator has high confidence (≥75%), use its result
  if (codedResult.confidence >= 75) {
    const accepted = codedResult.isMatch; // isMatch is true when confidence ≥ 80
    console.log(`[B:research] ${accepted ? '✅' : '❌'} Coded validator decision (high confidence): ${accepted}`);
    return accepted;
  }

  // Step 2: Coded validator has low confidence - use GPT fallback
  console.log('[B:research] ⚠️ Coded validator confidence < 75%, using GPT fallback...');

  try {
    const gptResult = await validateProductMatchGPT(ourProductName, sourceProductName, url, productType);

    console.log('[B:research] 🤖 GPT validator:', {
      isSameProduct: gptResult.isSameProduct,
      confidence: gptResult.confidence,
      reasoning: gptResult.reasoning
    });

    // Variable thresholds based on source authority
    // More lenient for highly trusted sources (INCIdecoder, Skinsort, OpenFoodFacts)
    const hostname = new URL(url).hostname.replace(/^www\./, '');

    const HIGHLY_AUTHORITATIVE = [
      'incidecoder.com', 'skinsort.com', 'openfoodfacts.org',
      'dailymed.nlm.nih.gov', 'fda.gov', 'nih.gov'
    ];

    const AUTHORITATIVE = [
      'walmart.com', 'target.com', 'amazon.com',
      'sephora.com', 'ulta.com', 'dermstore.com'
    ];

    let gptThreshold = 80; // Default for generic sources

    if (HIGHLY_AUTHORITATIVE.some(src => hostname.includes(src))) {
      gptThreshold = 70; // Lower bar for highly trusted sources
    } else if (AUTHORITATIVE.some(src => hostname.includes(src))) {
      gptThreshold = 75; // Medium bar for good sources
    }

    // Accept if GPT says it's the same product AND confidence ≥ threshold
    const accepted = gptResult.isSameProduct && gptResult.confidence >= gptThreshold;

    console.log(`[B:research] ${accepted ? '✅' : '❌'} GPT validator decision: ${accepted} (threshold: ${gptThreshold}%, source: ${hostname})`);

    return accepted;

  } catch (error: any) {
    console.error('[B:research] ❌ GPT validation failed:', error.message);

    // GPT failed - fall back to coded validator result with lower threshold
    // Accept if coded confidence ≥ 70 (slightly more lenient when GPT unavailable)
    const accepted = codedResult.confidence >= 70;

    console.log(`[B:research] ${accepted ? '✅' : '❌'} Fallback decision (coded ≥70%): ${accepted}`);

    return accepted;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const t0 = Date.now();
  try {
    console.log('[B:research] start');
    const { product_url, product_title } = req.body || {};

    // Best product name
    let name = (product_title || '').trim();

    // Filter out bot protection names from incoming product_title
    if (isBotProtectionName(name)) {
      console.log('[B:research] bot-protection-name-in-title', { name });
      name = '';
    }

    if (!name || /^test\s/i.test(name) || name.length < 5 || /^(amazon|walmart)(\.com)?$/i.test(name)) {
      if (product_url) {
        try {
          // Try URL-based name extraction first (works even with bot protection)
          const urlDerivedName = deriveNameFromUrl(product_url);
          if (urlDerivedName) {
            name = urlDerivedName;
            console.log('[B:research] derivedNameFromUrl', { name });
          } else {
            // Only fetch HTML if URL parsing didn't yield a name
            const html0 = await fetch(product_url, {
              headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }
            }).then(r => r.text());

            // Check for bot protection
            if (isBotProtectionPage(html0)) {
              console.log('[B:research] bot-protection-detected-in-fetch');
              name = deriveNameFromUrl(product_url) || '';
            } else {
              const extractedName = extractBestProductNameFromHtml(html0);
              // Validate extracted name isn't bot protection
              if (extractedName && !isBotProtectionName(extractedName)) {
                name = extractedName;
                console.log('[B:research] derivedNameFromHtml', { name });
              } else {
                name = deriveNameFromUrl(product_url) || '';
                console.log('[B:research] fallback-to-url-parsing', { name });
              }
            }
          }
        } catch (e: any) {
          // Fetch failed (likely bot protection); try URL parsing as last resort
          if (!name) {
            try {
              name = deriveNameFromUrl(product_url) || '';
              console.log('[B:research] bot-protection-fallback', { name, error: e?.message });
            } catch {}
          }
        }
      }
    }
    if (!name) {
      console.log('[B:research] no-name');
      return res.status(200).json({ ingredients: null, sources: [], confidence: 0, detectedName: null });
    }

    console.log('[B:research] query', { name });

    // Generate multiple search query variations
    const searchQueries = generateSearchQueries(name);
    console.log('[B:research] search-queries', { count: searchQueries.length, queries: searchQueries });

    // ========== GPT PRODUCT CLASSIFICATION ==========
    let productType: ProductType;
    let productSubtype: 'COSMETIC' | 'SKINCARE' | 'HEALTH_SUPPLEMENT' | 'FOOD' | 'BEAUTY' | null = null;
    let classificationConfidence: number;
    let classificationReasoning: string;

    // Check if caller provided product type (could be from user selection OR GPT classification from extension)
    const providedType = req.body.product_type as ProductType | undefined;

    if (providedType) {
      console.log('[B:research] 📥 Received product_type from caller:', providedType);
      productType = providedType;
      classificationConfidence = 100;
      classificationReasoning = 'Product type provided by caller';
      // Note: Caller may be extension (with GPT classification) or user (manual selection)
    } else {
      // Use GPT classification
      const classification = await classifyProductType(name);
      productType = classification.type;
      productSubtype = classification.subtype;
      classificationConfidence = classification.confidence;
      classificationReasoning = classification.reasoning;

      console.log('[B:research] 🤖 GPT Classification:', {
        type: productType,
        subtype: productSubtype,
        confidence: classificationConfidence,
        reasoning: classificationReasoning
      });

      // If confidence too low, request user input
      if (classificationConfidence < 80) {
        console.log('[B:research] ⚠️ Low confidence - requesting user confirmation');
        return res.status(200).json({
          needsUserInput: true,
          productName: name,
          suggestedType: productType,
          suggestedSubtype: productSubtype,
          confidence: classificationConfidence,
          reasoning: classificationReasoning,
          ingredients: null,
          sources: [],
          detectedName: name
        });
      }
    }

    const isFoodProduct = productType === 'FOOD';

    if (isFoodProduct) {
      console.log('[B:research] 🍎 FOOD - using OpenFoodFacts pipeline');

      // Add food/supplement-specific queries to the existing list
      searchQueries.push(
        `${name} ingredients openfoodfacts`,
        `${name} nutrition facts ingredients`,
        `${name} supplement facts`
      );

      console.log('[B:research] Food/supplement queries added, total queries:', searchQueries.length);
    } else {
      console.log('[B:research] 💄 COSMETIC - using INCI pipeline');
    }

    // Authoritative domains - prioritized by product type
    const preferred = isFoodProduct ? [
      // === FOOD/SUPPLEMENT SOURCES (Priority Order) ===
      // TIER 1 - FDA/Government
      'fda.gov', 'nih.gov', 'dailymed.nlm.nih.gov',
      // TIER 2 - Specialized food/supplement databases
      'world.openfoodfacts.org', 'openfoodfacts.org',
      'examine.com', 'labdoor.com', 'consumerlab.com',
      // TIER 3 - Retail with nutrition info
      'amazon.com', 'target.com', 'walmart.com', 'gnc.com', 'bodybuilding.com',
      'iherb.com', 'vitaminshoppe.com'
    ] : [
      // === COSMETIC/BEAUTY SOURCES (Priority Order) ===
      // TIER 1 - Specialized cosmetic databases
      'incidecoder.com', 'skinsort.com', 'skincarisma.com',
      'ewg.org', 'cosdna.com',
      // TIER 2 - Beauty retail with INCI lists
      'sephora.com', 'ulta.com', 'dermstore.com', 'boots.com',
      'clinique.com', 'theordinary.com', 'cerave.com', 'neutrogena.com',
      'paulaschoice.com', 'beautypedia.com', 'skinsafeproducts.com',
      // TIER 3 - General retail
      'target.com', 'cvs.com', 'walgreens.com', 'riteaid.com',
      'amazon.com'
    ];

    console.log('[B:research] Using', preferred.length, 'preferred domains for', isFoodProduct ? 'FOOD/SUPPLEMENT' : 'COSMETIC');

    const exclude = ['ebay.com', 'aliexpress.com'];

    let urls: string[] = [];
    let usedQuery = '';

    // Progressive search strategy
    for (let i = 0; i < searchQueries.length; i++) {
      const query = searchQueries[i];

      // First 3 queries: use preferred domains
      // Last queries: open search without domain restrictions
      const useDomainFilter = i < 3;

      console.log(`[B:research] attempt-${i + 1}`, {
        query,
        withDomainFilter: useDomainFilter
      });

      urls = await tavilySearch(
        query,
        8, // Increased from 5 to 8 to improve chances of finding OpenFoodFacts
        useDomainFilter ? preferred : null,
        exclude
      );

      if (urls.length > 0) {
        usedQuery = query;
        console.log(`[B:research] success-attempt-${i + 1}`, { count: urls.length });
        break;
      }

      console.log(`[B:research] no-results-attempt-${i + 1}`);
    }

    console.log('[B:research] final-urls', { count: urls.length, usedQuery, urls: urls.slice(0, 5) });

    // Debug: Log URL domains to check if OpenFoodFacts is in results
    console.log('[B:research] URL domains:', urls.map(u => {
      try {
        return new URL(u).hostname;
      } catch {
        return 'invalid-url';
      }
    }));

    // Debug: Check if OpenFoodFacts is in the results
    const hasOpenFoodFacts = urls.some(u => /openfoodfacts\.org/i.test(u));
    console.log('[B:research] OpenFoodFacts in results?', hasOpenFoodFacts);

    if (!urls.length) {
      return res.status(200).json({ ingredients: null, sources: [], confidence: 0, detectedName: name });
    }

    // Filter Skinsort URLs: ONLY accept /products/ pages (not /compare/, /brands/, etc.)
    const urlsBeforeFilter = urls.length;
    urls = urls.filter((u: string) => {
      // If it's a Skinsort URL, only keep /products/ pages
      if (/skinsort\.com/i.test(u)) {
        return /skinsort\.com\/products\//i.test(u);
      }
      // Keep all non-Skinsort URLs
      return true;
    });

    if (urls.length < urlsBeforeFilter) {
      console.log('[B:research] filtered-skinsort-urls', {
        before: urlsBeforeFilter,
        after: urls.length,
        removed: urlsBeforeFilter - urls.length
      });
    }

    const candidates: Array<{ url: string; text: string; authoritative: boolean; isGovSource: boolean; isDailyMed: boolean }> = [];

    // Parallel URL fetching for better performance
    const fetchPromises = urls.map(async (u) => {
      try {
        const host = new URL(u).hostname.replace(/^www\./,'');
        const isDailyMed = /dailymed\.nlm\.nih\.gov/i.test(host);
        const isFDA = /fda\.gov/i.test(host);
        const isGovSource = isDailyMed || isFDA || /nih\.gov|medlineplus\.gov/i.test(host);

        const html = await fetch(u, {
          headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }
        }).then(r => r.text());

        // ========== Phase A: Identity Scoring (Shadow Mode) ==========
        if (flags.identityGate) {
          const wantIdentity: Partial<ProductIdentity> = {
            brand: req.body.brand || '',
            name: name || '',
            size: req.body.size || null,
            form: req.body.form || null,
            scentShade: req.body.scentShade || req.body.scent || null,
            gtin: req.body.gtin || null,
          };

          // Build page signals
          const cheerio = await import('cheerio');
          const $ = cheerio.load(html);
          const pageSignals = {
            title: $('title').text() || $('meta[property="og:title"]').attr('content') || '',
            h1: $('h1').first().text() || '',
            breadcrumbs: $('[itemtype*="BreadcrumbList"] a, .breadcrumbs a').map((_, el) => $(el).text()).get(),
            urlHost: host
          };

          const pageIdentity = parseJsonLdIdentity(html);
          const score = identityScore(pageSignals, pageIdentity, wantIdentity as any);

          console.log('[B:research] Identity score for', host, ':', {
            score: score.score,
            passed: score.passed,
            breakdown: score.breakdown
          });

          if (flags.enforceGate && !score.passed) {
            console.log('[B:research] ⚠️ Would SKIP candidate (enforcement enabled): identity score too low');
            // In Phase B, we would skip this candidate
            // return null;
          }
        }

        // Validate product identity using coded validator + GPT fallback
        // Only accepts matches with confidence ≥ 80%
        const isValidMatch = await validateProductIdentity(html, name, u, product_url, productType);
        if (!isValidMatch) {
          console.log('[B:research] ❌ Product validation failed - skipping source', { host });
          return null;
        }

        // >>> pass URL so domain-aware rules engage <<<
        // The new extractBestIngredientsFromHtml already applies token-level filtering
        const { text } = extractBestIngredientsFromHtml(html, u);

        // Debug: Log extraction results for each URL
        if (text) {
          console.log('[B:research] ✅ Extracted from', host, '- length:', text.length);
        } else {
          console.log('[B:research] ⚠️ No extraction from', host);
        }

        // Additional validation with type-aware validators
        let cleanedText = text;
        if (cleanedText) {
          // First remove headings/footers (rule-based, 100% reliable)
          const withoutHeading = cleanIngredientsHeading(cleanedText);

          // Apply processModelIngredients to ensure consistent filtering
          const processed = processModelIngredients(withoutHeading);

          // Use different validators based on product type
          if (isFoodProduct) {
            // FOOD/SUPPLEMENT: Use relaxed food validator (no stripMarketingCopy)
            if (looksLikeFoodIngredients(processed)) {
              cleanedText = processed;
              console.log('[B:research] ✅ Passed food/supplement validation', { host, len: cleanedText.length });
            } else {
              console.log('[B:research] ⚠️ Failed food/supplement validation', { host });
              cleanedText = null;
            }
          } else {
            // COSMETIC/BEAUTY: Use strict INCI validator
            const stripped = stripMarketingCopy(processed);
            if (stripped && looksLikeIngredients(stripped)) {
              cleanedText = stripped;
              console.log('[B:research] ✅ Passed INCI validation', { host, len: cleanedText.length });
            } else {
              console.log('[B:research] ⚠️ Failed INCI validation (marketing or invalid)', { host });
              cleanedText = null;
            }
          }
        }

        const len = (cleanedText || '').length;
        console.log('[B:research] candidate', { host, len, authoritative: isAuthoritative(u), isGovSource });

        if (cleanedText && len > 50) {
          return {
            url: u,
            text: cleanedText,
            authoritative: isAuthoritative(u),
            isGovSource,
            isDailyMed
          };
        }
        return null;
      } catch (e: any) {
        console.log('[B:research] candidate-error', { url: u, error: e?.message });
        return null;
      }
    });

    const results = await Promise.all(fetchPromises);

    // Filter out nulls and add to candidates
    for (const result of results) {
      if (result) {
        candidates.push(result);
      }
    }

    // === SKINSORT FALLBACK: If INCIdecoder/preferred sources failed, try Skinsort ===
    // ONLY for cosmetic products (skip for food/supplements)
    if (!candidates.length && !isFoodProduct) {
      console.log('[B:research] No candidates from INCIdecoder, trying Skinsort fallback...');

      // Use include_domains to FORCE Tavily to only return Skinsort URLs
      const skinsortUrlsRaw = await tavilySearch(name, 5, ['skinsort.com'], exclude);

      // Filter: ONLY accept /products/ pages (not /compare/, /brands/, etc.)
      const skinsortUrls = skinsortUrlsRaw.filter((u: string) => /skinsort\.com\/products\//i.test(u));

      console.log('[B:research] skinsort-fallback', {
        rawUrlsFound: skinsortUrlsRaw.length,
        productPagesFound: skinsortUrls.length,
        filtered: skinsortUrlsRaw.length - skinsortUrls.length
      });

      // Process Skinsort URLs same as other candidates
      const skinsortFetchPromises = skinsortUrls.map(async (u: string) => {
        try {
          const host = new URL(u).hostname.replace(/^www\./, '');

          const html = await fetch(u, {
            headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }
          }).then(r => r.text());

          // Validate product identity using coded validator + GPT fallback
          const isValidMatch = await validateProductIdentity(html, name, u, product_url, productType);
          if (!isValidMatch) {
            console.log('[B:research] ❌ Skinsort product validation failed - skipping', { host });
            return null;
          }

          // Extract via DOM (will use extractFromSkinsort() for skinsort.com)
          const { text } = extractBestIngredientsFromHtml(html, u);

          // Apply same validation
          let cleanedText = text;
          if (cleanedText) {
            const withoutHeading = cleanIngredientsHeading(cleanedText);
            const processed = processModelIngredients(withoutHeading);
            const stripped = stripMarketingCopy(processed);

            if (stripped && looksLikeIngredients(stripped)) {
              cleanedText = stripped;
              console.log('[B:research] ✅ Skinsort candidate passed validation', { host, len: cleanedText.length });
            } else {
              console.log('[B:research] ⚠️ Skinsort candidate failed validation', { host });
              cleanedText = null;
            }
          }

          if (cleanedText && cleanedText.length > 50) {
            return {
              url: u,
              text: cleanedText,
              authoritative: true,  // Skinsort is authoritative for skincare
              isGovSource: false,
              isDailyMed: false
            };
          }
          return null;
        } catch (e: any) {
          console.log('[B:research] skinsort-candidate-error', { url: u, error: e?.message });
          return null;
        }
      });

      const skinsortResults = await Promise.all(skinsortFetchPromises);

      // Add valid Skinsort results to candidates
      for (const result of skinsortResults) {
        if (result) {
          candidates.push(result);
          console.log('[B:research] ✅ Added Skinsort candidate:', result.url);
        }
      }
    }

    // === AMAZON FALLBACK: If Skinsort also failed, try Amazon ===
    if (!candidates.length) {
      console.log('[B:research] No candidates from Skinsort, trying Amazon fallback...');

      // Use include_domains to FORCE Tavily to only return Amazon URLs
      const amazonUrls = await tavilySearch(name, 5, ['amazon.com'], exclude);

      console.log('[B:research] amazon-fallback', { urlsFound: amazonUrls.length });

      // Process Amazon URLs same as other candidates
      const amazonFetchPromises = amazonUrls.map(async (u: string) => {
        try {
          const host = new URL(u).hostname.replace(/^www\./, '');

          const html = await fetch(u, {
            headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }
          }).then(r => r.text());

          // Validate product identity using coded validator + GPT fallback
          const isValidMatch = await validateProductIdentity(html, name, u, product_url, productType);
          if (!isValidMatch) {
            console.log('[B:research] ❌ Amazon product validation failed - skipping', { host });
            return null;
          }

          // Extract via DOM (same as other sites)
          const { text } = extractBestIngredientsFromHtml(html, u);

          // Apply type-aware validation (Amazon has both food and cosmetic products)
          let cleanedText = text;
          if (cleanedText) {
            const withoutHeading = cleanIngredientsHeading(cleanedText);
            const processed = processModelIngredients(withoutHeading);

            if (isFoodProduct) {
              // Use food validator
              if (looksLikeFoodIngredients(processed)) {
                cleanedText = processed;
                console.log('[B:research] ✅ Amazon candidate passed food validation', { host, len: cleanedText.length });
              } else {
                console.log('[B:research] ⚠️ Amazon candidate failed food validation', { host });
                cleanedText = null;
              }
            } else {
              // Use cosmetic validator
              const stripped = stripMarketingCopy(processed);
              if (stripped && looksLikeIngredients(stripped)) {
                cleanedText = stripped;
                console.log('[B:research] ✅ Amazon candidate passed INCI validation', { host, len: cleanedText.length });
              } else {
                console.log('[B:research] ⚠️ Amazon candidate failed INCI validation', { host });
                cleanedText = null;
              }
            }
          }

          if (cleanedText && cleanedText.length > 50) {
            return {
              url: u,
              text: cleanedText,
              authoritative: false,  // Amazon is not authoritative
              isGovSource: false,
              isDailyMed: false
            };
          }
          return null;
        } catch (e: any) {
          console.log('[B:research] amazon-candidate-error', { url: u, error: e?.message });
          return null;
        }
      });

      const amazonResults = await Promise.all(amazonFetchPromises);

      // Add valid Amazon results to candidates
      for (const result of amazonResults) {
        if (result) {
          candidates.push(result);
          console.log('[B:research] ✅ Added Amazon candidate:', result.url);
        }
      }
    }

    // === OPENFOODFACTS FALLBACK: Food/supplement products only ===
    if (!candidates.length && isFoodProduct) {
      console.log('[B:research] No candidates from Amazon, trying OpenFoodFacts fallback (food/supplement)...');

      const openfoodfactsUrls = await tavilySearch(
        `${name} ingredients`,
        5,
        ['world.openfoodfacts.org', 'openfoodfacts.org'],
        exclude
      );

      console.log('[B:research] openfoodfacts-fallback', { urlsFound: openfoodfactsUrls.length });

      // Process OpenFoodFacts URLs with food validation
      const offFetchPromises = openfoodfactsUrls.map(async (u: string) => {
        try {
          const host = new URL(u).hostname.replace(/^www\./, '');

          const html = await fetch(u, {
            headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }
          }).then(r => r.text());

          // OpenFoodFacts doesn't need title matching (barcode-based, highly specific)
          const { text } = extractBestIngredientsFromHtml(html, u);

          console.log('[B:research] OpenFoodFacts extraction:', text ? `✅ ${text.length} chars` : '⚠️ none');

          let cleanedText = text;
          if (cleanedText) {
            const withoutHeading = cleanIngredientsHeading(cleanedText);
            const processed = processModelIngredients(withoutHeading);

            if (looksLikeFoodIngredients(processed)) {
              cleanedText = processed;
              console.log('[B:research] ✅ OpenFoodFacts passed food validation', { host, len: cleanedText.length });
            } else {
              console.log('[B:research] ⚠️ OpenFoodFacts failed food validation', { host });
              cleanedText = null;
            }
          }

          if (cleanedText && cleanedText.length > 50) {
            return {
              url: u,
              text: cleanedText,
              authoritative: true,  // OpenFoodFacts is authoritative for food
              isGovSource: false,
              isDailyMed: false
            };
          }
          return null;
        } catch (e: any) {
          console.log('[B:research] openfoodfacts-error', { url: u, error: e?.message });
          return null;
        }
      });

      const offResults = await Promise.all(offFetchPromises);

      for (const result of offResults) {
        if (result) {
          candidates.push(result);
          console.log('[B:research] ✅ Added OpenFoodFacts candidate:', result.url);
        }
      }
    }

    if (!candidates.length) {
      console.log('[B:research] no-candidates', { ms: Date.now() - t0 });
      return res.status(200).json({ ingredients: null, sources: [], confidence: 0, detectedName: name });
    }

    // PRIORITY RANKING: Government > Authoritative > Longest
    // Sort candidates by reliability tier
    candidates.sort((a, b) => {
      // Tier 1: Government sources (FDA, DailyMed, NIH) - HIGHEST PRIORITY
      if (a.isGovSource !== b.isGovSource) return a.isGovSource ? -1 : 1;
      // Tier 2: Authoritative databases (EWG, Drugs.com, INCIdecoder, etc.)
      if (a.authoritative !== b.authoritative) return a.authoritative ? -1 : 1;
      // Tier 3: Longest ingredient list (most complete)
      return b.text.length - a.text.length;
    });

    const chosenText = dedupeList(candidates[0].text);
    const chosenSources = candidates.slice(0, 4).map(c => c.url);

    const sources = chosenSources;
    const chosen = chosenText;

    // Calculate confidence based on source reliability
    const hasGovSource = candidates[0].isGovSource;
    const hasDailyMed = candidates[0].isDailyMed;
    const hasAuthoritative = candidates[0].authoritative;

    const confidence = hasDailyMed ? 0.98 :  // DailyMed = 98% (most reliable for supplements)
                      hasGovSource ? 0.95 :  // Other gov sources = 95%
                      hasAuthoritative ? 0.85 :  // Authoritative databases = 85%
                      0.65;  // Other sources = 65%
    const preview = (chosen || '').replace(/\s+/g, ' ').slice(0, 300);

    console.log('[B:research] chosen-preview', { len: (chosen || '').length, preview });
    console.log('[B:research] done', {
      ms: Date.now() - t0,
      found: !!chosen,
      len: (chosen || '').length,
      sourcesCount: sources.length,
      sources,
      confidence
    });

    return res.status(200).json({
      ingredients: chosen,
      sources,
      confidence,
      detectedName: name,
      productType: productType, // Return GPT classification for database storage (extraction pipeline)
      productSubtype: productSubtype, // Return GPT subtype classification for user display
      debugPreview: preview
    });
  } catch (e: any) {
    console.log('[B:research] error', { ms: Date.now() - t0, error: e?.message });
    return res.status(200).json({ ingredients: null, sources: [], confidence: 0, detectedName: null });
  }
}