// Snipping Tool Content Script
// Creates an overlay for selecting a region of the screen to capture

console.log('[ContentScript] Snipping tool content script loaded');

let isActive = false;
let overlay: HTMLDivElement | null = null;
let selectionBox: HTMLDivElement | null = null;
let startX = 0;
let startY = 0;
let isDrawing = false;

function cleanup() {
  isActive = false;
  isDrawing = false;

  if (overlay) {
    overlay.removeEventListener('mousedown', handleMouseDown);
    overlay.removeEventListener('mousemove', handleMouseMove);
    overlay.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('keydown', handleKeyDown);
    overlay.remove();
    overlay = null;
  }

  selectionBox = null;
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[ContentScript] Received message:', message);
  if (message.action === 'startSnipping') {
    console.log('[ContentScript] Starting snipping tool...');
    startSnippingTool();
    sendResponse({ success: true });
  }
  return true;
});

function startSnippingTool() {
  console.log('[ContentScript] startSnippingTool called, isActive:', isActive);
  if (isActive) {
    console.log('[ContentScript] Already active, returning');
    return;
  }
  isActive = true;
  console.log('[ContentScript] Creating overlay...');

  // Create overlay
  overlay = document.createElement('div');
  overlay.id = 'sage-snipping-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.3);
    z-index: 2147483647;
    cursor: crosshair;
  `;

  // Create instruction text
  const instructions = document.createElement('div');
  instructions.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #738A6E;
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    z-index: 2147483648;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    pointer-events: none !important;
  `;
  instructions.textContent = 'Drag to select the product area • Press ESC to cancel';
  overlay.appendChild(instructions);

  // Create selection box
  selectionBox = document.createElement('div');
  selectionBox.style.cssText = `
    position: fixed;
    border: 3px solid #8EA58C;
    background: rgba(142, 165, 140, 0.1);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.3);
    display: none;
    z-index: 2147483647;
    overflow: hidden;
  `;
  overlay.appendChild(selectionBox);

  // Add event listeners
  overlay.addEventListener('mousedown', handleMouseDown);
  overlay.addEventListener('mousemove', handleMouseMove);
  overlay.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('keydown', handleKeyDown);

  document.body.appendChild(overlay);
}

function handleMouseDown(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();

  isDrawing = true;
  startX = e.clientX;
  startY = e.clientY;

  console.log('[ContentScript] Mouse down at:', startX, startY);

  if (selectionBox) {
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.style.display = 'block';
  }
}

function handleMouseMove(e: MouseEvent) {
  if (!isDrawing || !selectionBox) return;

  e.preventDefault();
  e.stopPropagation();

  const currentX = e.clientX;
  const currentY = e.clientY;

  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);
  const left = Math.min(currentX, startX);
  const top = Math.min(currentY, startY);

  selectionBox.style.left = left + 'px';
  selectionBox.style.top = top + 'px';
  selectionBox.style.width = width + 'px';
  selectionBox.style.height = height + 'px';
}

function handleMouseUp(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();

  console.log('[ContentScript] Mouse up event');
  if (!isDrawing || !selectionBox) {
    console.log('[ContentScript] Not drawing or no selection box');
    return;
  }
  isDrawing = false;

  const currentX = e.clientX;
  const currentY = e.clientY;

  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);

  console.log('[ContentScript] Selection:', {
    start: { x: startX, y: startY },
    end: { x: currentX, y: currentY },
    left: Math.min(currentX, startX),
    top: Math.min(currentY, startY),
    width,
    height
  });

  // Minimum selection size
  if (width < 50 || height < 50) {
    console.log('[ContentScript] Selection too small, canceling');
    chrome.storage.local.remove(['snippingInProgress', 'snippingResult', 'snippingTimestamp']).catch(() => {});
    cleanup();
    return;
  }

  const left = Math.min(currentX, startX);
  const top = Math.min(currentY, startY);

  // Capture the selected region
  console.log('[ContentScript] Calling captureRegion...');
  captureRegion(left, top, width, height);
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    console.log('[ContentScript] ESC pressed, canceling snipping');
    chrome.storage.local.remove(['snippingInProgress', 'snippingResult', 'snippingTimestamp']).catch(() => {});
    cleanup();
  }
}

async function captureRegion(x: number, y: number, width: number, height: number) {
  try {
    console.log('[ContentScript] captureRegion called with:', { x, y, width, height });

    // Try to capture using chrome.tabs API directly (works even when service worker is inactive)
    console.log('[ContentScript] Attempting direct tab capture...');
    let dataUrl: string | null = null;

    try {
      // First, try sending message to background script
      console.log('[ContentScript] Trying background script method...');
      const response = await Promise.race([
        chrome.runtime.sendMessage({
          action: 'captureTab',
          region: { x, y, width, height }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      ]);

      console.log('[ContentScript] Background response:', response);
      if (response && (response as any).dataUrl) {
        dataUrl = (response as any).dataUrl;
        console.log('[ContentScript] Got dataUrl from background');
      }
    } catch (bgError) {
      console.warn('[ContentScript] Background script unavailable (might be inactive):', bgError);

      // Fallback: Use chrome.tabs.captureVisibleTab via a workaround
      // We'll ask the background to wake up and try again
      try {
        console.log('[ContentScript] Waking up background and retrying...');
        await chrome.runtime.sendMessage({ type: 'ping' });

        const retryResponse = await chrome.runtime.sendMessage({
          action: 'captureTab',
          region: { x, y, width, height }
        });

        if (retryResponse && retryResponse.dataUrl) {
          dataUrl = retryResponse.dataUrl;
          console.log('[ContentScript] Got dataUrl after retry');
        }
      } catch (retryError) {
        console.error('[ContentScript] Retry failed:', retryError);
        alert('Failed to capture screenshot. Please reload the extension and try again.');
        cleanup();
        return;
      }
    }

    if (!dataUrl) {
      console.error('[ContentScript] No dataUrl received');
      alert('Failed to capture screenshot. Please reload the extension.');
      cleanup();
      return;
    }

    console.log('[ContentScript] Got dataUrl, cropping image...');
    // Crop the image to the selected region
    const croppedImage = await cropImage(dataUrl, x, y, width, height);

    console.log('[ContentScript] Image cropped, showing scanning animation...');

    // Hide instruction text and show scanning animation
    if (overlay) {
      const instructions = overlay.querySelector('div');
      if (instructions) {
        instructions.style.display = 'none';
      }
    }
    showScanningAnimation();

    console.log('[ContentScript] Sending snippingComplete message...');

    // Store result in storage as backup in case popup closes
    try {
      await chrome.storage.local.set({ snippingResult: croppedImage });
      console.log('[ContentScript] Result stored in chrome.storage');
    } catch (err) {
      console.error('[ContentScript] Failed to store in chrome.storage:', err);
    }

    // Send the cropped image back to the popup
    try {
      await chrome.runtime.sendMessage({
        action: 'snippingComplete',
        imageData: croppedImage
      });
      console.log('[ContentScript] snippingComplete message sent!');
    } catch (err) {
      console.error('[ContentScript] Failed to send message:', err);
      // Message might fail if popup closed, but we have storage backup

      // Show notification to user to reopen popup
      try {
        await chrome.runtime.sendMessage({
          action: 'showNotification',
          title: 'SAGE - Capture Complete',
          message: 'Click the SAGE icon to analyze your product'
        });
        console.log('[ContentScript] Notification request sent');
      } catch (notifErr) {
        console.error('[ContentScript] Failed to request notification:', notifErr);
      }
    }

    // Keep the animation running for 3 seconds before cleanup
    console.log('[ContentScript] Waiting 3 seconds for animation to complete...');
    await new Promise(resolve => setTimeout(resolve, 3000));
  } catch (error) {
    console.error('[ContentScript] Failed to capture region:', error);
    alert('An error occurred while capturing the screenshot. Please try again.');
  } finally {
    console.log('[ContentScript] Cleaning up overlay...');
    cleanup();
  }
}

function cropImage(dataUrl: string, x: number, y: number, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      // B-F) DPI rounding for HiDPI displays
      const dpr = window.devicePixelRatio || 1;
      const sx = Math.round(x * dpr);
      const sy = Math.round(y * dpr);
      const sw = Math.round(width * dpr);
      const sh = Math.round(height * dpr);

      canvas.width = width;
      canvas.height = height;

      // Draw the cropped portion
      ctx.drawImage(
        img,
        sx, sy, sw, sh,
        0, 0, width, height
      );

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

function showScanningAnimation() {
  if (!selectionBox) return;

  console.log('[ContentScript] Starting barcode scanner animation...');

  // Create laser scanner line with red glow effect
  const scanBar = document.createElement('div');
  scanBar.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 3px;
    background: rgba(255, 50, 50, 0.9);
    box-shadow:
      0 0 10px rgba(255, 50, 50, 0.8),
      0 0 20px rgba(255, 50, 50, 0.6),
      0 0 30px rgba(255, 50, 50, 0.4);
    pointer-events: none;
    z-index: 10;
  `;

  // Inject CSS keyframes for up-down scanning animation
  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    @keyframes sage-barcode-scan {
      0% {
        top: 0%;
      }
      50% {
        top: 100%;
      }
      100% {
        top: 0%;
      }
    }
  `;
  document.head.appendChild(styleSheet);

  // Apply smooth up-down animation (1.5 seconds per cycle, runs for 3 seconds total = 2 cycles)
  scanBar.style.animation = 'sage-barcode-scan 1.5s ease-in-out infinite';

  // Add scan bar to selection box
  selectionBox.appendChild(scanBar);

  console.log('[ContentScript] Barcode scanner animation started');
}
