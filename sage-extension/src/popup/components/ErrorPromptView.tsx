interface ErrorPromptViewProps {
  productName?: string;
  onManualEntry: () => void;
  onTryAgain: () => void;
}

export default function ErrorPromptView({ productName, onManualEntry, onTryAgain }: ErrorPromptViewProps) {
  return (
    <div className="animate-fade-in">
      <div className="text-center mb-6">
        <div className="w-16 h-16 mx-auto mb-4 bg-yellow-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-sage-800 mb-2">Ingredients Not Found</h1>
        {productName && productName !== 'Unknown Product' && (
          <p className="text-sage-600 text-sm mb-4">
            <span className="font-medium">Product:</span> {productName}
          </p>
        )}
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <p className="text-sage-700 text-sm leading-relaxed">
          Could not find ingredients on host site or online. Do you want to manually add ingredients or try again?
        </p>
      </div>

      <div className="space-y-3">
        <button
          onClick={onManualEntry}
          className="w-full bg-gradient-to-r from-sage-500 to-sage-600 text-white py-4 rounded-lg font-medium hover:from-sage-600 hover:to-sage-700 transition-all shadow-md hover:shadow-lg"
        >
          <div className="flex items-center justify-center space-x-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span>Manually Add Ingredients</span>
          </div>
        </button>

        <button
          onClick={onTryAgain}
          className="w-full bg-sage-100 border-2 border-sage-400 text-sage-800 py-3.5 rounded-lg font-medium hover:bg-sage-200 hover:border-sage-500 transition-all"
        >
          <div className="flex items-center justify-center space-x-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Try Again</span>
          </div>
        </button>
      </div>
    </div>
  );
}
