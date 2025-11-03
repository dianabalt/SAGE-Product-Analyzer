// sage-extension/src/popup/components/AlternativesView.tsx
import { useState, useEffect } from 'react';
import { ScanResult } from '../../types';
import { getApiBaseUrl } from '../../lib/api';
import { storage } from '../../lib/storage';

interface AlternativesViewProps {
  result: ScanResult;
  onBack: () => void;
}

interface Alternative {
  title: string;
  url: string;
  ingredients?: string;
  grade: string;
  numeric_grade: number;
  beneficial_ingredients?: string[];
  harmful_ingredients?: string[];
}

export default function AlternativesView({ result, onBack }: AlternativesViewProps) {
  const [loading, setLoading] = useState(true);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('');

  const btn = {
    primary: 'w-full font-medium py-2.5 border-2 rounded-lg bg-sage-500 border-sage-500 text-white hover:opacity-90 active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-500',
    secondary: 'w-full font-medium py-2.5 border-2 rounded-lg bg-white border-sage-500 text-sage-700 hover:bg-sage-50 active:bg-sage-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-500',
    tertiary: 'w-full font-medium py-2.5 border-2 rounded-lg bg-sage-100 border-sage-400 text-sage-800 hover:bg-sage-200 active:bg-sage-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-500',
  };

  const getGradeBadgeColor = (grade: string) => {
    if (grade.startsWith('A')) return 'bg-green-100 text-green-700 border-green-300';
    if (grade.startsWith('B')) return 'bg-lime-100 text-lime-700 border-lime-300';
    if (grade.startsWith('C')) return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    if (grade.startsWith('D')) return 'bg-orange-100 text-orange-700 border-orange-300';
    return 'bg-red-100 text-red-700 border-red-300';
  };

  useEffect(() => {
    async function fetchAlternatives() {
      try {
        setLoading(true);
        setError(null);

        // Check if we have cached alternatives from the database
        if (result.cached_alternatives && result.cached_alternatives.length > 0) {
          console.log('[AlternativesView] Using cached alternatives:', result.cached_alternatives.length);

          // Transform cached alternatives to match the Alternative interface
          const cachedAlts = result.cached_alternatives.map(alt => ({
            title: alt.alternative_title,
            url: alt.alternative_url,
            ingredients: alt.alternative_ingredients || undefined,
            grade: alt.alternative_grade,
            numeric_grade: alt.alternative_score,
            beneficial_ingredients: alt.beneficial_ingredients || undefined,
            harmful_ingredients: alt.harmful_ingredients || undefined
          }));

          setAlternatives(cachedAlts);
          setCategory(result.cached_alternatives[0]?.category || '');
          setLoading(false);
          return; // Skip API call
        }

        // No cached alternatives, fetch from API
        console.log('[AlternativesView] No cached alternatives, fetching from API...');

        const baseUrl = await getApiBaseUrl();

        // Get auth token for Bearer authentication
        const session = await storage.getSession();
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
        };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const requestBody = {
          product_id: result.id,
          product_title: result.product_title,
          product_url: result.product_url,
          numeric_grade: result.numeric_grade,
          grade: result.grade,
          ingredients: result.ingredients
        };

        console.log('[AlternativesView] Requesting alternatives for:', requestBody);

        const response = await fetch(`${baseUrl}/api/find-alternatives`, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody)
        });

        console.log('[AlternativesView] Response status:', response.status);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('[AlternativesView] Error response:', errorData);
          throw new Error(errorData.error || 'Failed to fetch alternatives');
        }

        const data = await response.json();
        console.log('[AlternativesView] Response data:', data);

        if (data.success) {
          setAlternatives(data.alternatives || []);
          setCategory(data.category || '');
          console.log('[AlternativesView] Loaded', data.alternatives?.length || 0, 'alternatives');

          if (data.message) {
            setError(data.message);
          }
        } else {
          setError(data.message || 'No alternatives found');
        }
      } catch (err: any) {
        console.error('[AlternativesView] Error:', err);
        setError(err.message || 'Failed to load alternatives');
      } finally {
        setLoading(false);
      }
    }

    fetchAlternatives();
  }, [result]);

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
          <h2 className="text-lg font-bold text-sage-800">Finding Better Alternatives...</h2>
        </header>

        <main className="grow overflow-y-auto px-3 py-6 flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-sage-200 border-t-sage-500 rounded-full animate-spin mb-4"></div>
          <p className="text-sage-600 text-sm text-center">
            Searching for healthier products with cleaner ingredients...
          </p>
          <p className="text-sage-500 text-xs text-center mt-2">
            This may take 30-60 seconds
          </p>
        </main>
      </div>
    );
  }

  if (error || alternatives.length === 0) {
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
          <h2 className="text-lg font-bold text-sage-800">Better Alternatives</h2>
        </header>

        <main className="grow overflow-y-auto px-3 py-6 flex flex-col items-center justify-center">
          <svg className="w-16 h-16 text-sage-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-lg font-semibold text-sage-800 mb-2">
            {result.numeric_grade >= 80 ? 'Great Choice!' : 'No Better Alternatives Found'}
          </h3>
          <p className="text-sage-600 text-sm text-center max-w-xs mb-6">
            {error || (result.numeric_grade >= 80
              ? `Your product already has a good score (${result.numeric_grade}/100). We couldn't find significantly better alternatives.`
              : "We couldn't find products with better ingredients at this time."
            )}
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
        <h2 className="text-lg font-bold text-sage-800">Better Alternatives</h2>
        {category && (
          <p className="text-xs text-sage-600 mt-1">
            {alternatives.length} healthier {category} option{alternatives.length !== 1 ? 's' : ''} found
          </p>
        )}
      </header>

      <main className="grow overflow-y-auto px-3 py-3">
        {/* Current Product Comparison */}
        <div className="mb-4 bg-sage-50 border border-sage-200 rounded-lg p-3">
          <p className="text-xs font-medium text-sage-700 mb-1">Your Current Product:</p>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-sage-900 flex-1 mr-2">
              {result.product_title}
            </p>
            <span className={`px-2 py-1 rounded-lg text-xs font-bold border ${getGradeBadgeColor(result.grade)}`}>
              {result.grade} ({result.numeric_grade})
            </span>
          </div>
        </div>

        {/* Alternatives List */}
        <div className="space-y-3">
          {alternatives.map((alt, idx) => (
            <div
              key={idx}
              className="bg-white border-2 border-sage-300 rounded-lg p-4 hover:shadow-lg transition-shadow"
            >
              {/* Grade Badge */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 mr-2">
                  <h3 className="font-bold text-sage-900 text-sm mb-1 leading-tight">
                    {alt.title}
                  </h3>
                  {idx === 0 && (
                    <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">
                      ⭐ Top Pick
                    </span>
                  )}
                </div>
                <div className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-bold border-2 ${getGradeBadgeColor(alt.grade)}`}>
                  {alt.grade}
                </div>
              </div>

              {/* Score Bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-sage-600">Safety Score</span>
                  <span className="text-xs font-bold text-sage-800">{alt.numeric_grade}/100</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      alt.numeric_grade >= 90 ? 'bg-green-500' :
                      alt.numeric_grade >= 80 ? 'bg-sage-500' :
                      'bg-yellow-500'
                    }`}
                    style={{ width: `${alt.numeric_grade}%` }}
                  />
                </div>
              </div>

              {/* Improvement Indicator */}
              {result.numeric_grade && (
                <div className="mb-3 bg-green-50 border border-green-200 rounded px-2 py-1.5">
                  <p className="text-xs text-green-700 font-medium">
                    <span className="font-bold">+{alt.numeric_grade - result.numeric_grade} points</span> better than your current product
                  </p>
                </div>
              )}

              {/* Beneficial Ingredients */}
              {alt.beneficial_ingredients && alt.beneficial_ingredients.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-green-700 mb-1 flex items-center">
                    <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    {alt.beneficial_ingredients.length} Beneficial
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {alt.beneficial_ingredients.slice(0, 3).map((ing, i) => (
                      <span key={i} className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                        {ing}
                      </span>
                    ))}
                    {alt.beneficial_ingredients.length > 3 && (
                      <span className="px-2 py-0.5 bg-green-50 text-green-600 rounded text-xs">
                        +{alt.beneficial_ingredients.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Concerning Ingredients */}
              {alt.harmful_ingredients && alt.harmful_ingredients.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-red-700 mb-1 flex items-center">
                    <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    {alt.harmful_ingredients.length} Concerning
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {alt.harmful_ingredients.slice(0, 2).map((ing, i) => (
                      <span key={i} className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs">
                        {ing}
                      </span>
                    ))}
                    {alt.harmful_ingredients.length > 2 && (
                      <span className="px-2 py-0.5 bg-red-50 text-red-600 rounded text-xs">
                        +{alt.harmful_ingredients.length - 2}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Action Button */}
              <button
                onClick={() => window.open(alt.url, '_blank')}
                className={`${btn.primary} flex items-center justify-center gap-2 text-sm`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View Product Details
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
