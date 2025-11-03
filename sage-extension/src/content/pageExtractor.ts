// sage-extension/src/content/pageExtractor.ts
// Content script that extracts full page HTML for ingredient analysis

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'extractPageData') {
    try {
      console.log('[PageExtractor] Extracting page data...');

      // Get the current page URL
      const pageUrl = window.location.href;

      // Get the full HTML content
      const html = document.documentElement.outerHTML;

      // Extract basic metadata
      const title = document.title;
      const hostname = window.location.hostname;

      // Get visible text content (for debugging)
      const bodyText = document.body.innerText;

      console.log('[PageExtractor] Extracted:', {
        url: pageUrl,
        hostname,
        htmlSize: html.length,
        bodyTextSize: bodyText.length,
        title
      });

      // Send back the extracted data
      sendResponse({
        success: true,
        data: {
          url: pageUrl,
          html: html,
          title: title,
          hostname: hostname,
          timestamp: Date.now()
        }
      });
    } catch (error) {
      console.error('[PageExtractor] Error:', error);
      sendResponse({
        success: false,
        error: (error as Error).message
      });
    }
  }

  // Return true to indicate we'll send a response asynchronously
  return true;
});

console.log('[PageExtractor] Content script loaded and ready');
