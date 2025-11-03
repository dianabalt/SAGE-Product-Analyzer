import { useState, useEffect } from 'react';
import { ScanResult } from '../../types';
import { openWebApp, getHistory, deleteProduct } from '../../lib/api';

interface ProductRow {
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
  alternatives_count?: number;
  has_alternatives?: boolean;
  product_alternatives?: Array<{
    id: string;
    alternative_title: string;
    alternative_url: string;
    alternative_ingredients: string | null;
    alternative_grade: string;
    alternative_score: number;
    beneficial_ingredients: string[] | null;
    harmful_ingredients: string[] | null;
    category: string | null;
  }>;
}

interface HistoryViewProps {
  onViewResult: (result: ScanResult) => void;
  onViewAlternatives?: (result: ScanResult) => void; // New callback for viewing alternatives
  isVisible?: boolean; // Track when this view is visible to trigger refresh
}

export default function HistoryView({ onViewResult, onViewAlternatives, isVisible = true }: HistoryViewProps) {
  const [history, setHistory] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Reload history whenever this view becomes visible
  useEffect(() => {
    if (isVisible) {
      console.log('[HistoryView] View is visible, loading history...');
      loadHistory();
    }
  }, [isVisible]);

  const loadHistory = async () => {
    try {
      setLoading(true);
      console.log('[HistoryView] 🔍 Starting history load...');

      // Fetch history directly - Supabase SDK handles auto-refresh of tokens
      console.log('[HistoryView] Fetching history from API endpoint...');
      const products = await getHistory();

      console.log('[HistoryView] ✅ History loaded with', products.length, 'items');
      setHistory(products as ProductRow[]);

      if (products.length === 0) {
        console.warn('[HistoryView] ⚠️ No scan history found for this user');
      }
    } catch (error: any) {
      console.error('[HistoryView] ❌ Failed to load scan history:', error);
      console.error('[HistoryView] Error details:', error?.message, error?.stack);

      // Only show error if it's NOT a 401 (auth is handled by app state)
      if (error?.message?.includes('401') || error?.message?.includes('Unauthorized')) {
        console.error('[HistoryView] Auth error detected - user may need to re-login');
        // Don't show alert - the app's auth state will handle this
        setHistory([]);
      } else {
        // Show alert for other types of errors
        alert(`Failed to load history: ${error?.message || 'Unknown error'}`);
        setHistory([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;

    try {
      console.log('[HistoryView] Deleting product:', id);

      await deleteProduct(id); // ✅ Use API endpoint

      console.log('[HistoryView] ✅ Product deleted successfully');

      // Update local state to remove the deleted item
      setHistory((prev) => prev.filter((scan) => scan.id !== id));
    } catch (error: any) {
      console.error('[HistoryView] ❌ Failed to delete product:', error);
      alert(`Failed to delete product: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to delete all scan history? This cannot be undone.')) return;

    try {
      console.log('[HistoryView] Clearing all history...');
      setLoading(true);

      // Delete all products via API endpoint
      const deletePromises = history.map(product => deleteProduct(product.id));
      await Promise.all(deletePromises);

      console.log('[HistoryView] ✅ All history cleared successfully');
      setHistory([]);
    } catch (error: any) {
      console.error('[HistoryView] ❌ Failed to clear history:', error);
      alert(`Failed to clear history: ${error?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const convertToScanResult = (product: ProductRow): ScanResult => {
    return {
      id: product.id, // Include ID for alternatives caching
      product_title: product.product_title || 'Unknown Product',
      product_url: product.product_url,
      ingredients: product.ingredients || '',
      grade: product.grade || 'C',
      numeric_grade: product.numeric_grade || 50,
      beneficial_ingredients: product.beneficial_ingredients || [],
      harmful_ingredients: product.issues || [],
      sources: product.sources || [],
      has_alternatives: !!product.product_alternatives && product.product_alternatives.length > 0,
      alternatives_count: product.product_alternatives?.length || 0,
      cached_alternatives: product.product_alternatives || []
    };
  };

  const getGradeColor = (grade: string | null) => {
    if (!grade) return 'bg-gray-100 text-gray-700 border-gray-300';
    if (grade.startsWith('A')) return 'bg-green-100 text-green-700 border-green-300';
    if (grade.startsWith('B')) return 'bg-lime-100 text-lime-700 border-lime-300';
    if (grade.startsWith('C')) return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    if (grade.startsWith('D')) return 'bg-orange-100 text-orange-700 border-orange-300';
    return 'bg-red-100 text-red-700 border-red-300';
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Filter history based on search query
  const filteredHistory = history.filter((product) => {
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    const title = (product.product_title || '').toLowerCase();
    const ingredients = (product.ingredients || '').toLowerCase();
    const grade = (product.grade || '').toLowerCase();

    return (
      title.includes(query) ||
      ingredients.includes(query) ||
      grade.includes(query)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-sage-200 border-t-sage-500 rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sage-600 text-sm">Loading history...</p>
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-12">
        <svg className="w-16 h-16 text-sage-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <h3 className="text-lg font-semibold text-sage-800 mb-2">No Scan History</h3>
        <p className="text-sage-600 text-sm">
          Your scanned products will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-sage-800">Scan History</h2>
          <div className="flex gap-2">
            <button
              onClick={loadHistory}
              className="text-xs text-sage-600 hover:text-sage-800 font-medium underline flex items-center gap-1"
              title="Refresh history"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
            <button
              onClick={handleClearAll}
              className="text-xs text-red-600 hover:text-red-800 font-medium underline"
            >
              Clear All
            </button>
            <button
              onClick={() => openWebApp('/dashboard')}
              className="text-xs text-sage-600 hover:text-sage-800 font-medium underline"
            >
              View on Web
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search products..."
            className="w-full border border-sage-300 rounded-lg pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-500"
          />
          <svg
            className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-sage-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-sage-400 hover:text-sage-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {searchQuery && (
          <p className="text-xs text-sage-600 mt-2">
            Found {filteredHistory.length} {filteredHistory.length === 1 ? 'result' : 'results'}
          </p>
        )}
      </div>

      <div className="grow overflow-y-auto space-y-3 pr-2">
        {filteredHistory.length === 0 && searchQuery ? (
          <div className="text-center py-8">
            <svg className="w-12 h-12 text-sage-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <h3 className="text-sm font-semibold text-sage-800 mb-1">No Results Found</h3>
            <p className="text-sage-600 text-xs mb-2">Try a different search term</p>
            <button
              onClick={() => setSearchQuery('')}
              className="text-xs text-sage-600 hover:text-sage-800 font-medium underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          filteredHistory.map((scan) => (
        <div
          key={scan.id}
          className="bg-sage-100 border border-sage-300 rounded-lg p-3 hover:shadow-md transition-shadow"
        >
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 min-w-0 pr-2">
              <h3 className="font-semibold text-sage-900 text-sm truncate mb-1">
                {scan.product_title || 'Unknown Product'}
              </h3>
              <p className="text-xs text-sage-500">{formatDate(scan.created_at)}</p>

              {/* Show alternatives badge if cached */}
              {scan.has_alternatives && scan.alternatives_count && scan.alternatives_count > 0 && (
                <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {scan.alternatives_count} Better Alternative{scan.alternatives_count !== 1 ? 's' : ''} Found
                </div>
              )}
            </div>
            <div className={`px-3 py-1 rounded-full text-sm font-bold border ${getGradeColor(scan.grade)}`}>
              {scan.grade || '—'}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onViewResult(convertToScanResult(scan))}
              className="flex-1 bg-sage-500 text-white py-1.5 rounded-lg text-xs font-medium hover:bg-sage-600 transition-colors"
            >
              View Details
            </button>

            {/* Show "View Alternatives" button if alternatives exist, otherwise show "Find" */}
            {onViewAlternatives && scan.has_alternatives && (
              <button
                onClick={() => onViewAlternatives(convertToScanResult(scan))}
                className="flex-1 bg-green-500 text-white py-1.5 rounded-lg text-xs font-medium hover:bg-green-600 transition-colors flex items-center justify-center gap-1"
                title="View cached alternatives"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                View Alternatives
              </button>
            )}

            <button
              onClick={() => handleDelete(scan.id)}
              className="px-3 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors"
              title="Delete scan"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
          ))
        )}
      </div>
    </div>
  );
}
