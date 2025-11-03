# SAGE Extension Quick Start

## Get Started in 5 Minutes

### Step 1: Configure Supabase
Edit `src/lib/supabase.ts`:

```typescript
const SUPABASE_URL = 'YOUR_SUPABASE_URL_HERE';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';
```

Get these values from:
- Your Supabase project dashboard → Settings → API
- Copy the "Project URL" and "anon public" key

### Step 2: Configure API URL
Edit `src/lib/api.ts`:

```typescript
const API_BASE_URL = 'http://localhost:3000'; // For local development
// OR
const API_BASE_URL = 'https://your-app.com'; // For production
```

### Step 3: Install & Build
```bash
cd sage-extension
npm install
npm run build
```

This creates the `dist/` folder with your extension files.

### Step 4: Load in Chrome
1. Open Chrome and go to: `chrome://extensions/`
2. Toggle **"Developer mode"** ON (top right)
3. Click **"Load unpacked"**
4. Select the `dist/` folder from this directory
5. Done! The SAGE icon appears in your toolbar

### Step 5: Test It
1. Click the SAGE extension icon
2. If you don't have an account:
   - Click "Create Account" → Opens web app
   - Sign up on web app
   - Return to extension and login
3. If you have an account:
   - Enter your credentials
   - Click "Upload Product Image"
   - Select a product photo
   - View the results!

## Development Mode

For live development with hot reload:

```bash
npm run dev
```

Then follow Step 4 above to load the extension. Changes will rebuild automatically.

## Troubleshooting

**Can't see the extension icon?**
- Make sure you built the extension (`npm run build`)
- Check Extensions page shows SAGE and it's enabled

**Login not working?**
- Verify Supabase credentials in `src/lib/supabase.ts`
- Check web app is running
- Open Chrome DevTools → Console for errors

**Scan not working?**
- Backend API route `/api/extension/scan` currently returns placeholder data
- To enable real scanning: Implement OpenAI Vision API in `web/pages/api/extension/scan.ts`
- Follow TODO comments in that file

## Next Steps

1. **Add Icons**: Replace placeholders in `public/icons/` with actual 16x16, 48x48, 128x128 PNG icons
2. **Enable OCR**: Implement OpenAI Vision API in `/api/extension/scan.ts`
3. **Test Flow**: Create account → Login → Upload image → View results
4. **Deploy**: Build for production and submit to Chrome Web Store

## Need Help?

See full documentation in `README.md`
