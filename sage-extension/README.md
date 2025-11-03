# SAGE Chrome Extension

**Product Ingredient Analyzer** - Scan products and analyze ingredients for safety with AI-powered grading.

## Features

- 🌿 **Sage Green UI** - Beautiful, calming color scheme
- 📸 **Image Scanning** - Capture or upload product images
- 🔐 **Secure Authentication** - Supabase integration with web app
- 🎯 **AI-Powered Analysis** - Smart ingredient grading (0-100 scale)
- ✅ **Beneficial Ingredients** - Highlights what's good
- ⚠️ **Concerning Ingredients** - Flags potential issues
- 📊 **Full History** - Sync with web dashboard

## Installation

### For Development

1. **Install dependencies**
   ```bash
   cd sage-extension
   npm install
   ```

2. **Configure environment**
   - Edit `src/lib/supabase.ts` and add your Supabase URL and anon key
   - Edit `src/lib/api.ts` and update `API_BASE_URL` to your web app URL

3. **Build the extension**
   ```bash
   npm run build
   ```

4. **Load in Chrome**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `dist/` folder from this extension directory

5. **Start using**
   - Click the SAGE extension icon in your toolbar
   - Create an account or sign in
   - Start scanning products!

### For Production

1. Build the extension:
   ```bash
   npm run build
   ```

2. Zip the `dist/` folder

3. Upload to Chrome Web Store Developer Dashboard

## Development

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build production extension
- `npm run preview` - Preview production build

### Project Structure

```
sage-extension/
├── public/
│   ├── manifest.json       # Extension manifest
│   └── icons/              # Extension icons (16, 48, 128px)
├── src/
│   ├── popup/
│   │   ├── popup.html      # Extension popup entry
│   │   ├── popup.tsx       # Main React app
│   │   ├── styles.css      # Global styles
│   │   └── components/     # React components
│   ├── background/
│   │   └── service-worker.ts  # Background script
│   ├── lib/
│   │   ├── supabase.ts     # Supabase client
│   │   ├── api.ts          # API helpers
│   │   ├── screenshot.ts   # Image capture
│   │   └── storage.ts      # Chrome storage
│   └── types/
│       └── index.ts        # TypeScript types
└── dist/                   # Build output
```

## Configuration

### Supabase Setup

Edit `src/lib/supabase.ts`:

```typescript
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';
```

### API URL

Edit `src/lib/api.ts`:

```typescript
const API_BASE_URL = 'https://your-app.com'; // Production URL
```

## User Guide

### First Time Use

1. **Install** the extension from Chrome Web Store
2. **Click** the SAGE icon in your toolbar
3. **Create Account** - You'll be redirected to the web app
4. **Return** to extension and sign in
5. **Start scanning** products!

### Scanning a Product

**Option 1: Upload Image**
- Click "Upload Product Image"
- Take a photo or select from gallery
- Wait for analysis

**Option 2: Screenshot**
- Navigate to a product page
- Click "Capture Screenshot"
- Extension captures the visible page
- Wait for analysis

### Viewing Results

- **Grade** - A+ to F scale (with 0-100 numeric score)
- **Beneficial Ingredients** - Green tags showing what's good
- **Concerning Ingredients** - Red tags showing potential issues
- **Full Details** - Click to view on web dashboard

## API Integration

The extension communicates with the web app via these endpoints:

- `POST /api/extension/scan` - Upload image for analysis
- `POST /api/save-product` - Save scanned product
- Authentication via Supabase session tokens

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling with sage green theme
- **Vite** - Build tool
- **Supabase** - Authentication & database
- **Chrome Extension Manifest V3**

## Troubleshooting

### Extension won't load
- Check that you built the extension (`npm run build`)
- Make sure you selected the `dist/` folder when loading
- Check Chrome console for errors

### Can't sign in
- Verify Supabase credentials in `src/lib/supabase.ts`
- Check that web app is running
- Clear extension storage: `chrome.storage.local.clear()`

### Scan not working
- Ensure backend API is running
- Check API_BASE_URL is correct
- Verify OpenAI API key is configured (for image OCR)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues or questions:
- Open an issue on GitHub
- Email: support@sage-app.com
- Documentation: https://docs.sage-app.com

---

**Made with 🌿 by the SAGE team**
