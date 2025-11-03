// sage-extension/src/popup/components/ProductTypeSelector.tsx
// Extension version - optimized for side panel

import { useState } from 'react';

interface ProductTypeSelectorProps {
  productName: string;
  suggestedType: 'FOOD' | 'COSMETIC';
  confidence: number;
  reasoning: string;
  onSelect: (type: 'FOOD' | 'COSMETIC') => void;
  onCancel: () => void;
}

export default function ProductTypeSelector({
  productName,
  suggestedType,
  confidence,
  reasoning,
  onSelect,
  onCancel
}: ProductTypeSelectorProps) {
  const [selected, setSelected] = useState<'FOOD' | 'COSMETIC' | null>(null);

  return (
    <div className="p-4 bg-white border-2 border-sage-500 rounded-lg">
      <h3 className="text-base font-semibold mb-2">🤔 Help Classify Product</h3>
      <p className="text-xs text-gray-700 mb-2">
        Analyzing <span className="font-medium">"{productName.length > 50 ? productName.substring(0, 50) + '...' : productName}"</span>
      </p>
      <p className="text-xs text-gray-500 mb-3 italic">
        {reasoning}
      </p>

      <div className="space-y-2 mb-3">
        {/* FOOD Button */}
        <button
          onClick={() => setSelected('FOOD')}
          className={`w-full p-3 border-2 rounded-lg transition text-left ${
            selected === 'FOOD'
              ? 'border-sage-500 bg-sage-50'
              : 'border-gray-300 hover:border-sage-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-2xl">🍎</span>
            <div className="flex-1">
              <div className="font-semibold text-sm">Food Product</div>
              <div className="text-xs text-gray-600 leading-tight">
                Ice cream, supplements, vitamins, protein, snacks
              </div>
            </div>
            {suggestedType === 'FOOD' && (
              <span className="text-xs bg-sage-100 text-sage-700 px-2 py-0.5 rounded font-medium shrink-0">
                AI
              </span>
            )}
          </div>
        </button>

        {/* COSMETIC Button */}
        <button
          onClick={() => setSelected('COSMETIC')}
          className={`w-full p-3 border-2 rounded-lg transition text-left ${
            selected === 'COSMETIC'
              ? 'border-sage-500 bg-sage-50'
              : 'border-gray-300 hover:border-sage-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-2xl">💄</span>
            <div className="flex-1">
              <div className="font-semibold text-sm">Cosmetic Product</div>
              <div className="text-xs text-gray-600 leading-tight">
                Face cream, lotion, serum, makeup, shampoo
              </div>
            </div>
            {suggestedType === 'COSMETIC' && (
              <span className="text-xs bg-sage-100 text-sage-700 px-2 py-0.5 rounded font-medium shrink-0">
                AI
              </span>
            )}
          </div>
        </button>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 px-3 py-2 text-sm border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition font-medium"
        >
          Cancel
        </button>
        <button
          onClick={() => selected && onSelect(selected)}
          disabled={!selected}
          className={`flex-1 px-3 py-2 text-sm rounded-lg font-medium transition ${
            selected
              ? 'bg-sage-500 text-white hover:bg-sage-600'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          Continue
        </button>
      </div>

      <p className="text-xs text-gray-400 mt-2 text-center">
        AI Confidence: {confidence}%
      </p>
    </div>
  );
}
