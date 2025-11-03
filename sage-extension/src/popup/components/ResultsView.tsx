import { useState } from 'react';
import { ScanResult } from '../../types';
import { openWebApp } from '../../lib/api';
import ProductTypeTag from './ProductTypeTag';

/**
 * Split ingredients by comma while preserving parenthetical content.
 * Handles compound ingredients like "Enriched Bleached Flour (Wheat Flour, Niacinamide, Iron)".
 *
 * @param ingredientsText - Comma-separated ingredient list
 * @returns Array of ingredients with parenthetical sub-ingredients intact
 *
 * @example
 * Input:  "Flour (A, B, C), Sugar, Leavening (D, E)"
 * Output: ["Flour (A, B, C)", "Sugar", "Leavening (D, E)"]
 */
function splitIngredients(ingredientsText: string): string[] {
  const ingredients: string[] = [];
  let current = '';
  let parenDepth = 0;

  for (let i = 0; i < ingredientsText.length; i++) {
    const char = ingredientsText[i];

    // Track parentheses depth
    if (char === '(' || char === '[' || char === '{') parenDepth++;
    if (char === ')' || char === ']' || char === '}') parenDepth--;

    // Only split on commas at top level (outside all parentheses)
    if (char === ',' && parenDepth === 0) {
      if (current.trim()) ingredients.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Add final ingredient
  if (current.trim()) ingredients.push(current.trim());

  return ingredients;
}

/**
 * Parsed ingredient structure for hierarchical display
 */
interface ParsedIngredient {
  main: string;
  subs: string[];
}

/**
 * Parse a compound ingredient into main and sub-parts.
 * Used for hierarchical display of ingredients with parenthetical content.
 *
 * @param ingredient - Single ingredient string (may contain parentheses)
 * @returns Object with main ingredient and array of sub-ingredients
 *
 * @example
 * Input:  "Leavening (Baking Soda, Sodium Aluminum Phosphate, Calcium Phosphate)"
 * Output: { main: "Leavening", subs: ["Baking Soda", "Sodium Aluminum Phosphate", "Calcium Phosphate"] }
 *
 * @example
 * Input:  "Sugar"
 * Output: { main: "Sugar", subs: [] }
 */
function parseCompoundIngredient(ingredient: string): ParsedIngredient {
  // Check if ingredient has parentheses
  const parenMatch = ingredient.match(/^([^(]+)\s*\(([^)]+)\)\s*$/);

  if (parenMatch) {
    const main = parenMatch[1].trim();
    const subsRaw = parenMatch[2];
    // Split sub-ingredients by comma
    const subs = subsRaw.split(',').map(s => s.trim()).filter(Boolean);
    return { main, subs };
  }

  // No parentheses - simple ingredient
  return { main: ingredient.trim(), subs: [] };
}

interface ResultsViewProps {
  result: ScanResult;
  onNewScan: () => void;
  onManualEdit?: () => void;
  onViewAlternatives?: () => void;
  onViewDeals?: () => void;
}

export default function ResultsView({ result, onNewScan, onManualEdit, onViewAlternatives, onViewDeals }: ResultsViewProps) {
  const [showFullDetails, setShowFullDetails] = useState(false);

  // Sage green gradient button styles (darkest to lightest to white-ish sage)
  const btn = {
    sage1: 'w-full font-medium py-2.5 border-2 rounded-lg bg-sage-700 border-sage-700 text-white hover:bg-sage-800 active:bg-sage-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-700',
    sage2: 'w-full font-medium py-2.5 border-2 rounded-lg bg-sage-600 border-sage-600 text-white hover:bg-sage-700 active:bg-sage-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-600',
    sage3: 'w-full font-medium py-2.5 border-2 rounded-lg bg-sage-500 border-sage-500 text-white hover:bg-sage-600 active:bg-sage-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-500',
    sage4: 'w-full font-medium py-2.5 border-2 rounded-lg bg-sage-400 border-sage-400 text-white hover:bg-sage-500 active:bg-sage-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-400',
    sage5: 'w-full font-medium py-2.5 border-2 rounded-lg bg-sage-300 border-sage-300 text-sage-800 hover:bg-sage-400 hover:text-white active:bg-sage-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-300',
    sage6: 'w-full font-medium py-2.5 border-2 rounded-lg bg-sage-50 border-sage-200 text-sage-700 hover:bg-sage-100 active:bg-sage-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-200',
  };

  const getGradeColor = (grade: string) => {
    if (grade.startsWith('A')) return 'from-green-400 to-green-500';
    if (grade.startsWith('B')) return 'from-lime-400 to-lime-500';
    if (grade.startsWith('C')) return 'from-yellow-400 to-yellow-500';
    if (grade.startsWith('D')) return 'from-orange-400 to-orange-500';
    return 'from-red-400 to-red-500';
  };

  const getScoreBarColor = (score: number) => {
    if (score >= 90) return 'bg-green-500';
    if (score >= 80) return 'bg-sage-500';
    if (score >= 70) return 'bg-yellow-500';
    if (score >= 60) return 'bg-orange-500';
    return 'bg-red-500';
  };

  // Parse ingredients into array (preserves parenthetical sub-ingredients)
  const ingredientsList = result.ingredients
    ? splitIngredients(result.ingredients)
    : [];

  if (showFullDetails) {
    return (
      <div className="h-full flex flex-col animate-slide-up">
        {/* Header with Back Button */}
        <header className="shrink-0 sticky top-0 z-10 bg-white/80 backdrop-blur border-b px-3 py-2">
          <button
            onClick={() => setShowFullDetails(false)}
            className="flex items-center text-sage-700 hover:text-sage-900 mb-2"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Summary
          </button>
          <h2 className="text-lg font-bold text-sage-800 mb-2">
            {result.product_title || 'Product Analysis'}
          </h2>
          <ProductTypeTag
            productType={result.product_subtype}
            customName={result.custom_tag_name}
            customColor={result.custom_tag_color}
            size="sm"
          />
        </header>

        <main className="grow overflow-y-auto px-3 py-3">
          {/* Score Bar */}
          <div className="mb-4 bg-white rounded-lg p-4 border border-sage-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-sage-700">Overall Score</span>
            <span className={`text-2xl font-bold ${
              result.numeric_grade >= 90 ? 'text-green-600' :
              result.numeric_grade >= 80 ? 'text-sage-600' :
              result.numeric_grade >= 70 ? 'text-yellow-600' :
              result.numeric_grade >= 60 ? 'text-orange-600' :
              'text-red-600'
            }`}>
              {result.numeric_grade}/100
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full transition-all ${getScoreBarColor(result.numeric_grade)}`}
              style={{ width: `${result.numeric_grade}%` }}
            />
          </div>
          <div className="text-center mt-2">
            <span className={`text-3xl font-bold ${
              result.grade.startsWith('A') ? 'text-green-600' :
              result.grade.startsWith('B') ? 'text-sage-600' :
              result.grade.startsWith('C') ? 'text-yellow-600' :
              result.grade.startsWith('D') ? 'text-orange-600' :
              'text-red-600'
            }`}>
              Grade: {result.grade}
            </span>
          </div>
        </div>

        {/* Beneficial Ingredients */}
        {result.beneficial_ingredients && result.beneficial_ingredients.length > 0 && (
          <div className="mb-4 bg-white rounded-lg p-4 border border-green-200">
            <div className="flex items-center mb-3">
              <svg className="w-5 h-5 text-green-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <h3 className="font-bold text-green-700">Beneficial Ingredients ({result.beneficial_ingredients.length})</h3>
            </div>
            <div className="space-y-2">
              {result.beneficial_ingredients.map((ing, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(ing + ' ingredient cosmetic safety')}` });
                  }}
                  className="block w-full text-left bg-green-50 px-3 py-2 rounded-lg border border-green-200 hover:bg-green-100 cursor-pointer transition-colors"
                  title={`Click to learn more about ${ing}`}
                >
                  <span className="text-sm font-medium text-green-800">{ing}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Concerning Ingredients */}
        {result.harmful_ingredients && result.harmful_ingredients.length > 0 && (
          <div className="mb-4 bg-white rounded-lg p-4 border border-red-200">
            <div className="flex items-center mb-3">
              <svg className="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <h3 className="font-bold text-red-700">Concerning Ingredients ({result.harmful_ingredients.length})</h3>
            </div>
            <div className="space-y-2">
              {result.harmful_ingredients.map((ing, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(ing + ' ingredient safety concerns')}` });
                  }}
                  className="block w-full text-left bg-red-50 px-3 py-2 rounded-lg border border-red-200 hover:bg-red-100 cursor-pointer transition-colors"
                  title={`Click to learn more about ${ing}`}
                >
                  <span className="text-sm font-medium text-red-800">{ing}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Grade Explanation */}
        {result.grade_explanation && (
          <div className="mb-4 bg-sage-50 rounded-lg p-4 border border-sage-200">
            <div className="flex items-center mb-2">
              <svg className="w-5 h-5 text-sage-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <h3 className="font-bold text-sage-800">Why This Grade?</h3>
            </div>
            <p className="text-sm text-sage-700 leading-relaxed">
              {result.grade_explanation}
            </p>
          </div>
        )}

        {/* Full Ingredients List */}
        {result.ingredients && (
          <div className="mb-4 bg-white rounded-lg p-4 border border-sage-200">
            <h3 className="font-bold text-sage-800 mb-3">Full Ingredient List ({ingredientsList.length})</h3>
            <div className="text-xs text-sage-700 max-h-80 overflow-y-auto">
              {ingredientsList.map((ing, idx) => {
                const parsed = parseCompoundIngredient(ing);
                const isLast = idx === ingredientsList.length - 1;

                return (
                  <div
                    key={idx}
                    className={`py-2 px-3 ${!isLast ? 'border-b border-sage-200' : ''}`}
                  >
                    {/* Main ingredient */}
                    <div className="font-medium text-sage-800">
                      {parsed.main}
                    </div>

                    {/* Sub-ingredients (if any) */}
                    {parsed.subs.length > 0 && (
                      <div className="ml-4 mt-1 space-y-0.5">
                        {parsed.subs.map((sub, subIdx) => (
                          <div key={subIdx} className="text-sage-600 flex items-start">
                            <span className="mr-1.5">-</span>
                            <span>{sub}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </main>

        {/* Footer - Action Buttons (Sage Gradient: Darkest to Lightest) */}
        <footer className="shrink-0 sticky bottom-0 z-10 bg-white/80 backdrop-blur border-t p-3 grid gap-2">
          <button
            onClick={() => openWebApp('/dashboard')}
            className={btn.sage1}
          >
            View on SAGE Website
          </button>
          {onViewAlternatives && (
            <button
              onClick={onViewAlternatives}
              className={`${btn.sage2} flex items-center justify-center gap-2`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              {result.has_alternatives ? 'View Alternatives' : 'Find Better Alternatives'}
            </button>
          )}
          {onViewDeals && (
            <button
              onClick={onViewDeals}
              className={`${btn.sage3} flex items-center justify-center gap-2`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              Find the Best Deal
            </button>
          )}
          {onManualEdit && (
            <button
              onClick={onManualEdit}
              className={`${btn.sage4} flex items-center justify-center gap-2`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Manually Edit
            </button>
          )}
          <button
            onClick={onNewScan}
            className={btn.sage6}
          >
            Scan Another Product
          </button>
        </footer>
      </div>
    );
  }

  // Summary View (default)
  return (
    <div className="animate-slide-up overflow-y-auto max-h-full pb-4">
      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-lg font-semibold text-sage-800 mb-1">
          {result.product_title || 'Product Analysis'}
        </h2>
        <div className="flex justify-center mt-2">
          <ProductTypeTag
            productType={result.product_subtype}
            customName={result.custom_tag_name}
            customColor={result.custom_tag_color}
            size="sm"
          />
        </div>
      </div>

      {/* Grade Card */}
      <div className={`bg-gradient-to-br ${getGradeColor(result.grade)} p-6 rounded-xl shadow-lg mb-4 animate-flip`}>
        <div className="text-center">
          <p className="text-white text-sm font-medium mb-1">Overall Grade</p>
          <p className="text-white text-5xl font-bold">{result.grade}</p>
          <p className="text-white text-lg mt-1">{result.numeric_grade}/100</p>
        </div>
      </div>

      {/* Quick Summary */}
      <div className="bg-white rounded-lg p-4 mb-4 border border-sage-200">
        <div className="grid grid-cols-2 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-green-600">
              {result.beneficial_ingredients?.length || 0}
            </p>
            <p className="text-xs text-sage-600">Beneficial</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-red-600">
              {result.harmful_ingredients?.length || 0}
            </p>
            <p className="text-xs text-sage-600">Concerning</p>
          </div>
        </div>
      </div>

      {/* Beneficial Ingredients Preview */}
      {result.beneficial_ingredients && result.beneficial_ingredients.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center mb-2">
            <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <h3 className="font-semibold text-green-700 text-sm">Top Beneficial</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {result.beneficial_ingredients.slice(0, 3).map((ing, idx) => (
              <button
                key={idx}
                onClick={() => {
                  chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(ing + ' ingredient cosmetic safety')}` });
                }}
                className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium hover:bg-green-200 cursor-pointer transition-colors"
                title={`Click to learn more about ${ing}`}
              >
                {ing}
              </button>
            ))}
            {result.beneficial_ingredients.length > 3 && (
              <span className="px-3 py-1 bg-green-50 text-green-600 rounded-full text-xs">
                +{result.beneficial_ingredients.length - 3} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Harmful Ingredients Preview */}
      {result.harmful_ingredients && result.harmful_ingredients.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center mb-2">
            <svg className="w-5 h-5 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <h3 className="font-semibold text-red-700 text-sm">Concerning</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {result.harmful_ingredients.slice(0, 3).map((ing, idx) => (
              <button
                key={idx}
                onClick={() => {
                  chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(ing + ' ingredient safety concerns')}` });
                }}
                className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium hover:bg-red-200 cursor-pointer transition-colors"
                title={`Click to learn more about ${ing}`}
              >
                {ing}
              </button>
            ))}
            {result.harmful_ingredients.length > 3 && (
              <span className="px-3 py-1 bg-red-50 text-red-600 rounded-full text-xs">
                +{result.harmful_ingredients.length - 3} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Actions (Sage Gradient: Darkest to Lightest) */}
      <div className="space-y-2">
        <button
          onClick={() => setShowFullDetails(true)}
          className={btn.sage1}
        >
          View Full Details
        </button>
        <button
          onClick={() => openWebApp('/dashboard')}
          className={btn.sage2}
        >
          View on SAGE Website
        </button>
        {onViewAlternatives && (
          <button
            onClick={onViewAlternatives}
            className={`${btn.sage3} flex items-center justify-center gap-2`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            {result.has_alternatives ? 'View Alternatives' : 'Find Better Alternatives'}
          </button>
        )}
        {onViewDeals && (
          <button
            onClick={onViewDeals}
            className={`${btn.sage4} flex items-center justify-center gap-2`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            Find the Best Deal
          </button>
        )}
        {onManualEdit && (
          <button
            onClick={onManualEdit}
            className={`${btn.sage5} flex items-center justify-center gap-2`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Manually Edit
          </button>
        )}
        <button
          onClick={onNewScan}
          className={btn.sage6}
        >
          Scan Another Product
        </button>
      </div>
    </div>
  );
}
