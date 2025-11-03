// web/lib/productName.ts
// Extract a usable product name either from HTML <title> / og:title or from the URL path.

const STOP_TITLES = [
  'amazon.com', 'walmart.com', 'walmart', 'target.com', 'target',
  'ulta beauty', 'ulta.com', 'sephora', 'sephora.com'
];

export function extractBestProductNameFromHtml(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const t = (m?.[1] || '').replace(/\s+/g, ' ').trim();
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  const ogt = (og?.[1] || '').trim();

  const pick = normalizeTitle(ogt) || normalizeTitle(t);
  if (!pick) return null;

  const plain = pick.toLowerCase();
  if (STOP_TITLES.some(s => plain === s)) return null; // useless store title
  return pick;
}

function normalizeTitle(s: string): string | null {
  if (!s) return null;
  // Strip separators and store boilerplate (pipe, em-dash, colon, AND hyphen with spaces)
  s = s.replace(/\|.*$|â€".*$|â€".*$| : .*$| - .*$/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!s) return null;
  // Kill super generic
  if (/^(amazon|walmart|target|sephora|ulta)\.?(com)?$/i.test(s)) return null;
  return s;
}

/** Turn a URL path into a reasonable product name. */
export function deriveNameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    let path = u.pathname || '';
    path = path.replace(/^\/+|\/+$/g, '');
    const parts = path.split('/');

    let core = '';

    // Sephora: /product/[product-slug]-P[SKU]?skuId=...
    // Example: /product/youth-to-the-people-papaya-vitamin-c-P513370
    if (/sephora\.com$/i.test(host)) {
      const productIndex = parts.indexOf('product');
      if (productIndex >= 0 && parts[productIndex + 1]) {
        core = parts[productIndex + 1];
        // Remove SKU suffix like -P513370
        core = core.replace(/-P\d+.*$/i, '');
      }
    }

    // Ulta: /[product-slug]?productId=...
    // Example: /cerave-moisturizing-cream?productId=xlsImpprod15121285
    else if (/ulta\.com$/i.test(host)) {
      core = parts[0] || '';
      core = core.replace(/\?.*$/, ''); // strip query params embedded in path
    }

    // Amazon: /…/dp/<asin> : keep the segment before /dp/
    else if (/amazon\./i.test(host)) {
      const dpIndex = parts.indexOf('dp');
      if (dpIndex > 0) {
        core = parts[dpIndex - 1];
      } else {
        core = parts[0] || '';
      }
    }

    // Target, Walmart, generic: use first path segment
    else {
      core = parts[0] || '';
      // For /product/[slug] patterns
      if (core === 'product' || core === 'products') {
        core = parts[1] || '';
      }
    }

    // Clean up the extracted core
    core = core.replace(/[-_]?dp[-_].*$/i, ''); // Remove Amazon DP suffixes
    core = core.replace(/[A-Z0-9]{8,}/g, ''); // Strip ASIN-like tokens
    core = core.replace(/\?.*$/, ''); // Remove query params
    core = core.replace(/[-_]+/g, ' ').trim(); // Convert dashes/underscores to spaces

    // Title case lightly
    core = core.split(' ')
      .filter(Boolean)
      .map(w => {
        // Keep common acronyms uppercase
        if (/^(uv|spf|la|ny|to|the|people)$/i.test(w)) {
          return w.toLowerCase() === 'uv' || w.toLowerCase() === 'spf'
            ? w.toUpperCase()
            : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        }
        return w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(' ')
      .trim();

    if (!core || core.length < 4) return null;
    return core;
  } catch {
    return null;
  }
}