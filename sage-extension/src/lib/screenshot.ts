// Screenshot and image capture utilities

export async function captureWithSnippingTool(): Promise<string | null> {
  try {
    console.log('[SnippingTool] Starting capture...');

    // Get the current active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (!activeTab || !activeTab.id) {
      console.error('[SnippingTool] No active tab found');
      throw new Error('No active tab found');
    }

    console.log('[SnippingTool] Active tab:', activeTab.id, activeTab.url);

    // Check if we're on a restricted page
    if (activeTab.url?.startsWith('chrome://') ||
        activeTab.url?.startsWith('edge://') ||
        activeTab.url?.startsWith('about:') ||
        activeTab.url?.includes('chrome.google.com/webstore')) {
      throw new Error('Cannot capture on this page. Please navigate to a regular website.');
    }

    // Store a flag to indicate we're waiting for a snipping result
    await chrome.storage.local.set({ snippingInProgress: true, snippingTimestamp: Date.now() });

    // Setup listener before sending message
    const result = await new Promise<string | null>((resolve) => {
      console.log('[SnippingTool] Setting up message listener...');

      let timeoutId: NodeJS.Timeout | null = null;
      let storageCheckInterval: NodeJS.Timeout | null = null;

      const listener = (message: any) => {
        console.log('[SnippingTool] Received message:', message);
        if (message.action === 'snippingComplete') {
          console.log('[SnippingTool] Snipping complete!');
          if (timeoutId) clearTimeout(timeoutId);
          if (storageCheckInterval) clearInterval(storageCheckInterval);
          chrome.runtime.onMessage.removeListener(listener);
          chrome.storage.local.remove(['snippingInProgress', 'snippingResult', 'snippingTimestamp']);
          resolve(message.imageData);
        }
      };
      chrome.runtime.onMessage.addListener(listener);

      // Also check storage periodically in case the popup was closed and reopened
      // This is the PRIMARY method now since popup often closes during snipping
      storageCheckInterval = setInterval(async () => {
        const data = await chrome.storage.local.get(['snippingResult', 'snippingInProgress', 'snippingTimestamp']);
        if (data.snippingResult && data.snippingInProgress) {
          console.log('[SnippingTool] Found result in storage!');
          if (timeoutId) clearTimeout(timeoutId);
          if (storageCheckInterval) clearInterval(storageCheckInterval);
          chrome.runtime.onMessage.removeListener(listener);
          chrome.storage.local.remove(['snippingInProgress', 'snippingResult', 'snippingTimestamp']);
          resolve(data.snippingResult);
        } else if (data.snippingInProgress && data.snippingTimestamp) {
          // Check if snipping started but hasn't completed - keep waiting
          const elapsed = Date.now() - data.snippingTimestamp;
          console.log('[SnippingTool] Waiting for result... elapsed:', elapsed, 'ms');
        }
      }, 200); // Check more frequently (every 200ms)

      // Timeout after 60 seconds
      timeoutId = setTimeout(() => {
        console.error('[SnippingTool] Timeout waiting for snipping');
        if (storageCheckInterval) clearInterval(storageCheckInterval);
        chrome.runtime.onMessage.removeListener(listener);
        chrome.storage.local.remove(['snippingInProgress', 'snippingResult', 'snippingTimestamp']);
        resolve(null);
      }, 60000);

      // Send message to content script to start snipping
      console.log('[SnippingTool] Sending startSnipping message to tab', activeTab.id);
      chrome.tabs.sendMessage(
        activeTab.id!,
        { action: 'startSnipping' },
        (_response) => {
          if (chrome.runtime.lastError) {
            console.log('[SnippingTool] ℹ️ Content script not ready, injecting and retrying...',
              JSON.stringify(chrome.runtime.lastError));

            // Try to reload the content script and retry once
            console.log('[SnippingTool] Attempting to inject content script...');
            chrome.scripting.executeScript({
              target: { tabId: activeTab.id! },
              files: ['snippingTool.js']
            }).then(() => {
              console.log('[SnippingTool] Content script injected, retrying...');
              setTimeout(() => {
                chrome.tabs.sendMessage(
                  activeTab.id!,
                  { action: 'startSnipping' },
                  () => {
                    if (chrome.runtime.lastError) {
                      console.error('[SnippingTool] Retry failed:', JSON.stringify(chrome.runtime.lastError));
                      if (timeoutId) clearTimeout(timeoutId);
                      chrome.runtime.onMessage.removeListener(listener);
                      resolve(null);
                    } else {
                      console.log('[SnippingTool] Retry successful, waiting for completion...');
                      // Listener is already active, just wait for snippingComplete
                    }
                  }
                );
              }, 500);
            }).catch((injectError) => {
              console.error('[SnippingTool] Failed to inject content script:', injectError);
              if (timeoutId) clearTimeout(timeoutId);
              chrome.runtime.onMessage.removeListener(listener);
              resolve(null);
            });
          } else {
            console.log('[SnippingTool] Message sent successfully');
          }
        }
      );
    });

    console.log('[SnippingTool] Result:', result ? 'Image captured' : 'No image');
    return result;
  } catch (error) {
    console.error('[SnippingTool] Failed to start snipping tool:', error);
    throw error;
  }
}

export async function captureScreenshot(): Promise<string | null> {
  try {
    // Get the current active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (!activeTab || !activeTab.id) {
      throw new Error('No active tab found');
    }

    // Capture the visible tab
    const dataUrl = await chrome.tabs.captureVisibleTab(
      activeTab.windowId,
      { format: 'png' }
    );

    return dataUrl;
  } catch (error) {
    console.error('Failed to capture screenshot:', error);
    return null;
  }
}

export async function uploadFromFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment'; // Use camera on mobile

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as string);
      };
      reader.onerror = () => {
        resolve(null);
      };
      reader.readAsDataURL(file);
    };

    input.click();
  });
}

export function resizeImage(dataUrl: string, maxWidth: number = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}
