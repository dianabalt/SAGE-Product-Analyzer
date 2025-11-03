// web/components/ProductTypeSelector.tsx
// UI component for manual product type selection when GPT confidence is low

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
    <div className="bg-white border-2 border-sage-500 rounded-lg p-6 mb-4 shadow-lg">
      <h3 className="text-lg font-semibold mb-2">🤔 Help Us Classify This Product</h3>
      <p className="text-gray-700 mb-2">
        We're analyzing <span className="font-medium">"{productName}"</span> but need your help confirming the category.
      </p>
      <p className="text-sm text-gray-500 mb-4 italic">
        AI reasoning: {reasoning}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* FOOD Button */}
        <button
          onClick={() => setSelected('FOOD')}
          className={`p-4 border-2 rounded-lg transition-all ${
            selected === 'FOOD'
              ? 'border-sage-500 bg-sage-50 ring-2 ring-sage-300'
              : 'border-gray-300 hover:border-sage-300 hover:bg-gray-50'
          }`}
        >
          <div className="text-4xl mb-2">🍎</div>
          <div className="font-semibold text-lg">Food Product</div>
          <div className="text-xs text-gray-600 mt-2 leading-relaxed">
            Ice cream, supplements, vitamins, protein powder, snacks, drinks, cereal, energy bars
          </div>
          {suggestedType === 'FOOD' && (
            <span className="inline-block text-xs bg-sage-100 text-sage-700 px-2 py-1 rounded mt-2 font-medium">
              ✨ AI Suggested
            </span>
          )}
        </button>

        {/* COSMETIC Button */}
        <button
          onClick={() => setSelected('COSMETIC')}
          className={`p-4 border-2 rounded-lg transition-all ${
            selected === 'COSMETIC'
              ? 'border-sage-500 bg-sage-50 ring-2 ring-sage-300'
              : 'border-gray-300 hover:border-sage-300 hover:bg-gray-50'
          }`}
        >
          <div className="text-4xl mb-2">💄</div>
          <div className="font-semibold text-lg">Cosmetic Product</div>
          <div className="text-xs text-gray-600 mt-2 leading-relaxed">
            Face cream, lotion, serum, makeup, shampoo, conditioner, skincare, body care
          </div>
          {suggestedType === 'COSMETIC' && (
            <span className="inline-block text-xs bg-sage-100 text-sage-700 px-2 py-1 rounded mt-2 font-medium">
              ✨ AI Suggested
            </span>
          )}
        </button>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition font-medium"
        >
          Cancel
        </button>
        <button
          onClick={() => selected && onSelect(selected)}
          disabled={!selected}
          className={`flex-1 px-4 py-2 rounded-lg font-medium transition ${
            selected
              ? 'bg-sage-500 text-white hover:bg-sage-600 shadow'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          Continue Scan
        </button>
      </div>

      <p className="text-xs text-gray-400 mt-3 text-center">
        AI Confidence: {confidence}% {confidence < 60 && '(Very uncertain)'}
      </p>
    </div>
  );
}
