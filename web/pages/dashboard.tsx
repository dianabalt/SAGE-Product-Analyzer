// web/pages/dashboard.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import supabase from '../lib/supabaseClient';
import ProductTypeSelector from '../components/ProductTypeSelector';
import ProductTypeTag from '../components/ProductTypeTag';

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
  product_type: string | null; // FOOD or COSMETIC (for extraction pipeline, not user-facing)
  product_subtype: string | null; // User-facing category (5 options)
  custom_tag_name: string | null;
  custom_tag_color: string | null;
  alternatives_count?: number;
  has_alternatives?: boolean;
};

export default function Dashboard() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [ingredients, setIngredients] = useState(''); // optional
  const [saving, setSaving] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [avoidedIngredients, setAvoidedIngredients] = useState<string[]>([]);
  const [preferredIngredients, setPreferredIngredients] = useState<string[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterByType, setFilterByType] = useState<string>('');
  const [loadingAlternatives, setLoadingAlternatives] = useState<Record<string, boolean>>({});
  const [alternativesData, setAlternativesData] = useState<Record<string, any[]>>({});
  const [loadingDeals, setLoadingDeals] = useState<Record<string, boolean>>({});
  const [dealsData, setDealsData] = useState<Record<string, any[]>>({});
  const [expandedAlternatives, setExpandedAlternatives] = useState<Set<string>>(new Set());
  const [expandedDeals, setExpandedDeals] = useState<Set<string>>(new Set());

  // Manual edit state
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editIngredients, setEditIngredients] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const [editProductSubtype, setEditProductSubtype] = useState(''); // User-editable category
  const [editCustomTagName, setEditCustomTagName] = useState('');
  const [editCustomTagColor, setEditCustomTagColor] = useState('');

  // Product type classification state
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [pendingClassification, setPendingClassification] = useState<any>(null);
  const [selectedProductType, setSelectedProductType] = useState<'FOOD' | 'COSMETIC' | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.replace('/login');

      console.log('[Dashboard] Logged in user ID:', user.id);
      console.log('[Dashboard] User email:', user.email);

      // Extract first name from user metadata
      const metadata = user.user_metadata || {};
      const fullName = metadata.full_name || metadata.name || '';
      const firstName = fullName.split(' ')[0] || user.email?.split('@')[0] || 'User';
      setUserName(firstName);

      // Load avoided and preferred ingredients
      const avoided = metadata.avoided_ingredients || [];
      const preferred = metadata.preferred_ingredients || [];
      setAvoidedIngredients(avoided);
      setPreferredIngredients(preferred);

      const { data } = await supabase
        .from('products')
        .select(`
          *,
          product_alternatives!source_product_id (
            id
          )
        `)
        .order('created_at', { ascending: false });

      // Add alternatives_count and has_alternatives flags
      const productsWithAlternatives = (data || []).map(p => ({
        ...p,
        alternatives_count: Array.isArray(p.product_alternatives) ? p.product_alternatives.length : 0,
        has_alternatives: Array.isArray(p.product_alternatives) && p.product_alternatives.length > 0
      }));

      setProducts(productsWithAlternatives as ProductRow[]);
    })();
  }, [router]);

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const getGradeColor = (grade: string | null) => {
    if (!grade) return 'bg-gray-100 text-gray-700 border-gray-300';
    if (grade.startsWith('A')) return 'bg-green-100 text-green-700 border-green-300';
    if (grade.startsWith('B')) return 'bg-lime-100 text-lime-700 border-lime-300';
    if (grade.startsWith('C')) return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    if (grade.startsWith('D')) return 'bg-orange-100 text-orange-700 border-orange-300';
    return 'bg-red-100 text-red-700 border-red-300';
  };

  const getNumericScore = (product: ProductRow): number | null => {
    // If numeric_grade exists, use it
    if (product.numeric_grade !== null && product.numeric_grade !== undefined) {
      return product.numeric_grade;
    }

    // Fallback: calculate from letter grade
    if (!product.grade) return null;
    const grade = product.grade;

    if (grade === 'A+') return 98;
    if (grade === 'A') return 95;
    if (grade === 'A-') return 92;
    if (grade === 'B+') return 88;
    if (grade === 'B') return 85;
    if (grade === 'B-') return 82;
    if (grade === 'C+') return 78;
    if (grade === 'C') return 75;
    if (grade === 'C-') return 72;
    if (grade === 'D+') return 68;
    if (grade === 'D') return 65;
    if (grade === 'D-') return 62;
    if (grade === 'F') return 50;

    return null;
  };

  const isAvoidedIngredient = (ingredient: string) => {
    return avoidedIngredients.some(avoided =>
      ingredient.toLowerCase().includes(avoided.toLowerCase()) ||
      avoided.toLowerCase().includes(ingredient.toLowerCase())
    );
  };

  const isPreferredIngredient = (ingredient: string) => {
    return preferredIngredients.some(preferred =>
      ingredient.toLowerCase().includes(preferred.toLowerCase()) ||
      preferred.toLowerCase().includes(ingredient.toLowerCase())
    );
  };

  // Filter products based on search query
  const filteredProducts = products.filter((product) => {
    // Filter by product subtype if selected
    if (filterByType && product.product_subtype !== filterByType) {
      return false;
    }

    // Filter by search query
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    const title = (product.product_title || '').toLowerCase();
    const url = (product.product_url || '').toLowerCase();
    const ingredients = (product.ingredients || '').toLowerCase();
    const grade = (product.grade || '').toLowerCase();

    return (
      title.includes(query) ||
      url.includes(query) ||
      ingredients.includes(query) ||
      grade.includes(query)
    );
  });

  const deleteProduct = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;

    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setProducts(prev => prev.filter(p => p.id !== id));
      setSelectedProducts(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    } catch (e: any) {
      alert(e?.message || 'Failed to delete product');
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedProducts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedProducts.size === products.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(products.map(p => p.id)));
    }
  };

  const deleteSelected = async () => {
    if (selectedProducts.size === 0) return;

    if (!confirm(`Are you sure you want to delete ${selectedProducts.size} product(s)? This cannot be undone.`)) return;

    try {
      const idsToDelete = Array.from(selectedProducts);

      const { error } = await supabase
        .from('products')
        .delete()
        .in('id', idsToDelete);

      if (error) throw error;

      setProducts(prev => prev.filter(p => !selectedProducts.has(p.id)));
      setSelectedProducts(new Set());
      setIsSelectionMode(false);
    } catch (e: any) {
      alert(e?.message || 'Failed to delete products');
    }
  };

  const fetchAlternatives = async (product: ProductRow) => {
    try {
      setLoadingAlternatives(prev => ({ ...prev, [product.id]: true }));

      const response = await fetch('/api/find-alternatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          product_id: product.id,
          product_title: product.product_title,
          product_url: product.product_url,
          numeric_grade: product.numeric_grade,
          grade: product.grade,
          ingredients: product.ingredients
        })
      });

      const data = await response.json();

      if (data.success && data.alternatives) {
        setAlternativesData(prev => ({ ...prev, [product.id]: data.alternatives }));
        setExpandedAlternatives(prev => new Set(prev).add(product.id));
      } else {
        alert(data.message || 'No better alternatives found.');
      }
    } catch (error: any) {
      alert(error.message || 'Failed to load alternatives');
    } finally {
      setLoadingAlternatives(prev => ({ ...prev, [product.id]: false }));
    }
  };

  const fetchDeals = async (product: ProductRow) => {
    try {
      setLoadingDeals(prev => ({ ...prev, [product.id]: true }));

      const response = await fetch('/api/find-deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          product_id: product.id,
          product_title: product.product_title
        })
      });

      const data = await response.json();

      if (data.success && data.deals) {
        setDealsData(prev => ({ ...prev, [product.id]: data.deals }));
        setExpandedDeals(prev => new Set(prev).add(product.id));
      } else {
        alert(data.message || 'No deals found.');
      }
    } catch (error: any) {
      alert(error.message || 'Failed to load deals');
    } finally {
      setLoadingDeals(prev => ({ ...prev, [product.id]: false }));
    }
  };

  const toggleAlternativesExpanded = (productId: string) => {
    setExpandedAlternatives(prev => {
      const newSet = new Set(prev);
      if (newSet.has(productId)) {
        newSet.delete(productId);
      } else {
        newSet.add(productId);
      }
      return newSet;
    });
  };

  const toggleDealsExpanded = (productId: string) => {
    setExpandedDeals(prev => {
      const newSet = new Set(prev);
      if (newSet.has(productId)) {
        newSet.delete(productId);
      } else {
        newSet.add(productId);
      }
      return newSet;
    });
  };

  const handleEditProduct = (product: ProductRow) => {
    setEditingProduct(product);
    setEditName(product.product_title || '');
    setEditIngredients(product.ingredients || '');
    setEditProductSubtype(product.product_subtype || '');
    setEditCustomTagName(product.custom_tag_name || '');
    setEditCustomTagColor(product.custom_tag_color || '');
    setEditError('');
  };

  const handleCancelEdit = () => {
    setEditingProduct(null);
    setEditName('');
    setEditIngredients('');
    setEditProductSubtype('');
    setEditCustomTagName('');
    setEditCustomTagColor('');
    setEditError('');
    setIsSavingEdit(false);
  };

  const handleSaveEdit = async () => {
    if (!editingProduct) return;

    // Validation
    if (!editName.trim()) {
      setEditError('Please enter a product name');
      return;
    }

    if (!editIngredients.trim()) {
      setEditError('Please enter ingredients');
      return;
    }

    if (!editIngredients.includes(',')) {
      setEditError('Please separate ingredients with commas');
      return;
    }

    setIsSavingEdit(true);
    setEditError('');

    try {
      console.log('[Dashboard] Saving edits for product:', editingProduct.id);

      const response = await fetch(`/api/products/${editingProduct.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          product_title: editName.trim(),
          ingredients: editIngredients.trim(),
          product_subtype: editProductSubtype || null, // User-editable category
          custom_tag_name: editCustomTagName.trim() || null,
          custom_tag_color: editCustomTagColor || null
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[Dashboard] Update failed:', errorData);
        throw new Error(errorData.error || 'Failed to update product');
      }

      const data = await response.json();
      console.log('[Dashboard] Edit successful:', data);

      // Update product in local state
      setProducts(prev =>
        prev.map(p =>
          p.id === editingProduct.id
            ? {
                ...p,
                product_title: data.product.product_title,
                ingredients: data.product.ingredients,
                grade: data.product.grade,
                numeric_grade: data.product.numeric_grade,
                beneficial_ingredients: data.product.beneficial_ingredients,
                issues: data.product.issues,
                analysis: data.product.analysis,
                product_subtype: data.product.product_subtype, // User-facing category
                custom_tag_name: data.product.custom_tag_name,
                custom_tag_color: data.product.custom_tag_color
              }
            : p
        )
      );

      // Close modal
      handleCancelEdit();
    } catch (error: any) {
      console.error('[Dashboard] Error saving edits:', error);
      setEditError(error.message || 'Failed to save edits');
      setIsSavingEdit(false);
    }
  };

  const save = async () => {
    if (!url) return alert('Please paste a product URL');
    try {
      setSaving(true);
      setLoadingStage('Analyzing URL');

      const payload: {
        product_url: string;
        product_title: string | null;
        ingredients: string | null;
        product_type?: 'FOOD' | 'COSMETIC';
        product_subtype?: string;
      } = {
        product_url: url,
        product_title: title || null,   // only used as hint for name
        ingredients: ingredients || null,
        product_type: selectedProductType || undefined, // Include user selection if exists
        product_subtype: undefined // Will be populated from resolve-ingredients
      };

      // A) Try page resolver
      try {
        const r1 = await fetch('/api/resolve-ingredients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            product_url: payload.product_url,
            product_title: payload.product_title,
          }),
        });
        const auto = await r1.json();
        if (auto?.ingredients) {
          payload.ingredients ??= auto.ingredients; // keep user-typed if present
        }
        // Capture product name from resolve-ingredients (prioritize extracted name over user input)
        if (auto?.productName && !title) {
          payload.product_title = auto.productName;
          console.log('[Dashboard] Using extracted product name:', auto.productName);
        }
        // Capture product type and subtype from resolve-ingredients (if not manually selected)
        if (auto?.productType && !selectedProductType) {
          payload.product_type = auto.productType;
          console.log('[Dashboard] Using extracted product type:', auto.productType);
        }
        if (auto?.productSubtype) {
          payload.product_subtype = auto.productSubtype;
          console.log('[Dashboard] Using extracted product subtype:', auto.productSubtype);
        }
      } catch {}

      // Update stage for research phase
      setLoadingStage('Researching ingredients');

      // B) Save (server may research+grade if needed)
      // Start a timer to update stage to "Grading" after 8 seconds
      const gradeTimer = setTimeout(() => {
        setLoadingStage('Grading product');
      }, 8000);

      const saveTimer = setTimeout(() => {
        setLoadingStage('Saving');
      }, 20000);

      try {
        const r2 = await fetch('/api/save-product', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const out = await r2.json();

        clearTimeout(gradeTimer);
        clearTimeout(saveTimer);

        // Check if GPT classification needs user input
        if (out.needsUserInput) {
          console.log('[Dashboard] GPT needs user input, showing type selector');
          setPendingClassification(out);
          setShowTypeSelector(true);
          // Keep saving state active and loading stage visible
          return;
        }

        if (out.error) return alert(out.error);

        // Show warning if ingredients couldn't be found
        if (out.warning === 'no-ingredients-found') {
          alert(out.message || 'Ingredients could not be automatically extracted. Please use the SAGE Chrome Extension to scan the product image for better results.');
        }

        setProducts(prev => [out.product as ProductRow, ...prev]);
        setTitle(''); setUrl(''); setIngredients('');
        setSelectedProductType(null); // Reset for next scan
      } catch (e) {
        clearTimeout(gradeTimer);
        clearTimeout(saveTimer);
        throw e;
      }
    } finally {
      setSaving(false);
      setLoadingStage('');
    }
  };

  // Handle product type selection from user
  const handleTypeSelect = async (type: 'FOOD' | 'COSMETIC') => {
    console.log('[Dashboard] User selected product type:', type);
    setSelectedProductType(type);
    setShowTypeSelector(false);
    setPendingClassification(null);

    // Retry save with user-selected type
    // The selectedProductType will be included in the next save() call
    await save();
  };

  // Handle type selector cancel
  const handleTypeCancel = () => {
    setShowTypeSelector(false);
    setPendingClassification(null);
    setSelectedProductType(null);
    setSaving(false);
    setLoadingStage('');
  };

  return (
    <div className="min-h-screen bg-sage-bg">
      {/* Header */}
      <header className="bg-gradient-to-r from-sage-500 to-sage-600 shadow-lg">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="bg-white p-2 rounded-lg shadow-md">
                <svg
                  className="w-8 h-8 text-sage-600"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2c-5 4-6.5 9-4.9 13.2 1.1 2.9 3.2 5 4.9 6.8 1.7-1.8 3.8-3.9 4.9-6.8C18.5 11 17 6 12 2z" />
                  <path d="M12 4v13" />
                  <path d="M12 7c-2 .7-3.5 2-4.7 3.8" />
                  <path d="M12 10c-1.7.6-3 1.7-3.9 3" />
                  <path d="M12 13c-1 .5-1.8 1.2-2.5 2.2" />
                  <path d="M12 7c2 .7 3.5 2 4.7 3.8" />
                  <path d="M12 10c1.7.6 3 1.7 3.9 3" />
                  <path d="M12 13c1 .5 1.8 1.2 2.5 2.2" />
                  <path d="M12 20v2.5" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">SAGE</h1>
                <p className="text-sage-100 text-sm">Hi, {userName}!</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/settings')}
                className="bg-white text-sage-700 px-4 py-2 rounded-lg font-medium hover:bg-sage-50 transition-colors shadow-md flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Settings
              </button>
              <button
                onClick={logout}
                className="bg-white text-sage-700 px-4 py-2 rounded-lg font-medium hover:bg-sage-50 transition-colors shadow-md"
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Add Product Card */}
        <div className="bg-white rounded-xl shadow-md p-6 mb-8 border border-sage-200">
          <h2 className="text-xl font-bold text-sage-800 mb-4">Add a Product</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-sage-700 mb-2">
                Product Title (optional)
              </label>
              <input
                className="w-full border border-sage-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sage-500 focus:border-transparent"
                placeholder="Enter product name for your reference"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-sage-700 mb-2">
                Product URL <span className="text-red-500">*</span>
              </label>
              <input
                className="w-full border border-sage-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sage-500 focus:border-transparent"
                placeholder="https://example.com/product"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-sage-700 mb-2">
                Ingredients (optional)
              </label>
              <textarea
                className="w-full border border-sage-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sage-500 focus:border-transparent"
                placeholder="Paste ingredient list if you have it"
                rows={3}
                value={ingredients}
                onChange={(e) => setIngredients(e.target.value)}
              />
            </div>

            <button
              disabled={saving}
              className="w-full bg-sage-500 text-white py-3 rounded-lg font-semibold hover:bg-sage-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-md"
              onClick={save}
            >
              {saving ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 border-3 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>{loadingStage}</span>
                </span>
              ) : (
                'Analyze Product'
              )}
            </button>
          </div>

          {/* Product Type Selector - shown inline during scan when GPT confidence is low */}
          {saving && showTypeSelector && pendingClassification && (
            <ProductTypeSelector
              productName={pendingClassification.productName}
              suggestedType={pendingClassification.suggestedType}
              confidence={pendingClassification.confidence}
              reasoning={pendingClassification.reasoning}
              onSelect={handleTypeSelect}
              onCancel={handleTypeCancel}
            />
          )}
        </div>

        {/* Products List */}
        <div className="space-y-4">
          {/* Search and Header */}
          <div className="bg-white rounded-xl shadow-md p-4 border border-sage-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-2xl font-bold text-sage-800">
                Your Products {products.length > 0 && `(${products.length})`}
              </h2>
            </div>

            {/* Search Bar with Filter */}
            <div className="flex gap-3">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by product name, ingredients, grade..."
                  className="w-full border border-sage-300 rounded-lg pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sage-500"
                />
                <svg
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-sage-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-sage-400 hover:text-sage-600"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Filter Dropdown */}
              <div className="relative">
                <select
                  value={filterByType}
                  onChange={(e) => setFilterByType(e.target.value)}
                  className="border border-sage-300 rounded-lg px-4 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-sage-500 bg-white appearance-none cursor-pointer"
                >
                  <option value="">All Products</option>
                  <option value="COSMETIC">Cosmetic</option>
                  <option value="SKINCARE">Skincare</option>
                  <option value="HEALTH_SUPPLEMENT">Health Supplements</option>
                  <option value="FOOD">Food</option>
                  <option value="BEAUTY">Beauty</option>
                </select>
                <svg
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-sage-400 pointer-events-none"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {(searchQuery || filterByType) && (
              <p className="text-sm text-sage-600 mt-2">
                Found {filteredProducts.length} {filteredProducts.length === 1 ? 'product' : 'products'}
                {filterByType && ` in ${filterByType.toLowerCase().replace('_', ' ')}`}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between mb-4">
            {products.length > 0 && (
              <div className="flex items-center gap-3">
                {isSelectionMode && selectedProducts.size > 0 && (
                  <>
                    <span className="text-sm text-sage-600 font-medium">
                      {selectedProducts.size} selected
                    </span>
                    <button
                      onClick={deleteSelected}
                      className="bg-red-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-600 transition-colors shadow-md flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete Selected
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    setIsSelectionMode(!isSelectionMode);
                    if (isSelectionMode) {
                      setSelectedProducts(new Set());
                    }
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors shadow-md ${
                    isSelectionMode
                      ? 'bg-sage-200 text-sage-800 hover:bg-sage-300'
                      : 'bg-sage-500 text-white hover:bg-sage-600'
                  }`}
                >
                  {isSelectionMode ? 'Cancel' : 'Select Multiple'}
                </button>
              </div>
            )}
          </div>

          {products.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center border border-sage-200">
              <svg className="w-16 h-16 text-sage-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <h3 className="text-lg font-semibold text-sage-800 mb-2">No Products Yet</h3>
              <p className="text-sage-600">Add your first product above to get started!</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center border border-sage-200">
              <svg className="w-16 h-16 text-sage-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <h3 className="text-lg font-semibold text-sage-800 mb-2">No Results Found</h3>
              <p className="text-sage-600">Try a different search term</p>
              <button
                onClick={() => setSearchQuery('')}
                className="mt-4 text-sage-600 hover:text-sage-800 font-medium underline"
              >
                Clear search
              </button>
            </div>
          ) : (
            <>
              {/* Select All Checkbox (shown only in selection mode) */}
              {isSelectionMode && (
                <div className="bg-sage-50 border border-sage-300 rounded-lg p-4 mb-4 flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedProducts.size === filteredProducts.length && filteredProducts.length > 0}
                    onChange={toggleSelectAll}
                    className="w-5 h-5 text-sage-600 border-sage-300 rounded focus:ring-sage-500 cursor-pointer"
                  />
                  <label className="text-sm font-medium text-sage-700 cursor-pointer" onClick={toggleSelectAll}>
                    Select All ({filteredProducts.length} products)
                  </label>
                </div>
              )}

              {filteredProducts.map((p) => (
                <div
                  key={p.id}
                  className={`bg-white rounded-xl shadow-md hover:shadow-lg transition-all p-6 border ${
                    selectedProducts.has(p.id) ? 'border-sage-500 ring-2 ring-sage-300' : 'border-sage-200'
                  } relative`}
                >
                  {/* Selection Checkbox (shown only in selection mode) */}
                  {isSelectionMode && (
                    <div className="absolute top-4 left-4 z-10">
                      <input
                        type="checkbox"
                        checked={selectedProducts.has(p.id)}
                        onChange={() => toggleSelection(p.id)}
                        className="w-5 h-5 text-sage-600 border-sage-300 rounded focus:ring-sage-500 cursor-pointer"
                      />
                    </div>
                  )}

                  {/* Delete button in top-right corner (hidden in selection mode) */}
                  {!isSelectionMode && (
                    <button
                      onClick={() => deleteProduct(p.id)}
                      className="absolute top-4 right-4 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete product"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}

                <div className={`flex items-start justify-between mb-3 ${isSelectionMode ? 'pl-10' : ''} pr-8`}>
                  <div className="flex-1 min-w-0 pr-4">
                    <h3 className="text-lg font-bold text-sage-900 mb-1 truncate">
                      {p.product_title || 'Unknown Product'}
                    </h3>
                    <div className="mb-2">
                      <ProductTypeTag
                        productType={p.product_subtype}
                        customName={p.custom_tag_name}
                        customColor={p.custom_tag_color}
                        size="sm"
                      />
                    </div>
                    <a
                      href={p.product_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-sage-600 hover:text-sage-800 hover:underline truncate block"
                    >
                      {p.product_url}
                    </a>
                    <p className="text-xs text-sage-500 mt-1">
                      {new Date(p.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>

                  <div className={`px-4 py-2 rounded-full text-lg font-bold border-2 ${getGradeColor(p.grade)}`}>
                    {p.grade || '—'}
                  </div>
                </div>

                {(() => {
                  const numericScore = getNumericScore(p);
                  return numericScore !== null && (
                    <div className="mb-3">
                      <div className="flex items-center gap-2 text-sm text-sage-700">
                        <span className="font-medium">Score:</span>
                        <div className="flex-1 bg-sage-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-sage-500 h-full transition-all"
                            style={{ width: `${numericScore}%` }}
                          />
                        </div>
                        <span className="font-bold">{numericScore}/100</span>
                      </div>
                    </div>
                  );
                })()}

                {Array.isArray(p.beneficial_ingredients) && p.beneficial_ingredients.length > 0 && (
                  <div className="mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span className="font-semibold text-green-700">Beneficial Ingredients</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {p.beneficial_ingredients.map((ing, idx) => {
                        const isPreferred = isPreferredIngredient(ing);
                        return (
                          <button
                            key={idx}
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(`https://www.google.com/search?q=${encodeURIComponent(ing + ' ingredient cosmetic safety')}`, '_blank', 'noopener,noreferrer');
                            }}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold shadow-sm cursor-pointer hover:opacity-90 transition-opacity ${
                              isPreferred
                                ? 'bg-green-600 text-white border-2 border-green-800'
                                : 'bg-green-500 text-white'
                            }`}
                            title={`Click to learn more about ${ing}${isPreferred ? ' (in your preferred list)' : ''}`}
                          >
                            {ing}
                            {isPreferred && (
                              <svg className="inline-block w-3 h-3 ml-1" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {Array.isArray(p.issues) && p.issues.length > 0 ? (
                  <div className="mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <span className="font-semibold text-red-700">Concerning Ingredients</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {p.issues.map((issue, idx) => {
                        const isAvoided = isAvoidedIngredient(issue);
                        return (
                          <button
                            key={idx}
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(`https://www.google.com/search?q=${encodeURIComponent(issue + ' ingredient safety concerns')}`, '_blank', 'noopener,noreferrer');
                            }}
                            className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer hover:opacity-90 transition-opacity ${
                              isAvoided
                                ? 'bg-red-700 text-white border-2 border-red-900 shadow-md'
                                : 'bg-red-100 text-red-700'
                            }`}
                            title={`Click to learn more about ${issue}${isAvoided ? ' (in your avoid list)' : ''}`}
                          >
                            {issue}
                            {isAvoided && (
                              <svg className="inline-block w-3 h-3 ml-1" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : p.ingredients ? (
                  <div className="mb-3">
                    <div className="flex items-center gap-2 text-green-600">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm font-medium">No concerning ingredients found</span>
                    </div>
                  </div>
                ) : (
                  <div className="mb-3">
                    <div className="flex items-center gap-2 text-yellow-600 bg-yellow-50 p-3 rounded-lg">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm font-medium">No ingredients found - try using the SAGE Chrome Extension</span>
                    </div>
                  </div>
                )}

                {/* Grade Explanation */}
                {p.grade_explanation && (
                  <div className="mt-4 p-4 bg-sage-50 rounded-lg border border-sage-200">
                    <div className="flex items-center mb-2">
                      <svg className="w-5 h-5 text-sage-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      <h4 className="font-semibold text-sage-800">Why This Grade?</h4>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      {p.grade_explanation}
                    </p>
                  </div>
                )}

                {Array.isArray(p.sources) && p.sources.length > 0 && (
                  <div className="text-xs text-sage-500 mb-2">
                    <span className="font-medium">Sources:</span> {p.sources.join(', ')}
                  </div>
                )}

                {p.ingredients && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-sage-700 hover:text-sage-900 select-none">
                      View Full Ingredient List
                    </summary>
                    <div className="mt-2 text-sm text-sage-600 bg-sage-50 p-3 rounded-lg break-words">
                      {p.ingredients}
                    </div>
                  </details>
                )}

                {/* Action Buttons */}
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {/* Find Better Alternatives Button */}
                  <button
                    onClick={() => {
                      if (alternativesData[p.id]) {
                        toggleAlternativesExpanded(p.id);
                      } else {
                        fetchAlternatives(p);
                      }
                    }}
                    disabled={loadingAlternatives[p.id]}
                    className="w-full py-2.5 rounded-lg font-medium transition-colors shadow-md flex items-center justify-center gap-2"
                    style={{ backgroundColor: '#7e9a7c', color: 'white' }}
                  >
                    {loadingAlternatives[p.id] ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        {expandedAlternatives.has(p.id)
                          ? 'Hide Alternatives'
                          : p.has_alternatives
                          ? 'View Alternatives'
                          : 'Find Better Alternatives'}
                      </>
                    )}
                  </button>

                  {/* Find the Best Deal Button */}
                  <button
                    onClick={() => {
                      if (dealsData[p.id]) {
                        toggleDealsExpanded(p.id);
                      } else {
                        fetchDeals(p);
                      }
                    }}
                    disabled={loadingDeals[p.id]}
                    className="w-full bg-sage-600 text-white py-2.5 rounded-lg font-medium hover:bg-sage-700 transition-colors shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loadingDeals[p.id] ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                        {dealsData[p.id] ? (expandedDeals.has(p.id) ? 'Hide' : 'Show') + ' Deals' : 'Find Best Deal'}
                      </>
                    )}
                  </button>

                  {/* Manually Edit Button */}
                  <button
                    onClick={() => handleEditProduct(p)}
                    className="col-span-2 w-full bg-white border-2 border-sage-500 text-sage-700 py-2.5 rounded-lg font-medium hover:bg-sage-50 transition-colors shadow-md flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Manually Edit
                  </button>
                </div>

                {/* Alternatives Display */}
                {alternativesData[p.id] && expandedAlternatives.has(p.id) && (
                  <div className="mt-4 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-300 rounded-lg p-4">
                    <h4 className="font-bold text-green-900 mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Better Alternatives ({alternativesData[p.id].length})
                    </h4>

                    <div className="space-y-3">
                      {alternativesData[p.id].map((alt: any, idx: number) => (
                        <div key={idx} className="bg-white border border-green-200 rounded-lg p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1 mr-3">
                              <h5 className="font-semibold text-sage-900 text-sm leading-tight mb-1">
                                {alt.title}
                              </h5>
                              {idx === 0 && (
                                <span className="inline-block px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs font-medium rounded">
                                  ⭐ Top Pick
                                </span>
                              )}
                            </div>
                            <div className={`px-3 py-1 rounded-lg text-sm font-bold border ${getGradeColor(alt.grade)}`}>
                              {alt.grade}
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-sm mb-2">
                            <span className="text-sage-600">Safety Score:</span>
                            <span className="font-bold text-sage-800">{alt.numeric_grade}/100</span>
                          </div>

                          <div className="w-full bg-gray-200 rounded-full h-2 mb-3 overflow-hidden">
                            <div
                              className={`h-full transition-all ${alt.numeric_grade >= 90 ? 'bg-green-500' : alt.numeric_grade >= 80 ? 'bg-sage-500' : 'bg-yellow-500'}`}
                              style={{ width: `${alt.numeric_grade}%` }}
                            />
                          </div>

                          {alt.numeric_grade && p.numeric_grade && (
                            <div className="mb-3 bg-green-50 border border-green-200 rounded px-3 py-2">
                              <p className="text-xs text-green-800 font-medium">
                                <span className="font-bold">+{alt.numeric_grade - p.numeric_grade} points</span> better than your current product
                              </p>
                            </div>
                          )}

                          {/* Beneficial Ingredients */}
                          {alt.beneficial_ingredients && alt.beneficial_ingredients.length > 0 && (
                            <div className="mb-3">
                              <p className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-1">
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                Beneficial Ingredients
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {alt.beneficial_ingredients.map((ing: string, i: number) => (
                                  <span key={i} className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                                    {ing}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Concerning Ingredients */}
                          {alt.harmful_ingredients && alt.harmful_ingredients.length > 0 && (
                            <div className="mb-3">
                              <p className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1">
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                                Concerning Ingredients
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {alt.harmful_ingredients.map((ing: string, i: number) => (
                                  <span key={i} className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">
                                    {ing}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Full Ingredient List */}
                          {alt.ingredients && (
                            <details className="mb-3">
                              <summary className="cursor-pointer text-xs font-medium text-sage-700 hover:text-sage-900 select-none flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                                View Full Ingredient List
                              </summary>
                              <div className="mt-2 text-xs text-sage-600 bg-sage-50 p-3 rounded-lg break-words border border-sage-200">
                                {alt.ingredients}
                              </div>
                            </details>
                          )}

                          <a
                            href={alt.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block w-full bg-green-600 text-white py-2 rounded-lg font-medium hover:bg-green-700 transition-colors text-center text-sm"
                          >
                            View Product Details →
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Deals Display */}
                {dealsData[p.id] && expandedDeals.has(p.id) && (
                  <div className="mt-4 bg-blue-50 border-2 border-blue-300 rounded-lg p-4">
                    <h4 className="font-bold text-blue-900 mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                        <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0015 7h-1z" />
                      </svg>
                      Best Deals ({dealsData[p.id].length})
                    </h4>

                    <div className="space-y-2">
                      {dealsData[p.id].map((deal: any, idx: number) => (
                        <div key={idx} className="bg-white border-2 border-blue-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                          {/* Retailer Badge */}
                          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 mb-3">
                            <span className="text-base">
                              {deal.retailer === 'Amazon' ? '📦' :
                               deal.retailer === 'Walmart' ? '🛒' :
                               deal.retailer === 'Target' ? '🎯' :
                               deal.retailer === 'Sephora' ? '💄' :
                               deal.retailer === 'Ulta' ? '✨' : '🏪'}
                            </span>
                            <p className="font-bold text-blue-900 text-sm">{deal.retailer}</p>
                          </div>

                          {/* Product Name and Size */}
                          {(deal.display_name || deal.product_name || deal.title) && (
                            <div className="mb-3">
                              <p className="text-sm font-semibold text-sage-900">
                                {deal.display_name || deal.product_name || deal.title}
                              </p>
                            </div>
                          )}

                          {/* Price Info */}
                          <div className="flex items-baseline justify-between mb-3">
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
                            {idx === 0 && dealsData[p.id].length > 1 && deal.price && (
                              <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded">
                                Best Value
                              </span>
                            )}
                          </div>
                          <a
                            href={deal.deal_url}
                            target="_blank"
                            rel="noreferrer"
                            className="block w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors text-center text-sm"
                          >
                            {deal.price ? `Buy for $${deal.price.toFixed(2)} →` : `Check Price at ${deal.retailer} →`}
                          </a>
                        </div>
                      ))}
                    </div>

                    <p className="text-xs text-blue-700 mt-3 bg-blue-50 p-2 rounded border border-blue-200">
                      ⚠️ <strong>Important:</strong> Prices are scraped in real-time but may vary by size, variant, or store location. Always verify the final price and product details on the retailer's website before purchasing.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </>
          )}
        </div>
      </main>

      {/* Edit Product Modal */}
      {editingProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {isSavingEdit ? (
              <div className="text-center py-12 px-6">
                <div className="w-20 h-20 mx-auto mb-4 relative">
                  <div className="absolute inset-0 border-4 border-sage-200 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-sage-500 rounded-full border-t-transparent animate-spin"></div>
                </div>
                <p className="text-sage-700 font-medium text-lg">Re-grading ingredients...</p>
                <p className="text-sage-500 text-sm mt-2">AI is analyzing your updated ingredient list</p>
              </div>
            ) : (
              <>
                <div className="p-6 border-b border-sage-200">
                  <h2 className="text-2xl font-bold text-sage-800">Manually Edit Product</h2>
                  <p className="text-sage-600 text-sm mt-1">
                    Update product details and ingredients
                  </p>
                </div>

                <div className="p-6 space-y-4">
                  {editError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-red-700 text-sm">{editError}</p>
                    </div>
                  )}

                  {/* Product Name Input */}
                  <div>
                    <label htmlFor="editProductName" className="block text-sm font-medium text-sage-800 mb-1.5">
                      Product Name
                    </label>
                    <input
                      id="editProductName"
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="e.g., CeraVe Moisturizing Cream"
                      className="w-full px-3 py-2.5 border-2 border-sage-300 rounded-lg focus:outline-none focus:border-sage-500 text-sage-900 placeholder-sage-400"
                    />
                  </div>

                  {/* Product Type Tag Section */}
                  <div className="border-2 border-sage-200 rounded-lg p-4 bg-sage-50">
                    <h3 className="text-sm font-semibold text-sage-800 mb-3 flex items-center gap-2">
                      <span>🏷️</span>
                      <span>Product Tag</span>
                    </h3>

                    {/* Product Category Selector */}
                    <div className="mb-3">
                      <label htmlFor="editProductSubtype" className="block text-xs font-medium text-sage-700 mb-1.5">
                        Product Category
                      </label>
                      <select
                        id="editProductSubtype"
                        value={editProductSubtype}
                        onChange={(e) => setEditProductSubtype(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-sage-300 rounded-lg focus:outline-none focus:border-sage-500 text-sage-900 bg-white"
                      >
                        <option value="">-- Select Category --</option>
                        <option value="COSMETIC">Cosmetic (Makeup)</option>
                        <option value="SKINCARE">Skincare</option>
                        <option value="HEALTH_SUPPLEMENT">Health Supplement</option>
                        <option value="FOOD">Food</option>
                        <option value="BEAUTY">Beauty (Hair/Nails)</option>
                      </select>
                    </div>

                    {/* Custom Tag Name */}
                    <div className="mb-3">
                      <label htmlFor="editCustomTagName" className="block text-xs font-medium text-sage-700 mb-1.5">
                        Custom Tag Name (Optional)
                      </label>
                      <input
                        id="editCustomTagName"
                        type="text"
                        value={editCustomTagName}
                        onChange={(e) => setEditCustomTagName(e.target.value)}
                        placeholder="e.g., Organic Food, Vegan Cosmetic"
                        className="w-full px-3 py-2 border-2 border-sage-300 rounded-lg focus:outline-none focus:border-sage-500 text-sage-900 placeholder-sage-400 text-sm"
                      />
                      <p className="text-xs text-sage-600 mt-1">Leave empty to use default name</p>
                    </div>

                    {/* Custom Tag Color */}
                    <div>
                      <label htmlFor="editCustomTagColor" className="block text-xs font-medium text-sage-700 mb-1.5">
                        Custom Tag Color (Optional)
                      </label>
                      <div className="flex gap-2 items-center">
                        <input
                          id="editCustomTagColor"
                          type="color"
                          value={editCustomTagColor || '#7e9a7c'}
                          onChange={(e) => setEditCustomTagColor(e.target.value)}
                          className="h-10 w-16 border-2 border-sage-300 rounded cursor-pointer"
                        />
                        <input
                          type="text"
                          value={editCustomTagColor}
                          onChange={(e) => setEditCustomTagColor(e.target.value)}
                          placeholder="#7e9a7c"
                          className="flex-1 px-3 py-2 border-2 border-sage-300 rounded-lg focus:outline-none focus:border-sage-500 text-sage-900 placeholder-sage-400 text-sm font-mono"
                        />
                        {editCustomTagColor && (
                          <button
                            onClick={() => setEditCustomTagColor('')}
                            className="px-3 py-2 text-sm text-sage-600 hover:text-sage-800 hover:bg-sage-100 rounded-lg transition"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-sage-600 mt-1">Leave empty to use default color</p>
                    </div>

                    {/* Preview */}
                    {editProductSubtype && (
                      <div className="mt-3 pt-3 border-t border-sage-300">
                        <p className="text-xs font-medium text-sage-700 mb-2">Preview:</p>
                        <ProductTypeTag
                          productType={editProductSubtype}
                          customName={editCustomTagName}
                          customColor={editCustomTagColor}
                          size="md"
                        />
                      </div>
                    )}
                  </div>

                  {/* Instructions */}
                  <div className="bg-sage-50 border border-sage-200 rounded-lg p-3">
                    <p className="text-sage-700 text-xs leading-relaxed">
                      Please enter the ingredient list separated by commas. Changes will trigger automatic re-grading.
                    </p>
                  </div>

                  {/* Ingredients Textarea */}
                  <div>
                    <label htmlFor="editIngredients" className="block text-sm font-medium text-sage-800 mb-1.5">
                      Ingredients
                    </label>
                    <textarea
                      id="editIngredients"
                      value={editIngredients}
                      onChange={(e) => setEditIngredients(e.target.value)}
                      placeholder="Water, Glycerin, Sodium Hyaluronate, ..."
                      rows={10}
                      className="w-full px-3 py-2.5 border-2 border-sage-300 rounded-lg focus:outline-none focus:border-sage-500 text-sage-900 placeholder-sage-400 resize-none text-sm font-mono"
                    />
                    <p className="text-sage-500 text-xs mt-1">
                      {editIngredients.split(',').filter(i => i.trim()).length} ingredients
                    </p>
                  </div>
                </div>

                <div className="p-6 border-t border-sage-200 flex gap-3">
                  <button
                    onClick={handleCancelEdit}
                    disabled={isSavingEdit}
                    className="flex-1 bg-sage-100 border-2 border-sage-400 text-sage-800 py-2.5 rounded-lg font-medium hover:bg-sage-200 hover:border-sage-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={isSavingEdit}
                    className="flex-1 bg-gradient-to-r from-sage-500 to-sage-600 text-white py-2.5 rounded-lg font-medium hover:from-sage-600 hover:to-sage-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save Changes
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
