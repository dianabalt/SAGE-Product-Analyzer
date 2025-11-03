// web/pages/api/find-deals.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServer } from '../../lib/supabaseServer';
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

// Extract size from product title (handles oz, fl oz, ml, count, etc.)
function extractSize(title: string): { value: number; unit: string } | null {
  // Try to extract size with unit
  // Examples: "3 oz", "3 fl oz", "100 ml", "30 count", "2.5oz", "1.7 FL OZ"
  const sizePatterns = [
    /(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|fluid ounce|fluid ounces)/i,  // Fluid ounces
    /(\d+(?:\.\d+)?)\s*(oz|ounce|ounces)(?!\s*count)/i,          // Regular ounces (not count)
    /(\d+(?:\.\d+)?)\s*(ml|milliliter|milliliters)/i,            // Milliliters
    /(\d+(?:\.\d+)?)\s*(l|liter|liters)/i,                       // Liters
    /(\d+(?:\.\d+)?)\s*(g|gram|grams)/i,                         // Grams
    /(\d+(?:\.\d+)?)\s*(kg|kilogram|kilograms)/i,                // Kilograms
    /(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds)/i,                  // Pounds
    /(\d+)\s*[-/]\s*pack/i,                                       // Pack size
    /(\d+)\s*(count|ct|tablets|capsules|pills)/i,                // Count
  ];

  for (const pattern of sizePatterns) {
    const match = title.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      let unit = match[2].toLowerCase().trim().replace(/\./g, ''); // Remove dots

      // Normalize units
      if (unit.match(/^(fl\s*oz|fluid ounce|fluid ounces)$/i)) unit = 'fl oz';
      else if (unit.match(/^(oz|ounce|ounces)$/i)) unit = 'oz';
      else if (unit.match(/^(ml|milliliter|milliliters)$/i)) unit = 'ml';
      else if (unit.match(/^(l|liter|liters)$/i)) unit = 'l';
      else if (unit.match(/^(g|gram|grams)$/i)) unit = 'g';
      else if (unit.match(/^(kg|kilogram|kilograms)$/i)) unit = 'kg';
      else if (unit.match(/^(lb|lbs|pound|pounds)$/i)) unit = 'lb';
      else if (unit.match(/^(count|ct|tablets|capsules|pills)$/i)) unit = 'count';
      else if (unit.match(/pack/i)) unit = 'pack';

      return { value, unit };
    }
  }

  return null;
}

// Calculate price per unit (normalized)
function calculatePricePerUnit(price: number | null, size: { value: number; unit: string } | null): number | null {
  if (!price || !size || size.value <= 0) return null;

  // Normalize to common units for comparison
  let normalizedSize = size.value;

  // Convert to fluid ounces or ounces for liquids/weights
  if (size.unit === 'ml') normalizedSize = size.value / 29.5735; // ml to fl oz
  else if (size.unit === 'l') normalizedSize = (size.value * 1000) / 29.5735; // l to fl oz
  else if (size.unit === 'g') normalizedSize = size.value / 28.3495; // g to oz
  else if (size.unit === 'kg') normalizedSize = (size.value * 1000) / 28.3495; // kg to oz
  else if (size.unit === 'lb') normalizedSize = size.value * 16; // lb to oz

  return price / normalizedSize;
}

// Format size for display
function formatSize(size: { value: number; unit: string }): string {
  return `${size.value} ${size.unit}`;
}

// Extract key product identifiers (brand, product line, shade/color) for precise matching
function extractProductIdentifiers(title: string): {
  brand?: string;
  productLine?: string;
  shade?: string;
  keyTokens: string[];
} {
  const titleLower = title.toLowerCase();

  // Extract brand (first 1-2 words that are capitalized)
  const brandMatch = title.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  const brand = brandMatch?.[1];

  // Extract shade/color (often after a comma or in quotes)
  let shade: string | undefined;
  const shadePatterns = [
    /,\s*([A-Za-z\s]+(?:Black|Brown|Beige|Nude|Red|Pink|Blue|Green|Bronze|Gold|Silver|Clear|Natural))/i,
    /"([^"]+)"/,
    /\b(Blackest Black|Very Black|Black Brown|Soft Black|Deep Brown|Natural|Nude)\b/i,
  ];
  for (const pattern of shadePatterns) {
    const match = title.match(pattern);
    if (match) {
      shade = match[1].trim();
      break;
    }
  }

  // Extract product line (key middle words between brand and type)
  // Remove brand, common product types, and shade to get the product line
  let productLine = title
    .replace(brand || '', '')
    .replace(shade || '', '')
    .replace(/\b(mascara|lipstick|foundation|concealer|blush|eyeliner|eyeshadow|powder|cream|lotion|serum|cleanser|moisturizer|sunscreen|balm|gloss|primer)\b/gi, '')
    .replace(/\b(washable|waterproof|longwear|matte|satin|sheer|shimmer|hydrating|volumizing)\b/gi, '')
    .replace(/[,\(\)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Key tokens for matching (brand + product line + shade)
  const keyTokens: string[] = [];
  if (brand) keyTokens.push(brand.toLowerCase());
  if (productLine) productLine.split(/\s+/).forEach(t => t.length > 2 && keyTokens.push(t.toLowerCase()));
  if (shade) keyTokens.push(shade.toLowerCase());

  return { brand, productLine, shade, keyTokens };
}

// Check if a search result matches the original product identifiers
function matchesProductIdentifiers(
  resultTitle: string,
  originalIdentifiers: { brand?: string; productLine?: string; shade?: string; keyTokens: string[] }
): boolean {
  const resultLower = resultTitle.toLowerCase();

  // Must match brand (if we have one)
  if (originalIdentifiers.brand && !resultLower.includes(originalIdentifiers.brand.toLowerCase())) {
    return false;
  }

  // Must match product line (if we have one)
  if (originalIdentifiers.productLine) {
    const lineTokens = originalIdentifiers.productLine.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    // At least 50% of product line tokens must match
    const matchedTokens = lineTokens.filter(token => resultLower.includes(token));
    if (matchedTokens.length < lineTokens.length * 0.5) {
      return false;
    }
  }

  // If we have a shade, result should ideally match it (but we're more lenient here since retailers vary)
  // We'll log a warning but not reject
  if (originalIdentifiers.shade && !resultLower.includes(originalIdentifiers.shade.toLowerCase())) {
    console.log(`[DEALS] ⚠️  Shade mismatch: original="${originalIdentifiers.shade}", result="${resultTitle}"`);
  }

  return true;
}

// Extract product name (remove retailer, price, and size info to get clean name)
function extractProductName(title: string, retailer: string): string {
  // Remove retailer name from beginning if present
  let cleanTitle = title.replace(new RegExp(`^${retailer}\\s*[-:]?\\s*`, 'i'), '');

  // Remove common prefixes like "Buy", "Shop", etc.
  cleanTitle = cleanTitle.replace(/^(buy|shop|get|find)\s+/i, '');

  // Remove price patterns like "$19.99", "Price: $19.99"
  cleanTitle = cleanTitle.replace(/\$\s*\d+(?:\.\d{2})?/g, '');
  cleanTitle = cleanTitle.replace(/price:\s*\$?\s*\d+(?:\.\d{2})?/gi, '');

  // Clean up extra whitespace and hyphens
  cleanTitle = cleanTitle.replace(/\s+[-–—]\s+/g, ' - ').replace(/\s+/g, ' ').trim();

  return cleanTitle;
}

// Extract price from text (handles $19.99, 19.99, $1,299.99, etc.)
function extractPrice(text: string): number | null {
  // Remove common text that might interfere
  text = text.replace(/[a-zA-Z]/g, ' ');

  // Try to find price with dollar sign and commas: $1,299.99
  let match = text.match(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  if (match) {
    return parseFloat(match[1].replace(/,/g, ''));
  }

  // Try to find price without dollar sign but with decimal: 19.99
  match = text.match(/(\d{1,4}\.\d{2})/);
  if (match) {
    return parseFloat(match[1]);
  }

  // Try to find any number with commas: 1,299
  match = text.match(/(\d{1,3}(?:,\d{3})+)/);
  if (match) {
    return parseFloat(match[1].replace(/,/g, ''));
  }

  // Last resort: find any standalone number
  match = text.match(/(\d+)/);
  if (match) {
    const num = parseFloat(match[1]);
    // Filter out unrealistic prices (too low or too high)
    if (num >= 1 && num <= 10000) {
      return num;
    }
  }

  return null;
}

// Check if URL is a direct product page (not a category/search page)
function isDirectProductUrl(url: string): boolean {
  const urlLower = url.toLowerCase();

  // Amazon product pages have /dp/ or /gp/product/
  if (urlLower.includes('amazon.com') && (urlLower.includes('/dp/') || urlLower.includes('/gp/product/'))) {
    return true;
  }

  // Walmart product pages have /ip/ (item page)
  if (urlLower.includes('walmart.com') && urlLower.includes('/ip/')) {
    return true;
  }

  // Target product pages have /p/ or /-A-
  if (urlLower.includes('target.com') && (urlLower.includes('/p/') || urlLower.includes('/-a-'))) {
    return true;
  }

  // Sephora product pages have /product/
  if (urlLower.includes('sephora.com') && urlLower.includes('/product/')) {
    return true;
  }

  // Ulta product pages have /p/ or /productId/
  if (urlLower.includes('ulta.com') && (urlLower.includes('/p/') || urlLower.includes('/productid/'))) {
    return true;
  }

  // Generic product URL indicators
  if (urlLower.match(/\/(product|item|p|pd|dp)\//) || urlLower.match(/\/[A-Z0-9]{8,}/)) {
    return true;
  }

  // Reject obvious category/search pages
  if (urlLower.match(/\/(browse|category|search|shop|all-products|catalog|c\/)/)) {
    return false;
  }

  // If unsure, allow it (we'll validate by fetching)
  return true;
}

// Extract price from HTML page (retailer-specific selectors)
async function extractPriceFromPage(url: string, retailer: string): Promise<number | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    // Try retailer-specific selectors first
    let priceText = '';

    if (retailer === 'Amazon') {
      priceText = $('.a-price .a-offscreen').first().text() ||
                  $('#priceblock_ourprice').text() ||
                  $('#priceblock_dealprice').text() ||
                  $('.a-price-whole').first().text();
    } else if (retailer === 'Walmart') {
      priceText = $('[itemprop="price"]').attr('content') ||
                  $('[data-testid="price-wrap"]').text() ||
                  $('.price-characteristic').text() ||
                  $('span[class*="price"]').first().text();
    } else if (retailer === 'Target') {
      priceText = $('[data-test="product-price"]').text() ||
                  $('[data-test*="price"]').first().text() ||
                  $('span[class*="Price"]').first().text();
    } else if (retailer === 'Sephora') {
      priceText = $('[data-at="price"]').text() ||
                  $('.css-1va3q1n').text() ||
                  $('span[class*="price"]').first().text();
    } else if (retailer === 'Ulta') {
      priceText = $('.ProductPricingPanel__price').text() ||
                  $('[class*="ProductPrice"]').first().text();
    }

    // Fallback: try generic price selectors
    if (!priceText) {
      priceText = $('[itemprop="price"]').attr('content') ||
                  $('[property="product:price:amount"]').attr('content') ||
                  $('.price').first().text() ||
                  $('[class*="price"]').first().text();
    }

    if (priceText) {
      return extractPrice(priceText);
    }

    return null;
  } catch (error) {
    console.error(`[DEALS] Error fetching price from ${url}:`, error);
    return null;
  }
}

// Search for shopping deals using Tavily and extract actual prices
async function searchShoppingDeals(productName: string): Promise<any[]> {
  const key = process.env.SEARCH_API_KEY || '';
  if (!key) {
    console.log('[DEALS] No Tavily API key configured');
    return [];
  }

  try {
    // Extract product identifiers for precise matching
    const originalIdentifiers = extractProductIdentifiers(productName);
    console.log('[DEALS] Original product identifiers:', {
      brand: originalIdentifiers.brand,
      productLine: originalIdentifiers.productLine,
      shade: originalIdentifiers.shade
    });

    // More specific query to get exact product matches
    const query = `"${productName}" buy online`;
    console.log('[DEALS] Tavily search query:', query);

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        max_results: 15, // Increased to get more results to filter
        include_domains: [
          'amazon.com',
          'walmart.com',
          'target.com',
          'sephora.com',
          'ulta.com',
          'dermstore.com',
          'iherb.com',
          'vitacost.com'
        ]
      })
    });

    if (!response.ok) {
      console.log('[DEALS] Tavily error:', response.status);
      return [];
    }

    const data = await response.json();
    const results = data.results || [];

    console.log('[DEALS] Found', results.length, 'search results, filtering for matching products...');

    // Filter for direct product URLs AND matching product identifiers
    const productResults = results.filter((result: any) => {
      const isProduct = isDirectProductUrl(result.url);
      if (!isProduct) {
        console.log('[DEALS] ⏭️  Skipped non-product URL:', result.url);
        return false;
      }

      // Check if product matches original identifiers
      const matches = matchesProductIdentifiers(result.title, originalIdentifiers);
      if (!matches) {
        console.log('[DEALS] ⏭️  Skipped non-matching product:', result.title);
        return false;
      }

      return true;
    });

    console.log('[DEALS] Found', productResults.length, 'matching product pages, extracting prices...');

    // Extract prices from each product page
    const deals = await Promise.all(
      productResults.slice(0, 8).map(async (result: any) => { // Limit to 8 to keep response time reasonable
        const url = new URL(result.url);
        const domain = url.hostname.replace('www.', '');

        let retailer = 'Online Store';
        if (domain.includes('amazon')) retailer = 'Amazon';
        else if (domain.includes('walmart')) retailer = 'Walmart';
        else if (domain.includes('target')) retailer = 'Target';
        else if (domain.includes('sephora')) retailer = 'Sephora';
        else if (domain.includes('ulta')) retailer = 'Ulta';
        else if (domain.includes('dermstore')) retailer = 'DermStore';
        else if (domain.includes('iherb')) retailer = 'iHerb';
        else if (domain.includes('vitacost')) retailer = 'Vitacost';

        // Extract size from title (e.g., "3 oz", "100 ml")
        const size = extractSize(result.title);

        // Extract clean product name
        const productName = extractProductName(result.title, retailer);

        // ALWAYS fetch actual page price for accuracy (never trust cached Tavily prices)
        console.log('[DEALS] Fetching real-time price from page:', result.url);
        const price = await extractPriceFromPage(result.url, retailer);

        // Calculate price per unit for comparison
        const pricePerUnit = calculatePricePerUnit(price, size);

        // Format display name with size
        const displayName = size ? `${productName} - ${formatSize(size)}` : productName;

        if (price) {
          const sizeInfo = size ? ` (${formatSize(size)}, $${pricePerUnit?.toFixed(2)}/unit)` : '';
          console.log('[DEALS] ✅', retailer, '-', displayName, '- $' + price.toFixed(2) + sizeInfo);
        } else {
          console.log('[DEALS] ⚠️', retailer, '- Could not extract price from page');
        }

        return {
          retailer,
          price,
          deal_url: result.url,
          title: result.title,
          product_name: productName,
          display_name: displayName,
          size: size ? formatSize(size) : null,
          price_per_unit: pricePerUnit,
          description: result.content?.substring(0, 200),
          availability: price ? 'Available' : 'Check website'
        };
      })
    );

    // Filter out deals without prices
    const dealsWithPrices = deals.filter(deal => deal.price !== null);

    console.log('[DEALS] Extracted prices for', dealsWithPrices.length, 'out of', deals.length, 'products');

    // Deduplicate by retailer + URL (prevent showing same product multiple times)
    const uniqueDeals = new Map<string, any>();
    for (const deal of dealsWithPrices) {
      const key = `${deal.retailer}||${deal.deal_url}`;
      if (!uniqueDeals.has(key)) {
        uniqueDeals.set(key, deal);
      } else {
        console.log('[DEALS] ⏭️  Skipped duplicate:', deal.retailer, '-', deal.display_name);
      }
    }

    const dedupedDeals = Array.from(uniqueDeals.values());
    console.log('[DEALS] After deduplication:', dedupedDeals.length, 'unique deals');

    // If we have at least some deals with prices, return those
    // Otherwise return all deals (user can check prices manually)
    return dedupedDeals.length > 0 ? dedupedDeals : deals;
  } catch (error) {
    console.error('[DEALS] Search error:', error);
    return [];
  }
}

// Scrape Google Shopping results (basic implementation)
async function scrapeGoogleShopping(productName: string): Promise<any[]> {
  try {
    const query = encodeURIComponent(productName);
    const url = `https://www.google.com/search?q=${query}&tbm=shop`;

    console.log('[DEALS] Scraping Google Shopping for:', productName);

    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    if (!response.ok) {
      console.log('[DEALS] Google Shopping request failed:', response.status);
      return [];
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const deals: any[] = [];

    // Google Shopping results have specific structure
    // This is a simplified scraper - structure may change
    $('[data-sh-product]').each((_, el) => {
      try {
        const $el = $(el);
        const title = $el.find('[data-sh-title]').text().trim() ||
                     $el.find('h3, h4').first().text().trim();
        const priceText = $el.find('[data-sh-price]').text().trim() ||
                         $el.find('[aria-label*="$"]').text().trim();
        const price = extractPrice(priceText);
        const link = $el.find('a').first().attr('href') || '';
        const retailer = $el.find('[data-sh-merchant]').text().trim() ||
                        $el.find('[data-merchant]').text().trim() ||
                        'Online Store';

        if (title && price && link) {
          deals.push({
            retailer,
            price,
            deal_url: link.startsWith('http') ? link : `https://www.google.com${link}`,
            title,
            availability: 'In Stock'
          });
        }
      } catch (err) {
        // Skip malformed entries
      }
    });

    console.log('[DEALS] Scraped', deals.length, 'deals from Google Shopping');
    return deals;
  } catch (error) {
    console.error('[DEALS] Google Shopping scrape error:', error);
    return [];
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { product_id, product_title } = req.body;

    if (!product_title) {
      return res.status(400).json({ error: 'product_title is required' });
    }

    // Auth check - support both cookie auth (web) and Bearer token (extension)
    const supabase = getSupabaseServer(req, res);
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
      console.error('[DEALS] No user found - not authenticated');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('[DEALS] Finding deals for:', product_title);

    // Check cache first (if product_id provided)
    if (product_id) {
      const { data: cached } = await supabase
        .from('product_deals')
        .select('*')
        .eq('product_id', product_id)
        .gt('expires_at', new Date().toISOString())
        .order('price', { ascending: true })
        .limit(5);

      if (cached && cached.length > 0) {
        console.log('[DEALS] Returning', cached.length, 'cached deals');
        return res.json({
          success: true,
          deals: cached.map(deal => {
            // Extract size and product name from cached title
            const size = extractSize(deal.product_title || '');
            const productName = extractProductName(deal.product_title || '', deal.retailer);
            const displayName = size ? `${productName} - ${formatSize(size)}` : productName;
            const pricePerUnit = calculatePricePerUnit(deal.price, size);

            return {
              retailer: deal.retailer,
              price: deal.price,
              currency: deal.currency || 'USD',
              deal_url: deal.deal_url,
              availability: deal.availability,
              rating: deal.rating,
              review_count: deal.review_count,
              title: deal.product_title,
              display_name: displayName,
              product_name: productName,
              size: size ? formatSize(size) : null,
              price_per_unit: pricePerUnit
            };
          }),
          cached: true
        });
      }
    }

    // Use Tavily search for reliable results
    // NOTE: Google Shopping scraping was removed due to unreliable pricing
    console.log('[DEALS] Searching with Tavily for accurate results...');
    let deals = await searchShoppingDeals(product_title);

    if (deals.length === 0) {
      console.log('[DEALS] No deals found');
      return res.json({
        success: true,
        deals: [],
        message: 'No shopping results found. Try searching manually on retailer websites.'
      });
    }

    // Sort by price per unit (best value first), then by price as fallback
    deals.sort((a, b) => {
      // If both have price per unit, sort by that (best bang for buck)
      if (a.price_per_unit && b.price_per_unit) {
        return a.price_per_unit - b.price_per_unit;
      }
      // If only one has price per unit, prioritize it
      if (a.price_per_unit && !b.price_per_unit) return -1;
      if (!a.price_per_unit && b.price_per_unit) return 1;
      // Fallback to sorting by total price
      return (a.price || Infinity) - (b.price || Infinity);
    });
    const topDeals = deals.slice(0, 5);

    console.log('[DEALS] Found', topDeals.length, 'deals, sorted by best value');

    // Cache results in database (if product_id provided)
    if (product_id && topDeals.length > 0) {
      const dealRecords = topDeals.map(deal => ({
        product_id,
        product_title: deal.title, // Store the specific deal title (has size info)
        retailer: deal.retailer,
        price: deal.price,
        currency: 'USD',
        deal_url: deal.deal_url,
        availability: deal.availability || 'Unknown',
        search_query: product_title
      }));

      // Insert deals, ignoring duplicates (UNIQUE constraint will handle)
      const { error: insertError } = await supabase
        .from('product_deals')
        .upsert(dealRecords, {
          onConflict: 'product_id,retailer,deal_url',
          ignoreDuplicates: false
        });

      if (insertError) {
        console.error('[DEALS] Cache error:', insertError);
      } else {
        console.log('[DEALS] Cached', topDeals.length, 'deals');
      }
    }

    const responseDeals = topDeals.map(deal => ({
      retailer: deal.retailer,
      price: deal.price,
      currency: 'USD',
      deal_url: deal.deal_url,
      availability: deal.availability || 'Check availability',
      title: deal.title,
      display_name: deal.display_name || deal.product_name || deal.title,
      product_name: deal.product_name,
      size: deal.size,
      price_per_unit: deal.price_per_unit
    }));

    console.log('[DEALS] Returning response with deals:', responseDeals.map(d => ({
      retailer: d.retailer,
      display_name: d.display_name,
      size: d.size,
      price: d.price,
      price_per_unit: d.price_per_unit
    })));

    return res.json({
      success: true,
      deals: responseDeals,
      cached: false
    });

  } catch (error: any) {
    console.error('[DEALS] Error:', error);
    return res.status(500).json({
      error: 'Failed to find deals',
      message: error.message
    });
  }
}
