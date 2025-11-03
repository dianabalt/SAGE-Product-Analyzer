// Chrome storage wrapper with TypeScript support

import { Session, ScanResult } from '../types';

export const storage = {
  async getSession(): Promise<Session | null> {
    const result = await chrome.storage.local.get('session');
    return result.session || null;
  },

  async setSession(session: Session | null): Promise<void> {
    if (session) {
      await chrome.storage.local.set({ session });
    } else {
      await chrome.storage.local.remove('session');
    }
  },

  async getLastScan(): Promise<ScanResult | null> {
    const result = await chrome.storage.local.get('lastScan');
    return result.lastScan || null;
  },

  async setLastScan(scan: ScanResult): Promise<void> {
    await chrome.storage.local.set({ lastScan: scan });

    // Also add to scan history
    const history = await this.getScanHistory();
    const scanWithTimestamp = {
      ...scan,
      timestamp: new Date().toISOString(),
      id: Date.now().toString(),
    };

    // Keep only the last 50 scans
    const updatedHistory = [scanWithTimestamp, ...history].slice(0, 50);
    await chrome.storage.local.set({ scanHistory: updatedHistory });
  },

  async getScanHistory(): Promise<(ScanResult & { timestamp: string; id: string })[]> {
    const result = await chrome.storage.local.get('scanHistory');
    return result.scanHistory || [];
  },

  async deleteScanFromHistory(id: string): Promise<void> {
    const history = await this.getScanHistory();
    const updatedHistory = history.filter((scan) => scan.id !== id);
    await chrome.storage.local.set({ scanHistory: updatedHistory });

    // If history is now empty, also clear lastScan
    if (updatedHistory.length === 0) {
      await chrome.storage.local.remove('lastScan');
    }
  },

  async clearAllScans(): Promise<void> {
    await chrome.storage.local.remove(['scanHistory', 'lastScan']);
  },

  async clear(): Promise<void> {
    await chrome.storage.local.clear();
  }
};
