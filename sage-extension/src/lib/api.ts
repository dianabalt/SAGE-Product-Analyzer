// API communication with the web app

import { ScanResult } from '../types';
import { storage } from './storage';

const API_BASE_URL = 'http://localhost:3000'; // Change to production URL when deployed

export async function getApiBaseUrl(): Promise<string> {
  return API_BASE_URL;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const session = await storage.getSession();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  return headers;
}

export async function scanImage(imageData: string, pageUrl?: string | null, productType?: 'FOOD' | 'COSMETIC'): Promise<ScanResult> {
  const headers = await getAuthHeaders();

  console.log('[API] Calling scan endpoint with image size:', imageData.length, 'page_url:', pageUrl || 'none', 'product_type:', productType || 'auto');

  const body: any = { image: imageData };
  if (pageUrl) {
    body.page_url = pageUrl;
  }
  if (productType) {
    body.product_type = productType;
  }

  const response = await fetch(`${API_BASE_URL}/api/extension/scan`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  console.log('[API] Response status:', response.status, response.statusText);

  if (!response.ok) {
    let errorMessage = 'Failed to scan image';
    try {
      const error = await response.json();
      errorMessage = error.error || error.message || errorMessage;
      console.error('[API] Error response:', error);
    } catch (parseError) {
      console.error('[API] Could not parse error response');
    }
    throw new Error(errorMessage);
  }

  const result = await response.json();
  console.log('[API] Scan result:', result);

  // Check if the result contains an error
  if (result.error) {
    throw new Error(result.error);
  }

  return result;
}

export async function saveProduct(productData: {
  product_url: string;
  product_title: string;
  ingredients: string;
}): Promise<any> {
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_BASE_URL}/api/save-product`, {
    method: 'POST',
    headers,
    body: JSON.stringify(productData),
  });

  if (!response.ok) {
    throw new Error('Failed to save product');
  }

  return await response.json();
}

export async function getHistory(): Promise<any[]> {
  const headers = await getAuthHeaders();

  console.log('[API] Fetching history from server...');

  const response = await fetch(`${API_BASE_URL}/api/extension/history`, {
    method: 'GET',
    headers,
  });

  console.log('[API] History response status:', response.status, response.statusText);

  if (!response.ok) {
    let errorMessage = 'Failed to fetch history';
    try {
      const error = await response.json();
      errorMessage = error.error || error.message || errorMessage;
      console.error('[API] History error response:', error);
    } catch (parseError) {
      console.error('[API] Could not parse error response');
    }
    throw new Error(errorMessage);
  }

  const result = await response.json();
  console.log('[API] History result:', {
    count: result.products?.length || 0,
    firstItem: result.products?.[0]
  });

  return result.products || [];
}

export async function scanPage(html: string, url: string, productType?: 'FOOD' | 'COSMETIC'): Promise<ScanResult> {
  const headers = await getAuthHeaders();

  console.log('[API] Calling scan-page endpoint with HTML size:', html.length, 'URL:', url, 'product_type:', productType || 'auto');
  console.log('[API] Target API:', `${API_BASE_URL}/api/extension/scan-page`);

  const body: any = { html, url };
  if (productType) {
    body.product_type = productType;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/extension/scan-page`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    console.log('[API] Response status:', response.status, response.statusText);

    if (!response.ok) {
      let errorMessage = 'Failed to scan page';
      try {
        const error = await response.json();
        errorMessage = error.error || error.message || errorMessage;
        console.error('[API] Error response:', error);
      } catch (parseError) {
        console.error('[API] Could not parse error response');
        const text = await response.text();
        console.error('[API] Raw error response:', text.substring(0, 500));
        errorMessage = `Server error (${response.status}): ${text.substring(0, 100)}`;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('[API] Scan page result:', result);

    // Check if the result contains an error
    if (result.error) {
      throw new Error(result.error);
    }

    return result;
  } catch (networkError: any) {
    console.error('[API] Network error calling scan-page:', networkError);
    console.error('[API] Error details:', {
      name: networkError.name,
      message: networkError.message,
      stack: networkError.stack
    });

    if (networkError.message.includes('Failed to fetch')) {
      throw new Error('Cannot connect to server. Make sure the dev server is running at http://localhost:3000');
    }

    throw networkError;
  }
}

export async function manualGrade(productName: string, ingredients: string): Promise<ScanResult> {
  const headers = await getAuthHeaders();

  console.log('[API] Calling manual-grade endpoint:', { productName, ingredientsLength: ingredients.length });

  const response = await fetch(`${API_BASE_URL}/api/extension/manual-grade`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ product_name: productName, ingredients }),
  });

  console.log('[API] Manual grade response status:', response.status);

  if (!response.ok) {
    let errorMessage = 'Failed to grade ingredients';
    try {
      const error = await response.json();
      errorMessage = error.error || error.message || errorMessage;
      console.error('[API] Manual grade error:', error);
    } catch (parseError) {
      console.error('[API] Could not parse error response');
    }
    throw new Error(errorMessage);
  }

  const result = await response.json();
  console.log('[API] Manual grade result:', result);

  if (result.error) {
    throw new Error(result.error);
  }

  return result;
}

export async function deleteProduct(productId: string): Promise<void> {
  const headers = await getAuthHeaders();

  console.log('[API] Deleting product:', productId);

  const response = await fetch(`${API_BASE_URL}/api/products/${productId}`, {
    method: 'DELETE',
    headers,
  });

  console.log('[API] Delete response status:', response.status);

  if (!response.ok) {
    let errorMessage = 'Failed to delete product';
    try {
      const error = await response.json();
      errorMessage = error.error || error.message || errorMessage;
      console.error('[API] Delete error response:', error);
    } catch (parseError) {
      console.error('[API] Could not parse error response');
    }
    throw new Error(errorMessage);
  }

  console.log('[API] ✅ Product deleted successfully');
}

export async function openWebApp(path: string = '/') {
  chrome.tabs.create({ url: `${API_BASE_URL}${path}` });
}
