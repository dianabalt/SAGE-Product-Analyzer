# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Next.js** (Pages Router) web application that analyzes **cosmetic, beauty, supplement, and health product** ingredients for safety. Users can paste product URLs, manually enter ingredient lists, or use the SAGE Chrome Extension to scan product images. The app automatically extracts ingredients, grades them using OpenAI's API (0-100 scale with letter grades), and stores the results in Supabase.

**Key workflow:**
1. User submits a product URL (e.g., from Sephora, Ulta, INCIdecoder)
2. System attempts to extract ingredients via DOM scraping (`resolve-ingredients`)
3. If unsuccessful, falls back to web research via Tavily API (`research-ingredients`)
4. Ingredients are graded using OpenAI (`ai-grade`) with A-F scale, highlighting what ingredients make it good and what ingredients make it bad, also what are ingredients are just there like mutual. 
5. Results are stored in Supabase with user authentication

## Commands


### Development
```bash
npm run dev       # Start dev server at http://localhost:3000
npm run build     # Production build
npm start         # Start production server
npm run lint      # Run ESLint
```

### Environment Variables Required
Create `.env.local` in the `web/` directory:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
OPENAI_API_KEY=your_openai_key          # Server-side only
SEARCH_API_KEY=your_tavily_key          # Optional: for research fallback
```

## Architecture

### Pages & Routes
- **`/login`** - Supabase authentication
- **`/onboarding`** - First-time user setup (if needed)
- **`/dashboard`** - Main UI: add products, view history with grades
- **`/api/save-product`** - Orchestrates the full pipeline (resolve → research → grade → DB)
- **`/api/resolve-ingredients`** - Attempts DOM extraction from the product URL
- **`/api/research-ingredients`** - Tavily-powered web search fallback
- **`/api/ai-grade`** - OpenAI grading (A-F + issues + per-ingredient analysis)
- **`/api/find-alternatives`** - Finds 1-3 healthier product alternatives with better grades (85-90+)
- **`/api/find-deals`** - Searches top retailers for best prices (cached 24 hours)

### Key Libraries (`lib/`)
- **`supabaseServer.ts`** - Server-side Supabase client with cookie handling (API routes)
- **`supabaseClient.ts`** - Client-side Supabase client (browser)
- **`ingredientExtract.ts`** - Domain-aware HTML parsing (INCIdecoder, Sephora, Ulta, generic fallback)
  - Uses Cheerio to extract ingredient lists from specific site structures
  - Has domain-specific extractors: `extractFromInciDecoder()`, `extractFromSephora()`, etc.
  - Includes noise removal (e.g., "Also-called", "What-it-does" sections)
- **`productName.ts`** - Extracts product name from `<title>`, `og:title`, or URL path
- **`looksLikeIngredients.ts`** - Advanced validator to filter marketing copy and validate ingredient lists
  - **Marketing phrase detection**: Rejects text containing 40+ promotional phrases ("unlock potential", "made from pure", "without fillers", "our supplements", etc.)
  - **Pattern-based rejection**: Uses regex to immediately reject marketing sentences ("our herbal supplements are made", "supports health", "helps you", etc.)
  - **Strict validation**: Requires BOTH commas AND chemical names (INCI hints) to pass
  - **`stripMarketingCopy()`**: Filters out promotional sentences, keeps only ingredient lists
  - **Logging**: Detailed console logs for debugging why text was rejected
- **`grader.ts`** - (likely unused/legacy if `ai-grade.ts` is the active implementation)

### Data Flow (Product Submission)

1. **Dashboard** → POST `/api/save-product` with `{ product_url, product_title?, ingredients? }`
2. **Stage A** (DOM extraction):
   - Calls `/api/resolve-ingredients` → fetches URL → `extractBestIngredientsFromHtml(html, url)`
   - For Amazon/Walmart: skips DOM extraction, only returns product name (Stage B will research)
   - For others: attempts domain-specific extraction
3. **Stage B** (Research fallback):
   - If no ingredients found, calls `/api/research-ingredients`
   - Uses Tavily search with query `"{product_name} ingredients"`
   - Prefers authoritative domains (INCIdecoder, Sephora, etc.)
   - Validates results contain product name tokens in the page title
4. **Grading**:
   - If ingredients exist, calls `/api/ai-grade` → OpenAI chat completion
   - Model returns JSON: `{ grade: "A-F", issues: [...], perIngredient: [...], suggestions: [...] }`
5. **Storage**:
   - Inserts to `products` table with: `user_id`, `product_url`, `product_title`, `ingredients`, `grade`, `issues`, `sources`, `analysis` (JSONB)

## Database Schema (Supabase PostgreSQL)

### Core Tables

#### **`products`** - Main product storage with caching system
Stores all scanned products with ingredients, grades, and metadata.

**Columns**:
- `id` (UUID, PK) - Unique product identifier
- `user_id` (UUID, FK → auth.users) - Owner of this product scan
- `product_title` (TEXT) - Product name (e.g., "CeraVe Moisturizing Cream")
- `product_url` (TEXT, NOT NULL) - Source URL or 'extension://image-scan' for image scans
- `ingredients` (TEXT) - Comma-separated ingredient list
- `grade` (TEXT) - Letter grade A-F from OpenAI analysis
- `numeric_grade` (INTEGER) - Numeric score 0-100
- `beneficial_ingredients` (TEXT[]) - Array of good ingredients
- `issues` (TEXT[]) - Array of harmful/concerning ingredients
- `sources` (TEXT[]) - Array of URLs used for ingredient extraction
- `analysis` (JSONB) - Full AI response with per-ingredient details, suggestions, metadata
- `product_type` (TEXT) - 'FOOD' or 'COSMETIC' (GPT-classified or user-selected)
- `created_at` (TIMESTAMPTZ) - When product was first scanned
- `updated_at` (TIMESTAMPTZ) - Last manual edit timestamp (auto-updated via trigger)

**Indexes** (for fast caching and lookups):
- `products_user_id_idx` - User-specific queries
- `products_created_at_idx` - Recent products dashboard
- `products_product_title_idx` - Full-text search on product names
- `idx_products_product_type` - Filter by FOOD/COSMETIC
- `idx_products_url` - **Cache hit**: Exact URL match (fastest)
- `idx_products_title_lower` - **Cache hit**: Case-insensitive name match (same product, different URL)
- `idx_products_user_url` - User + URL composite (RLS optimized)
- `idx_products_user_title` - User + Name composite (RLS optimized)
- `idx_products_user_created` - User + created_at (dashboard sorting)
- `idx_products_user_updated` - User + updated_at (recently edited products)

**RLS Policies**:
- Users can only SELECT/INSERT/UPDATE/DELETE their own products (user_id = auth.uid())

**Triggers**:
- `products_updated_at` - Auto-updates `updated_at` column on any edit (for cache freshness tracking)

**Caching Strategy**:
1. Check cache by exact URL match (`idx_products_url`) - O(log n) lookup
2. If no match, check by product name (`idx_products_title_lower`) - handles same product on different sites
3. If found: Return cached result immediately (~100ms, $0 cost)
4. If not found: Run full extraction pipeline (~36s, $0.001 cost), then save to cache

---

#### **`product_alternatives`** - Better product recommendations
Caches healthier alternative products with grades ≥ 85 (B+).

**Columns**:
- `id` (UUID, PK)
- `source_product_id` (UUID, FK → products.id, CASCADE DELETE)
- `source_product_title` (TEXT) - Original product name
- `source_grade` (TEXT) - Original product grade
- `source_score` (INTEGER) - Original numeric score
- `alternative_title` (TEXT) - Alternative product name
- `alternative_url` (TEXT) - Alternative product URL
- `alternative_ingredients` (TEXT) - Alternative ingredient list
- `alternative_grade` (TEXT) - Alternative letter grade
- `alternative_score` (INTEGER) - Alternative numeric score (must be ≥ 85)
- `beneficial_ingredients` (TEXT[]) - Good ingredients in alternative
- `harmful_ingredients` (TEXT[]) - Bad ingredients in alternative
- `category` (TEXT) - Product category (e.g., 'sunscreen', 'moisturizer', 'protein powder')
- `search_query` (TEXT) - GPT-generated search query used
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

**Indexes**:
- `idx_alternatives_source_product` - Lookup alternatives for a specific product
- `idx_alternatives_score` - Sort by best score (DESC)
- `idx_alternatives_created` - Most recent alternatives

**RLS Policies**:
- Users can only view/insert alternatives for their own products (via source_product_id FK check)

**Unique Constraint**:
- `(source_product_id, alternative_url)` - Prevents duplicate alternatives

---

#### **`product_deals`** - Shopping price comparisons (24-hour cache)
Caches best deals and prices from retailers like Amazon, Walmart, Target.

**Columns**:
- `id` (UUID, PK)
- `product_id` (UUID, FK → products.id, CASCADE DELETE)
- `product_title` (TEXT) - Product name for display
- `retailer` (TEXT) - Retailer name (e.g., 'Amazon', 'Walmart', 'Target')
- `price` (DECIMAL(10,2)) - Price in currency
- `currency` (TEXT) - Default 'USD'
- `deal_url` (TEXT) - Direct link to product page
- `image_url` (TEXT) - Product image URL
- `availability` (TEXT) - 'In Stock', 'Out of Stock', etc.
- `rating` (DECIMAL(3,2)) - Average rating (e.g., 4.5)
- `review_count` (INTEGER) - Number of reviews
- `search_query` (TEXT) - Search query used
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)
- `expires_at` (TIMESTAMPTZ) - Auto-set to NOW() + 24 hours (deals expire daily)

**Indexes**:
- `idx_deals_product` - Lookup deals for specific product
- `idx_deals_expires` - Find expired deals for cleanup
- `idx_deals_price` - Sort by best price (ASC)

**RLS Policies**:
- Users can only view/insert deals for their own products (via product_id FK check)

**Unique Constraint**:
- `(product_id, retailer, deal_url)` - Prevents duplicate deals

**Auto-Cleanup**:
- Deals expire after 24 hours
- Function `cleanup_expired_deals()` removes old deals (should be run via cron job)

---

#### **`ingredient_suggestions`** - Autocomplete cache
Stores unique ingredients from scanned products for autocomplete suggestions.

**Columns**:
- `id` (UUID, PK)
- `user_id` (UUID, FK → auth.users)
- `ingredient` (TEXT) - Ingredient name (e.g., "Glycerin", "Niacinamide")
- `frequency` (INTEGER) - How many times this ingredient appeared in user's scans
- `last_seen` (TIMESTAMPTZ) - When this ingredient was last scanned
- `created_at` (TIMESTAMPTZ)

**Indexes**:
- `ingredient_suggestions_user_id_idx` - User-specific suggestions
- `ingredient_suggestions_ingredient_idx` - Fast ingredient lookup
- `ingredient_suggestions_frequency_idx` - Sort by most common (DESC)

**RLS Policies**:
- Users can only SELECT/INSERT/UPDATE their own ingredient suggestions

**Unique Constraint**:
- `(user_id, ingredient)` - One entry per ingredient per user (frequency increments on duplicates)

---

### Database Functions & Triggers

#### **`update_products_updated_at()`**
Trigger function that auto-updates `products.updated_at` column on any UPDATE.

**Purpose**: Track when products are manually edited (for cache freshness)

**Trigger**: `products_updated_at` BEFORE UPDATE ON products

#### **`update_updated_at_column()`**
Generic trigger function for updating `updated_at` on alternatives and deals tables.

**Triggers**:
- `update_alternatives_updated_at` BEFORE UPDATE ON product_alternatives
- `update_deals_updated_at` BEFORE UPDATE ON product_deals

#### **`cleanup_expired_deals()`**
Removes deals where `expires_at < NOW()`.

**Usage**: Should be called via cron job daily to clean up stale pricing data

---

### Row Level Security (RLS)

**All tables have RLS enabled** with policies enforcing user isolation:

1. **Products**: `user_id = auth.uid()` for all operations
2. **Alternatives**: `source_product_id IN (SELECT id FROM products WHERE user_id = auth.uid())`
3. **Deals**: `product_id IN (SELECT id FROM products WHERE user_id = auth.uid())`
4. **Ingredient Suggestions**: `user_id = auth.uid()` for all operations

This ensures users can ONLY see/modify their own data, even if they know product IDs.

---

### Database Migrations

Migration files located in `web/database-migrations/`:

1. **`supabase-schema.sql`** - Initial schema (products, ingredient_suggestions, base indexes, RLS)
2. **`database-schema.sql`** - Alternatives & deals tables (October 2025)
3. **`add-product-type.sql`** - Added `product_type` column for FOOD/COSMETIC classification
4. **`add-product-caching.sql`** - Added caching indexes and updated_at trigger (October 2025)

**To apply migrations**: Copy SQL from migration files → Supabase SQL Editor → Run

---

### Caching System Performance

**Fresh Product Scan** (no cache hit):
- Duration: ~36 seconds
- Cost: $0.001 (OpenAI grading + optional research)
- Steps: DOM extraction → Research fallback → Validation → Grading → Save to DB

**Cached Product Scan** (cache hit):
- Duration: ~100ms (360x faster)
- Cost: $0 (85% cost reduction)
- Steps: Database lookup by URL/name → Return existing result

**Manual Edit with Re-grading**:
- User edits ingredients via dashboard or extension
- System detects change (significant diff check)
- Auto-triggers re-grading via `/api/ai-grade`
- Updates `updated_at` timestamp
- Cache returns updated version on next scan

### Authentication Flow
- Uses Supabase Auth with cookies (`@supabase/ssr`)
- Server-side: `getSupabaseServer(req, res)` in API routes
- Client-side: `supabase.auth.getUser()` in pages
- Redirects unauthenticated users from `/dashboard` → `/login`

## Chrome Extension (`sage-extension/`)

A **Manifest V3** Chrome extension that allows users to scan product images and analyze ingredients directly from their browser.

### Structure
```
sage-extension/
├── public/
│   ├── manifest.json        # Extension manifest (v3)
│   └── icons/               # Extension icons
├── src/
│   ├── popup/
│   │   ├── popup.html       # Extension popup entry point
│   │   ├── popup.tsx        # Main React app for popup UI
│   │   ├── styles.css       # Global styles
│   │   └── components/      # React components (AuthView, ScanView, ResultsView, etc.)
│   ├── background/
│   │   └── service-worker.ts  # Background service worker for extension
│   ├── lib/
│   │   ├── supabase.ts      # Supabase client (shares auth with web app)
│   │   ├── api.ts           # API helpers to communicate with web app
│   │   ├── screenshot.ts    # Image capture utilities
│   │   └── storage.ts       # Chrome storage helpers
│   └── types/
│       └── index.ts         # TypeScript type definitions (ScanResult, etc.)
└── dist/                    # Build output (generated by Vite)
```

### Key Features
- **Image Scanning**: Upload images or capture screenshots of products
- **OCR & Analysis**: Sends images to `/api/extension/scan` for ingredient extraction via OpenAI Vision
- **AI Grading**: Uses same grading pipeline as web app (A-F scale, beneficial/concerning ingredients)
- **Sync with Web App**: Shares Supabase authentication, results sync to web dashboard
- **Sage Green UI**: Tailwind CSS with sage theme matching web app

### Development Commands
```bash
cd sage-extension
npm install           # Install dependencies
npm run build         # Build extension to dist/
npm run dev           # Development mode with hot reload
```

### Loading in Chrome
1. Build the extension: `npm run build`
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" → Select `sage-extension/dist/` folder

### Integration with Web App
- **Authentication**: Uses same Supabase instance as web app for seamless auth
- **API Endpoints**:
  - `POST /api/extension/scan` - OCR ingredient extraction from images via OpenAI Vision
  - `GET /api/extension/history` - Fetch user's scan history (used by extension HistoryView)
- **History Sync**: Extension uses API endpoint (not direct Supabase queries) to ensure auth consistency
- **Product Saving**: Scans are automatically saved to Supabase and visible on both extension and website
- **Configuration**: Update `SUPABASE_URL`, `SUPABASE_ANON_KEY` in `src/lib/supabase.ts` and `API_BASE_URL` in `src/lib/api.ts`

## Core Features

### Find Better Alternatives
**Location**: Extension ResultsView, Website Dashboard (below each product)
**Button Style**: Sage green (#7e9a7c) with clipboard checkmark icon

**NEW GPT-First Workflow (October 2025 Overhaul)**:
1. User clicks "Find Better Alternatives" on a scanned product
2. **GPT Categorization**: OpenAI analyzes product name/ingredients to determine:
   - Specific category (e.g., "mineral sunscreen", "vitamin D3 supplement", "whey protein powder")
   - General product type (skincare, beauty, supplement, food)
3. **GPT Recommendations**: OpenAI recommends 5 specific alternative products:
   - Exact brand names and full product names
   - Reasoning for each recommendation
   - Category-aware health criteria (bioavailability for supplements, minimal processing for food, etc.)
4. **Category-Aware Search**: For each GPT recommendation:
   - Searches for specific product (e.g., "CeraVe Mineral Sunscreen SPF 30")
   - Uses product-type-specific domains:
     - Supplements: iHerb, Vitacost, Amazon, Target, Walmart
     - Food: OpenFoodFacts, Amazon, Target, Walmart
     - Beauty/Skincare: INCIdecoder, Skinsort, Sephora, Ulta, Dermstore
5. **Ingredient Extraction & Grading**:
   - Extracts ingredients via DOM scraping
   - Falls back to research if needed
   - Grades product using OpenAI API
   - Only includes if score ≥ **85 (B+ threshold)** AND better than source product
6. Returns top 3 alternatives sorted by score (highest first)
7. Results cached in `product_alternatives` table
8. Maximum 5 product grading attempts to keep response time reasonable (30-60 seconds)

**Key Improvements (GPT-First Approach)**:
- **Fixes Core Bug**: Old system searched generically ("best cleanest sunscreen"), found specific products, then validated page contains generic terms → always failed. New system has GPT recommend specific products first, then searches for those exact products.
- **Multi-Category Support**: Works for beauty, skincare, supplements, AND food products
- **Smarter Recommendations**: GPT understands product context and suggests real alternatives with documented ingredient lists
- **Higher Quality**: B+ threshold (85+) ensures only high-quality alternatives are shown

**Display** (Extension):
- Dedicated `AlternativesView.tsx` component
- Shows grade badges, safety scores, score improvement
- Lists beneficial/harmful ingredients
- "Top Pick" badge for highest-scoring alternative
- Direct links to product pages

**Display** (Website):
- Expandable section below product card
- Side-by-side grid layout with grade comparisons
- Score bars and improvement indicators
- Links to alternative product pages

### Find Best Deal
**Location**: Extension ResultsView, Website Dashboard (below each product)
**Button Style**: Standard sage button with price tag icon

**Workflow**:
1. User clicks "Find Best Deal" on a product
2. System tries Google Shopping scraping first (if enabled)
3. Falls back to Tavily search across retailers:
   - Amazon, Walmart, Target
   - Sephora, Ulta, DermStore
   - iHerb, Vitacost (for supplements)
4. Extracts prices, availability, ratings from results
5. Returns top 5 deals sorted by price (lowest first)
6. Results cached in `product_deals` table (24-hour TTL)

**Display** (Extension):
- Dedicated `DealsView.tsx` component
- "Best Deal" highlight with green badge
- Retailer badges with custom colors/icons
- Price, availability, ratings
- Direct "Shop Now" buttons

**Display** (Website):
- Expandable section below product card
- List of retailers with prices
- Color-coded by retailer
- Direct "View Deal" links
- Disclaimer about price changes

**Caching Strategy**:
- Alternatives: Permanent cache (until manually refreshed)
- Deals: 24-hour expiration (`expires_at` timestamp)
- RLS policies ensure users only see their own data

## Recent Updates (October 2025)

### Better Alternatives & Best Deal Features (October 2025)
**Added intelligent product recommendation and price comparison features to both extension and website**

**Backend Changes**:
- Created `/api/find-alternatives` endpoint with GPT-powered product categorization and recommendations
- Created `/api/find-deals` endpoint with multi-retailer search (Tavily with fallback)
- Added `product_alternatives` and `product_deals` tables to Supabase (see `database-schema.sql`)
- **Alternatives API**: Uses GPT-first approach to recommend specific products, only returns products with score ≥ 85 (B+ threshold)
- **Deals API**: Caches results for 24 hours, shows product names/sizes with unit pricing
- Category-aware domain selection (different sources for supplements vs skincare vs food)
- Limited to 5 product grading attempts per search for faster response (30-60 seconds)

**Extension Changes**:
- Added `AlternativesView.tsx` component with sage green theme
- Added `DealsView.tsx` component with retailer-specific styling
- Updated `ResultsView.tsx` with two new buttons:
  - "Find Better Alternatives" (sage green #7e9a7c)
  - "Find Best Deal" (replaces Google search with in-app display)
- Updated `popup.tsx` with view state management
- Navigation: Results → Alternatives/Deals → Back to Results

**Website Changes**:
- Added alternatives/deals state management to `dashboard.tsx`
- Side-by-side button layout: "Find Better Alternatives" + "Find Best Deal"
- Expandable sections below each product card
- Loading states with spinners
- Toggle show/hide for alternatives and deals
- Fully responsive design

### Chrome Extension UI/UX Overhaul (Latest)
- **Button Consistency & Order**: Standardized all button styles across extension with three variants:
  - **Primary**: Sage green background (`bg-sage-500`) for main actions (View Full Details, View on SAGE Website)
  - **Secondary**: White background with sage border (`border-sage-500`) for auxiliary actions (Find Best Deal, Manually Edit)
  - **Tertiary**: Light sage background (`bg-sage-100`) for navigation actions (Scan Another Product)
  - All buttons include consistent `font-medium py-2.5 border-2 rounded-lg` styling with `focus-visible` accessibility outlines

- **Fixed Button Order**:
  - **Summary View**: View Full Details (PRIMARY) → View on SAGE Website (SECONDARY) → Find Best Deal → Manually Edit → Scan Another Product (TERTIARY)
  - **Full Details View**: View on SAGE Website (PRIMARY) → Find Best Deal → Manually Edit → Scan Another Product (TERTIARY)

- **Full Details Layout Redesign**:
  - Changed from fixed `max-h-[500px]` to full-height sticky header/footer layout
  - Header: `shrink-0 sticky top-0` with backdrop-blur
  - Main content: `grow overflow-y-auto` for scrollable ingredient list
  - Footer: `shrink-0 sticky bottom-0` with backdrop-blur for action buttons
  - Now takes up entire side panel height with proper scrolling

- **Cancel Button Navigation Fix**:
  - Added `previousResult` state to track navigation history
  - Cancel from Manual Entry now correctly returns to results view when editing from results
  - Only shows error prompt when canceling from a fresh extraction failure

- **Popup Layout Fix**: Added `flex-col` to content container to prevent heading from appearing side-by-side with buttons

- **Fixed History Display**: Changed `HistoryView.tsx` to use `/api/extension/history` endpoint instead of direct Supabase queries, resolving auth/user ID mismatch issues
- **Removed False Login Alert**: Removed "Please log in to extension" alert that appeared even when history loaded successfully

### Snipping Tool Robustness & Reliability (Latest)
**Problem**: Snipping tool had intermittent failures - sometimes worked, sometimes hung indefinitely, sometimes overlay stayed up without capturing

**Root Causes Identified**:
1. Complex handshake/ACK message passing causing race conditions
2. Message channel closing before responses received
3. Permission errors when switching tabs (activeTab only works on clicked tab)
4. Duplicate `startSnipping` messages sent (ScanButton + screenshot.ts)

**Solutions Implemented**:

1. **Simplified Message Passing**:
   - Removed complex handshake ACK check that was causing "Content script did not acknowledge" errors
   - Removed popup message listener that caused message channel closed errors
   - Reverted to simple, reliable flow: send startSnipping → poll storage for result
   - All coordination now happens through chrome.storage.local polling (more reliable than message passing)

2. **Fixed Permission Error**:
   - Changed manifest.json to use `"host_permissions": ["<all_urls>"]` instead of relying only on `activeTab`
   - Extension can now capture screenshots on any tab, not just the one where icon was clicked
   - Critical for side panel use case where extension stays open while user switches tabs

3. **Kept DPI Rounding Improvement**:
   - Added `Math.round()` to DPI-scaled coordinates in `cropImage()` function
   - Prevents 1px white borders on HiDPI/Retina displays
   - Located in `sage-extension/src/content/snippingTool.ts` cropImage function

4. **Current Reliable Flow**:
   ```
   1. User clicks "Capture Screen Scan"
   2. handleSnippingTool() → captureWithSnippingTool()
   3. screenshot.ts sends startSnipping to content script
   4. Content script shows overlay, waits for selection
   5. On selection, captures and stores in chrome.storage.local
   6. Popup polls storage every 200ms for result
   7. When found, processes image (works even if popup closes/reopens)
   8. 60-second timeout prevents infinite hangs
   ```

5. **Files Changed**:
   - `sage-extension/public/manifest.json` - Added `<all_urls>` to host_permissions
   - `sage-extension/src/popup/components/ScanButton.tsx` - Simplified snipping handler, removed ACK check
   - `sage-extension/src/content/snippingTool.ts` - Simplified cleanup, added DPI rounding
   - `sage-extension/src/background/service-worker.ts` - Hardened captureTab with async/await and fallbacks

### Find the Best Deal Feature
- **Extension**: Added sage green "Find the Best Deal" button in both summary and detailed views
- **Website**: Added matching button to dashboard product cards
- **Functionality**: Opens Google Shopping search with product name in new tab
- **Styling**: Sage green (`bg-sage-600`) with price tag icon to match SAGE aesthetic

### Skinsort Active Ingredients Extraction Fix
**Problem**: Skinsort product pages were missing active ingredients - only extracting 15 inactive ingredients, missing the 1 active ingredient (e.g., "Pyrithione Zinc 2%")

**Root Cause**: Using `.next()` in while loop only traversed direct siblings, missing ingredient links nested in container divs

**Solution Implemented** (`web/lib/ingredientExtract.ts` - `extractFromSkinsort()`):
- Rewrote using `.nextUntil()` strategy to collect ALL elements between "Active Ingredients" and "Inactive Ingredients" headings
- Used `.find('a[data-ingredient-id]')` to search for nested ingredient links within those elements
- Active ingredients now listed FIRST in the combined output, followed by inactive ingredients
- Successfully extracts both active and inactive ingredients (e.g., 16 total: 1 active + 15 inactive)

**Key Code Change**:
```typescript
// OLD: Only got direct sibling
let current = activeHeading.next();

// NEW: Gets all elements between headings, searches nested
const betweenElements = activeHeading.nextUntil(inactiveHeading);
betweenElements.each((_, el) => {
  $(el).find('a[data-ingredient-id]').each((__, anchor) => {
    // Extract ingredient text
  });
});
```

### Ingredient Extraction - Marketing Copy Filter
**Problem**: Marketing copy was being extracted as ingredients (e.g., "Our Herbal Supplements are made from pure, without fillers...")

**Solutions Implemented**:

1. **Enhanced OpenAI Vision Prompt** (`/api/extension/scan`):
   - Step-by-step instructions for AI to locate "Supplement Facts" panels
   - Explicit examples of what to include vs. ignore
   - Strong emphasis on extracting ONLY actual ingredient names
   - Validation requirements in prompt (3+ ingredients, comma-separated, no marketing)

2. **Marketing Copy Filter** (`looksLikeIngredients.ts`):
   - Added 40+ marketing phrases: "unlock potential", "made from", "without fillers", "our supplements", "helps you", "supports", "promotes", etc.
   - Pattern-based immediate rejection using regex for common marketing sentences
   - Sentence-level filtering: removes any sentence containing marketing language
   - Requires BOTH commas AND chemical/botanical names (INCI hints) to pass

3. **Post-Processing Validation** (all extraction endpoints):
   - `/api/extension/scan`: Validates image OCR results before accepting
   - `/api/resolve-ingredients`: Strips marketing from DOM-extracted text
   - `/api/research-ingredients`: Validates web search results
   - All use `stripMarketingCopy()` → `looksLikeIngredients()` pipeline

4. **Validation Logic**:
   ```
   Extract → Strip Marketing → Validate Format → Accept/Reject
   - Must have commas (list format)
   - Must have chemical names (glycerin, sodium, cholecalciferol, etc.)
   - Must NOT have 2+ marketing phrases
   - Must NOT match marketing sentence patterns
   - Sentences must be 20+ chars and contain both commas + chemical names
   ```

5. **Debug Logging**: All validation steps log reasons for rejection:
   - `✅ passed validation`
   - `⚠️ failed validation (marketing copy or invalid format)`
   - `REJECTED: Contains marketing sentence pattern`

### OpenFoodFacts Support for Food Products (October 2025)

**Problem**: Previous ingredient extraction failed for food products (protein powders, supplements, packaged foods) because:
- Skinsort/INCIdecoder are designed exclusively for cosmetics/skincare
- Amazon DOM extraction often fails or returns poor quality data
- No fallback source existed specifically for food/nutrition products

**Solution Implemented**: Added **world.openfoodfacts.org** as TIER 2 fallback source in research pipeline

**Changes Made**:

1. **Added to Preferred Domains** (`research-ingredients.ts` line 203):
   - Positioned in TIER 2 (specialized databases) after INCIdecoder/Skinsort
   - Included in `isAuthoritative()` function for prioritization

2. **Created OpenFoodFacts DOM Extractor** (`ingredientExtract.ts` line 1083):
   - `extractFromOpenFoodFacts()` function with 4 extraction strategies:
     1. **#panel_ingredients_content** - Primary panel selector
     2. **Embedded JSON** - Extracts from `var product = {...}` JavaScript object
     3. **Element search** - Looks for `[class*="ingredient"]` or `[id*="ingredient"]`
     4. **Generic text search** - Finds "Ingredients:" label followed by comma-separated list
   - Registered in `extractBestIngredientsFromHtml()` at Priority 2.6 (line 1355)

3. **Integration Points** - Works across all scan methods:
   - **Website URL input**: `/api/save-product` → DOM extraction → research-ingredients fallback
   - **Extension "Scan Current Page"**: DOM extraction with page_url → research-ingredients fallback
   - **Extension Snipping Tool**: OCR → research-ingredients fallback

**Fallback Priority Order** (after changes):
1. ✅ Government sources (DailyMed, FDA, NIH)
2. ✅ Skincare databases (INCIdecoder, Skinsort)
3. ✅ **NEW: OpenFoodFacts** ← Food products
4. ✅ Brand websites (Sephora, Ulta, etc.)
5. ✅ Retail sites (Amazon, Target, etc.)

**Testing**: Successfully extracts ingredients from protein powders, supplements, and packaged food products. OpenFoodFacts provides comprehensive ingredient data for 2M+ food products globally.

### GPT-First Better Alternatives System Overhaul (October 2025)

**Problem**: The original Better Alternatives system had a critical circular logic bug:
```
Generic Search → Specific Products → Generic Validation → FAIL
"best healthiest sunscreen" → "Paula's Choice Vitamin C SPF50" →
Check if page contains "best healthiest sunscreen" → NO → REJECTED
```
This caused the system to always return 0 alternatives, even for low-graded products (C+) that needed better options.

**Solution Implemented**: Complete redesign to **GPT-first recommendation system** that eliminates circular validation logic.

**New Architecture** (`web/pages/api/find-alternatives.ts`):

1. **GPT Product Categorization** (lines 8-63):
   - Function: `getProductCategory(productTitle, ingredients)`
   - Uses GPT-4o-mini with temperature 0.1 for precise categorization
   - Returns: `{category: "mineral sunscreen", productType: "skincare"}`
   - Supports: beauty, skincare, supplements, food products
   - Fallback: Regex-based `detectCategory()` if GPT fails

2. **GPT Product Recommendations** (lines 100-196):
   - Function: `getGPTProductRecommendations()`
   - Uses GPT-4o-mini with temperature 0.3 for creative but focused recommendations
   - Product type-specific language:
     - Supplements: "bioavailability", "minimal fillers", recommends from iHerb/Vitacost
     - Food: "whole food ingredients", "minimal processing", recommends from Whole Foods/Target
     - Beauty/Skincare: "non-toxic", "cleaner formulations", recommends from Sephora/Ulta
   - Returns: 5 specific products with exact brand names, full product names, and reasoning
   - Example: `{brand: "CeraVe", product: "Mineral Sunscreen SPF 30", reasoning: "Uses zinc oxide instead of chemical filters"}`

3. **Category-Aware Product Search** (lines 292-367):
   - Function: `findProductUrl(searchQuery, productType)`
   - Searches for specific product by exact name (e.g., "CeraVe Mineral Sunscreen SPF 30")
   - Domain selection based on product type:
     - Supplements: iHerb, Vitacost, Amazon, Target, Walmart
     - Food: OpenFoodFacts, Amazon, Target, Walmart
     - Beauty/Skincare: INCIdecoder, Skinsort, Sephora, Ulta, Dermstore
   - Returns: First URL matching product page patterns

4. **Updated Main Handler** (lines 505-621):
   - Step 1: GPT categorization (with regex fallback)
   - Step 2: GPT recommendations (returns 5 specific products)
   - Step 3: For each recommendation (max 5 attempts):
     - Search for specific product URL
     - Extract ingredients via DOM
     - Grade product using OpenAI
     - Include if score ≥ 85 (B+) AND better than source
   - Returns: Top 3 alternatives sorted by score

**Key Changes**:
- **Threshold Updated**: 75 → **85 (B+ only)** throughout codebase
- **Cache Query**: Updated to filter `alternative_score >= 85`
- **Error Messages**: Updated to mention "B+ alternatives" instead of generic "alternatives"
- **Removed Old Functions**: Deleted `generateAlternativeSearchQuery()` and `searchAlternatives()`
- **Response Format**: Uses JSON with `response_format: { type: "json_object" }` for reliable parsing

**Benefits**:
- ✅ **Fixes Core Bug**: No more circular validation failures
- ✅ **Smarter Recommendations**: GPT understands product context and suggests real alternatives
- ✅ **Multi-Category Support**: Works for beauty, skincare, supplements, AND food
- ✅ **Higher Quality**: B+ threshold ensures only top-tier alternatives
- ✅ **Category-Aware**: Different health criteria and domains for different product types
- ✅ **Better Success Rate**: Searches for specific products by name instead of generic queries

**Testing Recommendations**:
Test with various product types to verify GPT categorization and recommendations:
- Skincare: Sunscreen, moisturizer, serum
- Beauty: Makeup, hair care
- Supplements: Vitamin D, protein powder, multivitamin
- Food: Protein bars, packaged snacks

## Known Issues / TODOs

- **Extension History Sync**: Delete function in extension HistoryView needs debugging - items reappear after refresh even though deletion succeeds. Detailed logging added (`[HistoryView] Deleting product...`, `[HistoryView] ✅ Product deleted successfully`). Likely issue: Supabase RLS policies or authentication context in extension. When delete is called, check browser console for error logs. If deletion succeeds but item reappears after clicking Refresh, this indicates a database permission or session issue that needs investigation.

## Development Notes

- **DOM Extraction**: When adding support for new product sites, add domain-specific logic to `ingredientExtract.ts` (follow pattern of `extractFromSephora`, etc.)
- **AI Grading**: Model prompt is in `ai-grade.ts`. Current model: `gpt-4o-mini` (configurable via `OPENAI_MODEL`)
- **Ingredient Validation**: ALWAYS use `stripMarketingCopy()` then `looksLikeIngredients()` on extracted text to filter marketing copy
- **Research Quality**: Tavily search excludes Amazon by default (poor ingredient data). Prefers INCIdecoder when available.
- **Error Handling**: Most API routes return `200` even on errors with `{ error: ... }` to prevent client crashes
- **Logging**: Heavy console logging in API routes (prefixed with `[SAVE]`, `[A:resolve]`, `[B:research]`, `[EXTENSION_SCAN]`) for debugging pipeline
