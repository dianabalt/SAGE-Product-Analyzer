import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { initializeAuth, signOut } from '../lib/supabase';
import { AuthState, ScanResult } from '../types';
import LoginForm from './components/LoginForm';
import SignupPrompt from './components/SignupPrompt';
import ScanButton from './components/ScanButton';
import ResultsView from './components/ResultsView';
import HistoryView from './components/HistoryView';
import ErrorPromptView from './components/ErrorPromptView';
import ManualEntryView from './components/ManualEntryView';
import AlternativesView from './components/AlternativesView';
import DealsView from './components/DealsView';

function App() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [userName, setUserName] = useState<string>('');
  const [showLogin, setShowLogin] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [previousResult, setPreviousResult] = useState<ScanResult | null>(null);
  const [viewMode, setViewMode] = useState<'scan' | 'history'>('scan');
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [showErrorPrompt, setShowErrorPrompt] = useState<string | null>(null); // product name
  const [showManualEntry, setShowManualEntry] = useState<{
    productName: string;
    ingredients?: string;
  } | null>(null);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [showDeals, setShowDeals] = useState(false);

  useEffect(() => {
    initAuth();
  }, []);

  const initAuth = async () => {
    const user = await initializeAuth();
    if (user) {
      // Extract first name from user metadata
      const metadata = user.user_metadata || {};
      const fullName = metadata.full_name || metadata.name || '';
      const firstName = fullName.split(' ')[0] || user.email?.split('@')[0] || 'User';
      setUserName(firstName);

      setAuthState('authenticated');

      // Don't auto-load last scan on mount - let user initiate scans
      // This prevents showing stale results every time the popup opens
    } else {
      setAuthState('unauthenticated');
    }
  };

  const handleLogout = async () => {
    await signOut();
    setAuthState('unauthenticated');
    setUserName('');
    setScanResult(null);
    setShowLogin(false);
  };

  const handleScanComplete = (result: ScanResult) => {
    setScanResult(result);
    // Increment refresh key to force history reload when user switches tabs
    setHistoryRefreshKey(prev => prev + 1);
    console.log('[App] Scan complete, history will refresh on next view');
  };

  const handleNewScan = () => {
    setScanResult(null);
  };

  const handleExtractionFailed = (productName?: string) => {
    setShowErrorPrompt(productName || 'Unknown Product');
    setScanResult(null);
  };

  const handleChooseManualEntry = () => {
    setShowManualEntry({
      productName: showErrorPrompt || 'Unknown Product',
      ingredients: undefined
    });
    setShowErrorPrompt(null);
  };

  const handleTryAgain = () => {
    setShowErrorPrompt(null);
    // User is already on scan mode, just close error prompt
  };

  const handleManualEntryComplete = (result: ScanResult) => {
    setShowManualEntry(null);
    setPreviousResult(null);
    setScanResult(result);
    setHistoryRefreshKey(prev => prev + 1);
  };

  const handleCancelManualEntry = () => {
    const productName = showManualEntry?.productName || 'Unknown Product';
    setShowManualEntry(null);
    if (previousResult) {
      setScanResult(previousResult);
      setPreviousResult(null);
    } else {
      setShowErrorPrompt(productName);
    }
  };

  const handleManualEditFromResults = () => {
    if (!scanResult) return;
    setPreviousResult(scanResult);
    setShowManualEntry({
      productName: scanResult.product_title || 'Unknown Product',
      ingredients: scanResult.ingredients || ''
    });
    setScanResult(null);
    setShowErrorPrompt(null);
  };

  const handleViewAlternatives = () => {
    setShowAlternatives(true);
  };

  const handleViewDeals = () => {
    setShowDeals(true);
  };

  const handleBackFromAlternatives = () => {
    setShowAlternatives(false);
  };

  const handleBackFromDeals = () => {
    setShowDeals(false);
  };

  if (authState === 'loading') {
    return (
      <div className="w-full h-full bg-sage-bg p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-sage-200 border-t-sage-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sage-700">Loading...</p>
        </div>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <div className="w-full h-full bg-sage-bg p-6 flex items-center justify-center">
        <div className="w-full">
          {showLogin ? (
            <LoginForm onSuccess={() => initAuth()} />
          ) : (
            <SignupPrompt onShowLogin={() => setShowLogin(true)} />
          )}
          <button
            onClick={() => setShowLogin(!showLogin)}
            className="mt-4 w-full text-center text-sm text-sage-600 hover:text-sage-800 underline"
          >
            {showLogin ? 'Need an account?' : 'Already have an account?'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-sage-bg flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-sage-500 to-sage-600 p-4 flex-shrink-0 shadow-md">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-md">
              <svg
                className="w-5 h-5 text-sage-600"
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
              <p className="text-white font-bold text-lg">SAGE</p>
              <p className="text-sage-100 text-xs">Hi, {userName}!</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="text-white hover:bg-sage-700 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          >
            Logout
          </button>
        </div>

        {/* Navigation Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => {
              setViewMode('scan');
              setScanResult(null);
            }}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
              viewMode === 'scan'
                ? 'bg-sage-100 text-sage-800 shadow-md'
                : 'bg-sage-600 text-sage-100 hover:bg-sage-700'
            }`}
          >
            Scan Product
          </button>
          <button
            onClick={() => setViewMode('history')}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
              viewMode === 'history'
                ? 'bg-sage-100 text-sage-800 shadow-md'
                : 'bg-sage-600 text-sage-100 hover:bg-sage-700'
            }`}
          >
            Scan History
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col h-full min-h-0 overflow-y-auto p-4 pb-6">
        {viewMode === 'history' ? (
          <HistoryView
            key={historyRefreshKey}
            isVisible={viewMode === 'history'}
            onViewResult={(result) => {
              setScanResult(result);
              setShowErrorPrompt(null);  // Clear error prompt state
              setShowManualEntry(null);  // Clear manual entry state
              setViewMode('scan');
            }}
            onViewAlternatives={(result) => {
              setScanResult(result);
              setShowErrorPrompt(null);  // Clear error prompt state
              setShowManualEntry(null);  // Clear manual entry state
              setShowAlternatives(true);
              setViewMode('scan');
            }}
          />
        ) : showManualEntry ? (
          <ManualEntryView
            productName={showManualEntry.productName}
            existingIngredients={showManualEntry.ingredients}
            onComplete={handleManualEntryComplete}
            onCancel={handleCancelManualEntry}
          />
        ) : showErrorPrompt ? (
          <ErrorPromptView
            productName={showErrorPrompt}
            onManualEntry={handleChooseManualEntry}
            onTryAgain={handleTryAgain}
          />
        ) : showAlternatives && scanResult ? (
          <AlternativesView
            result={scanResult}
            onBack={handleBackFromAlternatives}
          />
        ) : showDeals && scanResult ? (
          <DealsView
            result={scanResult}
            onBack={handleBackFromDeals}
          />
        ) : scanResult ? (
          <ResultsView
            result={scanResult}
            onNewScan={handleNewScan}
            onManualEdit={handleManualEditFromResults}
            onViewAlternatives={handleViewAlternatives}
            onViewDeals={handleViewDeals}
          />
        ) : (
          <>
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold text-sage-800 mb-2">Scan a Product</h1>
              <p className="text-sage-600 text-sm">
                Use the capture tool to identify ingredients in a product
              </p>
            </div>
            <ScanButton
              onScanComplete={handleScanComplete}
              onExtractionFailed={handleExtractionFailed}
            />
          </>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
