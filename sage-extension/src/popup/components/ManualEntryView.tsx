import { useState } from 'react';
import { manualGrade } from '../../lib/api';
import { ScanResult } from '../../types';

interface ManualEntryViewProps {
  productName?: string;
  existingIngredients?: string;
  onComplete: (result: ScanResult) => void;
  onCancel: () => void;
}

export default function ManualEntryView({ productName, existingIngredients, onComplete, onCancel }: ManualEntryViewProps) {
  const [name, setName] = useState(productName || '');
  const [ingredients, setIngredients] = useState(existingIngredients || '');
  const [isGrading, setIsGrading] = useState(false);
  const [error, setError] = useState('');

  const handleGrade = async () => {
    // Validate inputs
    if (!name.trim()) {
      setError('Please enter a product name');
      return;
    }

    if (!ingredients.trim()) {
      setError('Please enter ingredients');
      return;
    }

    if (!ingredients.includes(',')) {
      setError('Please separate ingredients with commas');
      return;
    }

    setIsGrading(true);
    setError('');

    try {
      console.log('[ManualEntry] Grading ingredients...', { name, ingredientsLength: ingredients.length });
      const result = await manualGrade(name, ingredients);
      console.log('[ManualEntry] Grade complete:', result);
      onComplete(result);
    } catch (err: any) {
      console.error('[ManualEntry] Error grading:', err);
      setError(err.message || 'Failed to grade ingredients');
      setIsGrading(false);
    }
  };

  if (isGrading) {
    return (
      <div className="text-center animate-fade-in">
        <div className="w-20 h-20 mx-auto mb-4 relative">
          <div className="absolute inset-0 border-4 border-sage-200 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-sage-500 rounded-full border-t-transparent animate-spin"></div>
        </div>
        <p className="text-sage-700 font-medium">Grading ingredients...</p>
        <p className="text-sage-500 text-sm mt-1">AI is analyzing your ingredient list</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-sage-800 mb-2">Manual Ingredient Entry</h1>
        <p className="text-sage-600 text-sm">
          Enter product details and ingredients
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        {/* Product Name Input */}
        <div>
          <label htmlFor="productName" className="block text-sm font-medium text-sage-800 mb-1.5">
            Product Name
          </label>
          <input
            id="productName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., rhode GLAZING MILK"
            className="w-full px-3 py-2.5 border-2 border-sage-300 rounded-lg focus:outline-none focus:border-sage-500 text-sage-900 placeholder-sage-400"
          />
        </div>

        {/* Instructions */}
        <div className="bg-sage-50 border border-sage-200 rounded-lg p-3">
          <p className="text-sage-700 text-xs leading-relaxed">
            Please copy and paste the list of ingredients from the site separated by commas.
          </p>
        </div>

        {/* Ingredients Textarea */}
        <div>
          <label htmlFor="ingredients" className="block text-sm font-medium text-sage-800 mb-1.5">
            Ingredients
          </label>
          <textarea
            id="ingredients"
            value={ingredients}
            onChange={(e) => setIngredients(e.target.value)}
            placeholder="Water, Glycerin, Sodium Hyaluronate, ..."
            rows={8}
            className="w-full px-3 py-2.5 border-2 border-sage-300 rounded-lg focus:outline-none focus:border-sage-500 text-sage-900 placeholder-sage-400 resize-none text-sm"
          />
          <p className="text-sage-500 text-xs mt-1">
            {ingredients.split(',').filter(i => i.trim()).length} ingredients
          </p>
        </div>

        {/* Buttons */}
        <div className="space-y-2 pt-2">
          <button
            onClick={handleGrade}
            disabled={isGrading}
            className="w-full bg-gradient-to-r from-sage-500 to-sage-600 text-white py-3.5 rounded-lg font-medium hover:from-sage-600 hover:to-sage-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Grade Ingredients
          </button>

          <button
            onClick={onCancel}
            disabled={isGrading}
            className="w-full bg-sage-100 border-2 border-sage-400 text-sage-800 py-2.5 rounded-lg font-medium hover:bg-sage-200 hover:border-sage-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
