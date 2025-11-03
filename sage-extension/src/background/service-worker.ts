// Background service worker for SAGE extension

console.log('SAGE background service worker loaded');

// Helper function to get active tab ID
async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found');
  return tab.id;
}

// Keep service worker alive using chrome.alarms (more reliable than setInterval)
console.log('[Background] Setting up keep-alive alarm...');

// Create an alarm that fires every 20 seconds to keep worker alive
chrome.alarms.create('keep-alive', { periodInMinutes: 0.33 }); // ~20 seconds

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keep-alive') {
    console.log('[Background] Keep-alive ping via alarm');
  }
});

// Open side panel when extension icon is clicked (prevents popup from closing during scans)
chrome.action.onClicked.addListener((tab) => {
  console.log('[Background] Extension icon clicked, opening side panel');
  if (tab.windowId) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => {
      console.warn('[Background] Failed to open side panel (might not be supported):', err);
      // Side panel API might not be available in older Chrome versions
      // In that case, the default popup will still work
    });
  }
});

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('SAGE extension installed');

    // Open welcome page on first install
    chrome.tabs.create({
      url: 'http://localhost:3000/login?ref=extension&welcome=true'
    });
  } else if (details.reason === 'update') {
    console.log('SAGE extension updated');
  }
});

// Keep service worker alive and handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Message received:', message.action || message.type);

  if (message.type === 'ping') {
    sendResponse({ status: 'alive' });
    return true;
  }

  // B-E) Harden background capture with fallback window handling
  if (message.action === 'captureTab') {
    console.log('[Background] Received captureTab request from tab:', sender.tab?.id);

    (async () => {
      try {
        // Get tab ID from sender, or fallback to active tab
        const tabId = sender.tab?.id ?? (await getActiveTabId());
        console.log('[Background] Using tab ID:', tabId);

        const tab = await chrome.tabs.get(tabId);
        console.log('[Background] Got tab, windowId:', tab.windowId);

        // Get window ID from tab, or fallback to current window
        const winId = tab.windowId ?? (await chrome.windows.getCurrent()).id!;
        console.log('[Background] Using window ID:', winId);

        // Capture with proper error handling
        const dataUrl = await new Promise<string>((res, rej) => {
          chrome.tabs.captureVisibleTab(winId, { format: 'png' }, (url) => {
            if (chrome.runtime.lastError || !url) {
              rej(new Error(chrome.runtime.lastError?.message || 'captureVisibleTab returned empty data'));
              return;
            }
            res(url);
          });
        });

        console.log('[Background] Tab captured successfully, dataUrl length:', dataUrl.length);
        sendResponse({ dataUrl });
      } catch (err: any) {
        console.error('[Background] captureTab failed:', err);
        sendResponse({ error: String(err?.message || err) });
      }
    })();

    return true; // Keep channel open for async response
  }

  if (message.action === 'snippingComplete') {
    console.log('[Background] Snipping complete, relaying to popup');
    // Relay the message to all extension contexts (popup, etc.)
    chrome.runtime.sendMessage(message).catch(err => {
      console.log('[Background] No popup to receive message (this is ok):', err);

      // If popup is closed, show notification to reopen it
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon128.png',
        title: 'SAGE - Capture Complete',
        message: 'Click the SAGE icon to analyze your product',
        priority: 2
      }, (notificationId) => {
        if (chrome.runtime.lastError) {
          console.error('[Background] Failed to show notification:', chrome.runtime.lastError);
        } else {
          console.log('[Background] Notification shown:', notificationId);
        }
      });
    });
    sendResponse({ received: true });
    return true;
  }

  if (message.action === 'showNotification') {
    console.log('[Background] Showing notification:', message.title);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title: message.title,
      message: message.message,
      priority: 2
    }, (notificationId) => {
      if (chrome.runtime.lastError) {
        console.error('[Background] Failed to show notification:', chrome.runtime.lastError);
      } else {
        console.log('[Background] Notification shown:', notificationId);
      }
    });
    sendResponse({ received: true });
    return true;
  }

  return true;
});

// Periodic session refresh (every 30 minutes)
chrome.alarms.create('refreshSession', { periodInMinutes: 30 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshSession') {
    // Session refresh will be handled by Supabase client auto-refresh
    console.log('Session refresh check');
  }
});
