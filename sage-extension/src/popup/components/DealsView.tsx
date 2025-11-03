// sage-extension/src/popup/components/DealsView.tsx
import { useState, useEffect } from 'react';
import { ScanResult } from '../../types';
import { getApiBaseUrl } from '../../lib/api';
import { storage } from '../../lib/storage';

interface DealsViewProps {
  result: ScanResult;
  onBack: () => void;
}

interface Deal {
  retailer: string;
  price: number | null;
  currency: string;
  deal_url: string;
  availability?: string;
  rating?: number;
  review_count?: number;
  title?: string;
  display_name?: string;
  product_name?: string;
  size?: string;
  price_per_unit?: number | null;
}

export default function DealsView({ result, onBack }: DealsViewProps) {
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [error, setError] = useState<string | null>(null);

  const btn = {
    primary: 'w-full font-medium py-2.5 border-2 rounded-lg bg-sage-500 border-sage-500 text-white hover:opacity-90 active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-500',
    tertiary: 'w-full font-medium py-2.5 border-2 rounded-lg bg-sage-100 border-sage-400 text-sage-800 hover:bg-sage-200 active:bg-sage-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-500',
  };

  useEffect(() => {
    async function fetchDeals() {
      try {
        setLoading(true);
        setError(null);

        const baseUrl = await getApiBaseUrl();

        // Get auth token for Bearer authentication
        const session = await storage.getSession();
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
        };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const response = await fetch(`${baseUrl}/api/find-deals`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            product_id: result.id,
            product_title: result.product_title
          })
        });

        if (!response.ok) {
          throw new Error('Failed to fetch deals');
        }

        const data = await response.json();

        if (data.success) {
          setDeals(data.deals || []);
          console.log('[DealsView] Loaded', data.deals?.length || 0, 'deals');
          console.log('[DealsView] First deal data:', data.deals?.[0]);
          console.log('[DealsView] First deal display fields:', {
            display_name: data.deals?.[0]?.display_name,
            product_name: data.deals?.[0]?.product_name,
            size: data.deals?.[0]?.size,
            price_per_unit: data.deals?.[0]?.price_per_unit
          });
        } else {
          setError(data.message || 'No deals found');
        }
      } catch (err: any) {
        console.error('[DealsView] Error:', err);
        setError(err.message || 'Failed to load deals');
      } finally {
        setLoading(false);
      }
    }

    fetchDeals();
  }, [result]);

  // Get retailer logo/color
  const getRetailerStyle = (retailer: string) => {
    const r = retailer.toLowerCase();
    if (r.includes('amazon')) return { color: 'bg-orange-100 text-orange-700 border-orange-300', icon: '📦' };
    if (r.includes('walmart')) return { color: 'bg-blue-100 text-blue-700 border-blue-300', icon: '🏪' };
    if (r.includes('target')) return { color: 'bg-red-100 text-red-700 border-red-300', icon: '🎯' };
    if (r.includes('sephora')) return { color: 'bg-black text-white border-black', icon: '💄' };
    if (r.includes('ulta')) return { color: 'bg-pink-100 text-pink-700 border-pink-300', icon: '💅' };
    if (r.includes('dermstore')) return { color: 'bg-teal-100 text-teal-700 border-teal-300', icon: '🧴' };
    return { color: 'bg-sage-100 text-sage-700 border-sage-300', icon: '🛒' };
  };

  // NOTE: Prices removed due to unreliability - just show retailer links
  // const getBestDeal = () => {
  //   const dealsWithPrices = deals.filter(d => d.price !== null);
  //   if (dealsWithPrices.length === 0) return null;
  //   return dealsWithPrices.reduce((min, deal) =>
  //     (deal.price! < min.price!) ? deal : min
  //   );
  // };
  // const bestDeal = getBestDeal();

  if (loading) {
    return (
      <div className="h-full flex flex-col animate-fade-in">
        <header className="shrink-0 bg-white border-b px-3 py-2">
          <button
            onClick={onBack}
            className="flex items-center text-sage-700 hover:text-sage-900 mb-2"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Results
          </button>
          <h2 className="text-lg font-bold text-sage-800">Finding Best Deals...</h2>
        </header>

        <main className="grow overflow-y-auto px-3 py-6 flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-sage-200 border-t-sage-500 rounded-full animate-spin mb-4"></div>
          <p className="text-sage-600 text-sm text-center">
            Searching top retailers for the best prices...
          </p>
        </main>
      </div>
    );
  }

  if (error || deals.length === 0) {
    return (
      <div className="h-full flex flex-col animate-fade-in">
        <header className="shrink-0 bg-white border-b px-3 py-2">
          <button
            onClick={onBack}
            className="flex items-center text-sage-700 hover:text-sage-900 mb-2"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Results
          </button>
          <h2 className="text-lg font-bold text-sage-800">Best Deals</h2>
        </header>

        <main className="grow overflow-y-auto px-3 py-6 flex flex-col items-center justify-center">
          <svg className="w-16 h-16 text-sage-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
          </svg>
          <h3 className="text-lg font-semibold text-sage-800 mb-2">No Deals Found</h3>
          <p className="text-sage-600 text-sm text-center max-w-xs mb-4">
            {error || "We couldn't find pricing information for this product at this time."}
          </p>
          <p className="text-sage-500 text-xs text-center max-w-xs mb-6">
            Try searching manually on retailer websites, or check back later.
          </p>
          <button onClick={onBack} className={btn.tertiary}>
            Back to Results
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col animate-slide-up">
      <header className="shrink-0 sticky top-0 z-10 bg-white/80 backdrop-blur border-b px-3 py-2">
        <button
          onClick={onBack}
          className="flex items-center text-sage-700 hover:text-sage-900 mb-2"
        >
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Results
        </button>
        <h2 className="text-lg font-bold text-sage-800">Best Deals</h2>
        <p className="text-xs text-sage-600 mt-1">
          {deals.length} retailer{deals.length !== 1 ? 's' : ''} found • Prices updated recently
        </p>
      </header>

      <main className="grow overflow-y-auto px-3 py-3">
        {/* Product Title */}
        <div className="mb-4 bg-sage-50 border border-sage-200 rounded-lg p-3">
          <p className="text-xs font-medium text-sage-700 mb-1">Shopping for:</p>
          <p className="text-sm font-semibold text-sage-900">
            {result.product_title}
          </p>
        </div>

        {/* All Deals List */}
        <div className="space-y-3">
          {deals.map((deal, idx) => {
            const style = getRetailerStyle(deal.retailer);

            return (
              <div
                key={idx}
                className="bg-white border-2 border-sage-200 rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                {/* Retailer Badge */}
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border mb-3 ${style.color}`}>
                  <span className="text-base">{style.icon}</span>
                  <span className="font-bold text-sm">{deal.retailer}</span>
                </div>

                {/* Product Name and Size */}
                <div className="mb-3">
                  <p className="text-sm font-semibold text-sage-900 line-clamp-2">
                    {deal.display_name || deal.product_name || deal.title}
                  </p>
                </div>

                {/* Price Info */}
                <div className="mb-3 flex items-baseline justify-between">
                  {deal.price ? (
                    <div>
                      <div className="text-2xl font-bold text-sage-900">
                        ${deal.price.toFixed(2)}
                      </div>
                      {deal.price_per_unit && (
                        <div className="text-xs text-sage-600 mt-1">
                          ${deal.price_per_unit.toFixed(2)}/unit
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-sage-500 font-medium">
                      See website
                    </div>
                  )}

                  {idx === 0 && deals.length > 1 && deal.price && (
                    <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded">
                      Best Value
                    </span>
                  )}
                </div>

                {/* Action Button */}
                <button
                  onClick={() => window.open(deal.deal_url, '_blank')}
                  className={`${btn.primary} flex items-center justify-center gap-2 text-sm w-full`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                  {deal.price ? `Buy for $${deal.price.toFixed(2)}` : `Check Price at ${deal.retailer}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* Disclaimer */}
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-xs text-blue-800">
            ⚠️ <span className="font-semibold">Important:</span> Prices are scraped in real-time but may vary by size, variant, or store location. Always verify the final price and product details on the retailer's website before purchasing.
          </p>
        </div>
      </main>

      <footer className="shrink-0 sticky bottom-0 z-10 bg-white/80 backdrop-blur border-t p-3">
        <button onClick={onBack} className={btn.tertiary}>
          Back to Results
        </button>
      </footer>
    </div>
  );
}
