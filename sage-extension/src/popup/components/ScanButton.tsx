import { useState, useEffect } from 'react';
import { captureWithSnippingTool, uploadFromFile, resizeImage } from '../../lib/screenshot';
import { scanImage, scanPage } from '../../lib/api';
import { storage } from '../../lib/storage';
import { ScanResult, ScanState } from '../../types';
import ProductTypeSelector from './ProductTypeSelector';

interface ScanButtonProps {
  onScanComplete: (result: ScanResult) => void;
  onExtractionFailed?: (productName?: string) => void;
}

export default function ScanButton({ onScanComplete, onExtractionFailed }: ScanButtonProps) {
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [error, setError] = useState('');
  const [scanMethod, setScanMethod] = useState<'capture' | 'page' | 'upload'>('capture');

  // Product type classification state
  const [needsClassification, setNeedsClassification] = useState<any>(null);
  const [pendingImageData, setPendingImageData] = useState<string | null>(null);
  const [pendingPageUrl, setPendingPageUrl] = useState<string | null>(null);
  const [selectedProductType, setSelectedProductType] = useState<'FOOD' | 'COSMETIC' | null>(null);

  // Check for pending snipping results on mount
  useEffect(() => {
    checkForPendingSnipping();
  }, []);


  const checkForPendingSnipping = async () => {
    try {
      console.log('[ScanButton] Checking for pending snipping on mount...');
      const data = await chrome.storage.local.get(['snippingResult', 'snippingInProgress', 'snippingTimestamp']);
      console.log('[ScanButton] Storage data:', {
        hasResult: !!data.snippingResult,
        inProgress: data.snippingInProgress,
        timestamp: data.snippingTimestamp
      });

      if (data.snippingResult && data.snippingInProgress) {
        // Validate timestamp (reject if older than 2 minutes)
        const elapsed = data.snippingTimestamp ? Date.now() - data.snippingTimestamp : 0;
        if (elapsed > 120000) {  // 2 minutes
          console.log('[ScanButton] 🧹 Rejecting stale snipping result (age:', elapsed, 'ms)');
          await chrome.storage.local.remove(['snippingInProgress', 'snippingTimestamp', 'snippingResult']);
          return;
        }

        console.log('[ScanButton] ✅ Found pending snipping result on mount! Processing immediately...');
        // Set state to show we're processing
        setScanState('uploading');
        // Clear all snipping-related storage immediately
        await chrome.storage.local.remove(['snippingInProgress', 'snippingTimestamp', 'snippingResult']);
        // Process the image
        await processImage(data.snippingResult);
      } else if (data.snippingInProgress && data.snippingTimestamp) {
        // Snipping was started but not completed yet
        const elapsed = Date.now() - data.snippingTimestamp;
        console.log('[ScanButton] Snipping in progress, elapsed time:', elapsed, 'ms');
        if (elapsed < 60000) {
          console.log('[ScanButton] ⏳ Waiting for snipping result...');
          setScanState('capturing');
          // Poll for the result
          pollForSnippingResult();
        } else {
          // Stale snipping state, clean it up
          console.log('[ScanButton] 🧹 Cleaning up stale snipping state');
          await chrome.storage.local.remove(['snippingInProgress', 'snippingResult', 'snippingTimestamp']);
        }
      } else {
        console.log('[ScanButton] No pending snipping found');
      }
    } catch (err) {
      console.error('[ScanButton] ❌ Error checking pending snipping:', err);
      setError('Failed to check for pending scans: ' + (err as Error).message);
      setScanState('error');
    }
  };

  const pollForSnippingResult = async () => {
    const maxAttempts = 300; // 60 seconds (300 * 200ms)
    let attempts = 0;

    const intervalId = setInterval(async () => {
      attempts++;

      try {
        const data = await chrome.storage.local.get(['snippingResult', 'snippingInProgress']);

        if (data.snippingResult && data.snippingInProgress) {
          console.log('[ScanButton] Found snipping result after polling!');
          clearInterval(intervalId);
          await chrome.storage.local.remove(['snippingInProgress', 'snippingTimestamp', 'snippingResult']);
          await processImage(data.snippingResult);
        } else if (!data.snippingInProgress) {
          // User cancelled
          console.log('[ScanButton] Snipping was cancelled');
          clearInterval(intervalId);
          setScanState('idle');
        } else if (attempts >= maxAttempts) {
          // Timeout
          console.log('[ScanButton] Snipping timed out');
          clearInterval(intervalId);
          await chrome.storage.local.remove(['snippingInProgress', 'snippingResult', 'snippingTimestamp']);
          setError('Snipping timed out. Please try again.');
          setScanState('error');
        }
      } catch (err) {
        console.error('[ScanButton] Error polling for result:', err);
        clearInterval(intervalId);
        setScanState('idle');
      }
    }, 200);
  };

  const handleSnippingTool = async () => {
    setScanMethod('capture');
    setScanState('capturing');
    setError('');

    try {
      console.log('[ScanButton] Starting snipping tool...');
      const imageData = await captureWithSnippingTool();

      if (!imageData) {
        // User cancelled or timeout
        console.log('[ScanButton] No image data received (user cancelled or timeout)');
        setScanState('idle');
        return;
      }

      console.log('[ScanButton] Got image data from snipping tool, size:', imageData.length);
      await processImage(imageData);
    } catch (err: any) {
      console.error('[ScanButton] Snipping error:', err);
      setError(err.message || 'Failed to capture screen region');
      setScanState('error');
    }
  };

  const handleUpload = async () => {
    setScanMethod('upload');
    setScanState('capturing');
    setError('');

    try {
      const imageData = await uploadFromFile();
      if (!imageData) {
        setScanState('idle');
        return;
      }

      await processImage(imageData);
    } catch (err: any) {
      setError(err.message || 'Failed to upload image');
      setScanState('error');
    }
  };

  const processImage = async (imageData: string) => {
    try {
      console.log('[ScanButton] 📸 Starting image processing...');
      setScanState('uploading');
      console.log('[ScanButton] Image data size:', imageData.length, 'characters');
      const resizedImage = await resizeImage(imageData, 800);
      console.log('[ScanButton] ✓ Image resized, new size:', resizedImage.length);

      // Get current tab URL to help with ingredient extraction (Honey-style behavior)
      let pageUrl: string | null = null;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
          pageUrl = tab.url;
          console.log('[ScanButton] 📍 Current page URL:', pageUrl);
        }
      } catch (tabError) {
        console.log('[ScanButton] ⚠️ Could not get current tab URL (continuing without it):', tabError);
      }

      setScanState('analyzing');
      console.log('[ScanButton] 🔍 Calling scanImage API...');
      const result = await scanImage(resizedImage, pageUrl, selectedProductType || undefined);
      console.log('[ScanButton] ✅ Scan complete! Result:', result);

      // Check if GPT classification needs user input
      if ((result as any).needsUserInput) {
        console.log('[ScanButton] GPT needs user input, showing type selector');
        setNeedsClassification(result);
        setPendingImageData(resizedImage);
        setPendingPageUrl(pageUrl);
        setScanState('awaiting_classification');
        return;
      }

      await storage.setLastScan(result);
      console.log('[ScanButton] ✓ Result saved to storage');

      // Clear Chrome storage to prevent screenshot failure on next scan
      await chrome.storage.local.remove(['snippingResult', 'snippingInProgress', 'snippingTimestamp']);
      console.log('[ScanButton] ✓ Cleared snipping storage');

      // Reset state BEFORE callback (prevents re-render issues)
      setScanState('idle');
      setSelectedProductType(null); // Reset for next scan

      onScanComplete(result);
      console.log('[ScanButton] ✓ onScanComplete callback triggered');
    } catch (err: any) {
      console.error('[ScanButton] ❌ Error processing image:', err);
      console.error('[ScanButton] Error details:', JSON.stringify({
        message: err.message,
        error: err.error,
        stack: err.stack,
        fullError: err
      }, null, 2));

      // Check if this is a "needs manual input" error
      if (err.needsManualInput || err.message?.includes('Could not find ingredients')) {
        // Extract product name from error if available
        const productName = err.productName || err.product_name;
        console.log('[ScanButton] Extraction failed, needs manual input:', productName);

        if (onExtractionFailed) {
          onExtractionFailed(productName);
          setScanState('idle');
          return;
        }
      }

      // Regular error handling
      const errorMessage = err.message || err.error || 'Failed to analyze image';
      setError(errorMessage);
      setScanState('error');
    }
  };

  const handleCancelScan = async () => {
    console.log('[ScanButton] User cancelled scan');
    // Clear snipping-related storage
    await chrome.storage.local.remove(['snippingInProgress', 'snippingResult', 'snippingTimestamp']);
    // Reset state
    setScanState('idle');
    setError('');
  };

  const handleTypeSelect = async (type: 'FOOD' | 'COSMETIC') => {
    console.log('[ScanButton] User selected product type:', type);
    setSelectedProductType(type);
    setNeedsClassification(null);
    setScanState('analyzing');

    try {
      // Retry scan with selected type
      if (pendingImageData && pendingPageUrl !== undefined && pendingPageUrl !== null) {
        // Determine if this is an image scan or page scan based on data format
        const isPageScan = pendingImageData.startsWith('<!') || pendingImageData.startsWith('<html');

        if (isPageScan) {
          console.log('[ScanButton] Retrying page scan with type:', type);
          const result = await scanPage(pendingImageData, pendingPageUrl, type);

          if ((result as any).needsUserInput) {
            console.warn('[ScanButton] GPT still needs user input after selection');
            setNeedsClassification(result);
            setScanState('awaiting_classification');
            return;
          }

          await storage.setLastScan(result);
          await chrome.storage.local.remove(['snippingResult', 'snippingInProgress', 'snippingTimestamp']);

          setPendingImageData(null);
          setPendingPageUrl(null);
          setSelectedProductType(null);
          setScanState('idle');

          onScanComplete(result);
        } else {
          console.log('[ScanButton] Retrying image scan with type:', type);
          const result = await scanImage(pendingImageData, pendingPageUrl, type);

          if ((result as any).needsUserInput) {
            console.warn('[ScanButton] GPT still needs user input after selection');
            setNeedsClassification(result);
            setScanState('awaiting_classification');
            return;
          }

          await storage.setLastScan(result);
          await chrome.storage.local.remove(['snippingResult', 'snippingInProgress', 'snippingTimestamp']);

          setPendingImageData(null);
          setPendingPageUrl(null);
          setSelectedProductType(null);
          setScanState('idle');

          onScanComplete(result);
        }
      } else {
        throw new Error('No pending data to retry');
      }
    } catch (err: any) {
      console.error('[ScanButton] Error after type selection:', err);
      setError(err.message || 'Failed to complete scan');
      setScanState('error');
    }
  };

  const handleTypeCancel = () => {
    console.log('[ScanButton] User cancelled product type selection');
    setNeedsClassification(null);
    setPendingImageData(null);
    setPendingPageUrl(null);
    setSelectedProductType(null);
    setScanState('idle');
  };

  const handleScanCurrentPage = async () => {
    setScanMethod('page');
    setScanState('analyzing'); // Different state for page scan (not 'capturing')
    setError('');

    try {
      console.log('[ScanButton] Starting current page scan...');

      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.id) {
        throw new Error('No active tab found');
      }

      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        throw new Error('Cannot scan browser internal pages. Please navigate to a product page.');
      }

      console.log('[ScanButton] Active tab:', { id: tab.id, url: tab.url, title: tab.title });

      // Inject content script as fallback (in case it's not already loaded)
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['pageExtractor.js']
        });
        console.log('[ScanButton] Content script injected');
      } catch (injectError) {
        // Content script might already be injected, that's OK
        console.log('[ScanButton] Content script already injected or injection failed:', injectError);
      }

      // Wait a moment for content script to initialize
      await new Promise(resolve => setTimeout(resolve, 100));

      // Retry logic for sending message
      let response: any = null;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts && !response) {
        attempts++;
        try {
          console.log(`[ScanButton] Sending message to content script (attempt ${attempts})...`);
          response = await chrome.tabs.sendMessage(tab.id, { action: 'extractPageData' });

          if (response && response.success) {
            console.log('[ScanButton] Content script response:', response);
            break;
          }
        } catch (msgError) {
          console.error(`[ScanButton] Message attempt ${attempts} failed:`, msgError);
          if (attempts < maxAttempts) {
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to extract page data. Please refresh the page and try again.');
      }

      const { html, url } = response.data;

      if (!html || !url) {
        throw new Error('Failed to extract page content');
      }

      console.log('[ScanButton] Extracted page data:', {
        htmlSize: html.length,
        url: url.substring(0, 100)
      });

      // Call the scan-page API
      console.log('[ScanButton] Calling scanPage API...');
      const result = await scanPage(html, url, selectedProductType || undefined);
      console.log('[ScanButton] Scan complete! Result:', result);

      // Check if GPT classification needs user input
      if ((result as any).needsUserInput) {
        console.log('[ScanButton] GPT needs user input for page scan, showing type selector');
        setNeedsClassification(result);
        // Store page data for retry (reusing image data state)
        setPendingImageData(html);
        setPendingPageUrl(url);
        setScanState('awaiting_classification');
        return;
      }

      await storage.setLastScan(result);
      console.log('[ScanButton] Result saved to storage');

      // Clear Chrome storage to prevent screenshot failure
      await chrome.storage.local.remove(['snippingResult', 'snippingInProgress', 'snippingTimestamp']);

      // Reset state BEFORE callback
      setScanState('idle');
      setSelectedProductType(null); // Reset for next scan

      onScanComplete(result);
      console.log('[ScanButton] onScanComplete callback triggered');
    } catch (err: any) {
      console.error('[ScanButton] Error scanning current page:', err);
      console.error('[ScanButton] Error details:', JSON.stringify({
        message: err.message,
        error: err.error,
        stack: err.stack,
        fullError: err
      }, null, 2));

      // Check if this is a "needs manual input" error
      if (err.needsManualInput || err.message?.includes('Could not find ingredients')) {
        // Extract product name from error if available
        const productName = err.productName || err.product_name;
        console.log('[ScanButton] Page scan extraction failed, needs manual input:', productName);

        if (onExtractionFailed) {
          onExtractionFailed(productName);
          setScanState('idle');
          return;
        }
      }

      // Regular error handling
      const errorMessage = err.message || err.error || 'Failed to scan current page';
      setError(errorMessage);
      setScanState('error');
    }
  };

  if (scanState === 'capturing' || scanState === 'uploading' || scanState === 'analyzing') {
    return (
      <div className="text-center animate-fade-in">
        <div className="w-20 h-20 mx-auto mb-4 relative">
          <div className="absolute inset-0 border-4 border-sage-200 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-sage-500 rounded-full border-t-transparent animate-spin"></div>
        </div>
        <p className="text-sage-700 font-medium">
          {scanState === 'capturing' && scanMethod === 'capture' && 'Select region on your screen...'}
          {scanState === 'capturing' && scanMethod === 'upload' && 'Processing uploaded image...'}
          {scanState === 'uploading' && 'Processing image...'}
          {scanState === 'analyzing' && scanMethod === 'page' && 'Scanning current page...'}
          {scanState === 'analyzing' && scanMethod !== 'page' && 'Analyzing ingredients...'}
        </p>
        <p className="text-sage-500 text-sm mt-1 mb-4">
          {scanState === 'capturing' && scanMethod === 'capture' && 'Drag to select the product area'}
          {scanState === 'capturing' && scanMethod === 'upload' && 'Please wait...'}
          {scanState === 'uploading' && 'This may take a few seconds'}
          {scanState === 'analyzing' && scanMethod === 'page' && 'Extracting ingredients from page...'}
          {scanState === 'analyzing' && scanMethod !== 'page' && 'AI is reading the ingredients'}
        </p>

        {/* Show cancel button only during capturing state */}
        {scanState === 'capturing' && (
          <button
            onClick={handleCancelScan}
            className="mt-4 px-6 py-2 bg-red-50 border-2 border-red-300 text-red-700 rounded-lg font-medium hover:bg-red-100 hover:border-red-400 transition-all"
          >
            Cancel Scan
          </button>
        )}
      </div>
    );
  }

  if (scanState === 'awaiting_classification' && needsClassification) {
    return (
      <div className="animate-fade-in">
        <ProductTypeSelector
          productName={needsClassification.productName}
          suggestedType={needsClassification.suggestedType}
          confidence={needsClassification.confidence}
          reasoning={needsClassification.reasoning}
          onSelect={handleTypeSelect}
          onCancel={handleTypeCancel}
        />
      </div>
    );
  }

  if (scanState === 'error') {
    return (
      <div className="animate-fade-in">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
        <button
          onClick={() => setScanState('idle')}
          className="w-full bg-sage-500 text-white py-2.5 rounded-lg font-medium hover:bg-sage-600 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <button
        onClick={handleScanCurrentPage}
        className="w-full bg-gradient-to-r from-sage-500 to-sage-600 text-white py-4 rounded-lg font-medium hover:from-sage-600 hover:to-sage-700 transition-all shadow-md hover:shadow-lg group"
      >
        <div className="flex items-center justify-center space-x-2">
          <svg className="w-6 h-6 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-lg">Scan Current Page</span>
        </div>
      </button>

      <button
        onClick={handleSnippingTool}
        className="w-full bg-sage-100 border-2 border-sage-400 text-sage-800 py-3 rounded-lg font-medium hover:bg-sage-200 hover:border-sage-500 transition-all"
      >
        <div className="flex items-center justify-center space-x-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span>Snipping Tool Scan</span>
        </div>
      </button>

      <button
        onClick={handleUpload}
        className="w-full bg-sage-100 border-2 border-sage-400 text-sage-800 py-3 rounded-lg font-medium hover:bg-sage-200 hover:border-sage-500 transition-all"
      >
        <div className="flex items-center justify-center space-x-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <span>Upload Product Image</span>
        </div>
      </button>

      <p className="text-center text-xs text-sage-500 mt-4">
        Scan the current product page, capture your screen, or upload an image
      </p>
    </div>
  );
}
