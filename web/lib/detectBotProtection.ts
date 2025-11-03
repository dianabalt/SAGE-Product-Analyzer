// web/lib/detectBotProtection.ts
// Detect bot protection pages that return 200 OK but aren't real content

const BOT_PROTECTION_TITLES = [
  'access denied',
  'just a moment',
  'checking your browser',
  'attention required',
  'cloudflare',
  '403 forbidden',
  '403 error',
  'captcha',
  'robot or human',
  'please verify',
  'security check',
  'bot protection',
  'are you a robot',
  'verify you are human'
];

const BOT_PROTECTION_CONTENT = [
  'cloudflare',
  'ray id',
  'cf-ray',
  'perimeterx',
  'datadome',
  'imperva',
  'recaptcha',
  'hcaptcha',
  'please enable cookies',
  'enable javascript and cookies',
  'checking your browser before accessing'
];

/**
 * Check if HTML content looks like a bot protection page
 */
export function isBotProtectionPage(html: string): boolean {
  if (!html || html.length < 100) return true; // suspiciously small response

  const lower = html.toLowerCase();

  // Check title tag
  const titleMatch = lower.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const title = titleMatch[1].trim();
    if (BOT_PROTECTION_TITLES.some(phrase => title.includes(phrase))) {
      return true;
    }
  }

  // Check meta og:title
  const ogMatch = lower.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  if (ogMatch) {
    const ogTitle = ogMatch[1].trim();
    if (BOT_PROTECTION_TITLES.some(phrase => ogTitle.includes(phrase))) {
      return true;
    }
  }

  // Check page content for bot protection indicators
  const contentSample = lower.slice(0, 3000); // first 3KB should be enough
  const matches = BOT_PROTECTION_CONTENT.filter(phrase => contentSample.includes(phrase));

  // If we find 2+ bot protection indicators, likely a bot page
  if (matches.length >= 2) return true;

  // Very short HTML (< 500 chars) is suspicious for a product page
  if (html.length < 500) return true;

  return false;
}

/**
 * Check if a product name looks like it came from a bot protection page
 */
export function isBotProtectionName(name: string | null): boolean {
  if (!name) return false;

  const lower = name.toLowerCase().trim();

  return BOT_PROTECTION_TITLES.some(phrase => lower.includes(phrase));
}
