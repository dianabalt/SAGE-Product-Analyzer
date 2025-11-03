# GPT Product Classification Implementation

## Overview

This implementation replaces the rule-based multi-signal product detection with a GPT-based classification system that determines whether a product is FOOD or COSMETIC.

## What Changed

### 1. Backend Changes

#### New File: `web/lib/productClassifier.ts`
- Core GPT classification logic using GPT-4o-mini
- Returns: product type, confidence (0-100), and reasoning
- Cost: ~$0.0001 per classification
- Temperature: 0.1 (precise/deterministic)

#### Modified: `web/pages/api/research-ingredients.ts`
- **REMOVED**: 80+ lines of multi-signal detection code
  - FOOD_BRANDS array (30+ brands)
  - PROTEIN_TERMS, FLAVOR_TERMS, SUPPLEMENT_ONLY arrays
  - FOOD_SIZE_PATTERN regex
  - All foodSignals calculation logic
- **ADDED**: GPT classification with 80% confidence threshold
- **ADDED**: User override support (manual selection = 100% confidence)
- **ADDED**: Returns `needsUserInput` flag when confidence < 80%
- **ADDED**: Returns `productType` in response for database storage

#### Modified: `web/pages/api/save-product.ts`
- Accepts `product_type` parameter from frontend
- Passes `product_type` to research-ingredients API
- Handles `needsUserInput` response from research API
- Captures GPT classification from response
- Saves `product_type` to database

### 2. Frontend Changes (Website)

#### New File: `web/components/ProductTypeSelector.tsx`
- UI component for manual product type selection
- Shows AI reasoning and confidence percentage
- Two large buttons: 🍎 Food Product and 💄 Cosmetic Product
- Displays which option is AI suggested
- Inline display during scan (not modal/separate page)

#### Modified: `web/pages/dashboard.tsx`
- Added classification state management:
  - `showTypeSelector` - controls UI visibility
  - `pendingClassification` - stores GPT response data
  - `selectedProductType` - stores user selection
- Added handler functions:
  - `handleTypeSelect()` - retries save with selected type
  - `handleTypeCancel()` - resets state and cancels scan
- Checks for `needsUserInput` in API response
- Shows ProductTypeSelector inline during scan
- Passes `selectedProductType` to save-product API

### 3. Frontend Changes (Extension)

#### New File: `sage-extension/src/popup/components/ProductTypeSelector.tsx`
- Compact version optimized for side panel
- Same functionality as website version
- Smaller text sizes and narrower layout
- Truncates long product names (50 chars)

#### Modified: `sage-extension/src/types/index.ts`
- Added `'awaiting_classification'` to `ScanState` enum

#### Modified: `sage-extension/src/popup/components/ScanButton.tsx`
- Added classification state variables:
  - `needsClassification` - stores needsUserInput response
  - `pendingImageData` - stores image/HTML for retry
  - `pendingPageUrl` - stores page URL for retry
  - `selectedProductType` - stores user selection
- Added handler functions:
  - `handleTypeSelect()` - detects image vs page scan and retries with type
  - `handleTypeCancel()` - resets state
- Updated `processImage()` to check for `needsUserInput`
- Updated `handleScanCurrentPage()` to check for `needsUserInput`
- Added ProductTypeSelector rendering in JSX

#### Modified: `sage-extension/src/lib/api.ts`
- Updated `scanImage()` signature to accept optional `productType` parameter
- Updated `scanPage()` signature to accept optional `productType` parameter
- Both functions pass `product_type` to backend API

### 4. Database Changes

#### Migration File: `web/database-migrations/add-product-type.sql`
- Adds `product_type` TEXT column to `products` table
- Adds check constraint: values must be 'FOOD' or 'COSMETIC'
- Creates index for filtering by product_type
- Best-effort backfill of existing records based on URL patterns
- Column comment for documentation

## How It Works

### Flow Diagram

```
User Scans Product
    ↓
Extract Product Name
    ↓
GPT Classification (productClassifier.ts)
    ├─ Confidence ≥ 80% → Continue with auto-detected type
    └─ Confidence < 80% → Show ProductTypeSelector UI
                              ↓
                         User Selects Type
                              ↓
                         Retry with Selection (100% confidence)
    ↓
Search for Ingredients (using product type)
    ├─ FOOD → OpenFoodFacts, iHerb, etc.
    └─ COSMETIC → INCIdecoder, Skinsort, etc.
    ↓
Grade Ingredients
    ↓
Save to Database (with product_type)
```

### Example Classification

**Product**: "Blue Bell Cookies 'n Cream Ice Cream"

**GPT Response**:
```json
{
  "type": "FOOD",
  "confidence": 95,
  "reasoning": "Blue Bell is an ice cream brand. Ice cream is a frozen dairy dessert consumed as food, not a cosmetic product."
}
```

**Result**: Automatically classified as FOOD (confidence ≥ 80%), searches OpenFoodFacts for ingredients

**Product**: "CeraVe Daily Moisturizing Lotion"

**GPT Response**:
```json
{
  "type": "COSMETIC",
  "confidence": 98,
  "reasoning": "CeraVe is a skincare brand. Moisturizing lotion is a topical product applied to skin for cosmetic/skincare purposes."
}
```

**Result**: Automatically classified as COSMETIC, searches INCIdecoder/Skinsort for ingredients

**Product**: "Pro-Vitamin Complex Formula"

**GPT Response**:
```json
{
  "type": "COSMETIC",
  "confidence": 65,
  "reasoning": "The term 'Pro-Vitamin Complex' is ambiguous - could be a supplement (food) or a skincare serum (cosmetic). Need more context."
}
```

**Result**: Shows ProductTypeSelector UI (confidence < 80%), user must choose

## Next Steps

### 1. Run Database Migration

Open Supabase SQL Editor and run:

```bash
web/database-migrations/add-product-type.sql
```

**Instructions**:
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor (left sidebar)
3. Create a new query
4. Copy and paste the entire contents of `add-product-type.sql`
5. Click "Run" to execute the migration
6. Verify with: `SELECT product_type, COUNT(*) FROM products GROUP BY product_type;`

### 2. Rebuild Extension

```bash
cd sage-extension
npm run build
```

### 3. Reload Extension in Chrome

1. Open Chrome → `chrome://extensions/`
2. Find "SAGE Extension"
3. Click the reload icon (circular arrow)

### 4. Test the Implementation

#### Test Case 1: High Confidence FOOD
1. Go to Walmart.com and search for "Blue Bell Ice Cream"
2. Open SAGE extension side panel
3. Click "Scan Current Page"
4. **Expected**: Automatically classifies as FOOD, searches OpenFoodFacts

#### Test Case 2: High Confidence COSMETIC
1. Go to Sephora.com and open any face cream product
2. Click "Scan Current Page"
3. **Expected**: Automatically classifies as COSMETIC, searches INCIdecoder/Skinsort

#### Test Case 3: Low Confidence (User Input Required)
1. Find a product with ambiguous name like "Vitamin Serum" or "Hair Supplement"
2. Click "Scan Current Page"
3. **Expected**: Shows ProductTypeSelector UI with 2 buttons
4. Select appropriate type
5. **Expected**: Retries scan with selected type, shows results

### 5. Verify Database

After running a few scans, check that product_type is being saved:

```sql
SELECT id, product_title, product_type, created_at
FROM products
ORDER BY created_at DESC
LIMIT 10;
```

## Benefits of GPT Classification

### Before (Rule-Based)
- ❌ Required maintaining lists of 30+ brands, protein terms, flavor words
- ❌ Brittle: "Blue Bell Cookies 'n Cream" failed because "CREAM" triggered cosmetic
- ❌ No understanding of context
- ❌ Constant maintenance as new products/brands emerge

### After (GPT-Based)
- ✅ Semantic understanding: "Blue Bell Cookies 'n Cream Ice Cream" → FOOD
- ✅ Context-aware: "Vitamin D3 Supplement" → FOOD, "Vitamin C Serum" → COSMETIC
- ✅ Self-improving: GPT updates with new product knowledge
- ✅ User confirmation for ambiguous cases
- ✅ Minimal cost: ~$0.0001 per scan

## Cost Analysis

- Model: GPT-4o-mini
- Input: ~100 tokens (product name + system prompt)
- Output: ~50 tokens (JSON response)
- Cost per classification: **~$0.0001 USD**
- Cost per 1000 scans: **~$0.10 USD**
- Response time: **~500ms**

## Future Enhancements

### Expand Categories (Future)
```typescript
export type ProductType = 'FOOD' | 'COSMETIC' | 'SUPPLEMENT' | 'BEVERAGE' | 'PERSONAL_CARE';
```

Currently using FOOD and COSMETIC only as requested. Easy to expand later by:
1. Updating `ProductType` type definition
2. Updating GPT system prompt
3. Updating check constraint in database
4. Updating UI components

### Cache Classifications (Future)
Store common product names → classifications in database to reduce API calls:

```sql
CREATE TABLE product_classifications (
  product_name TEXT PRIMARY KEY,
  product_type TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Troubleshooting

### Issue: Classification UI not showing
- Check browser console for `[ScanButton] GPT needs user input` log
- Verify scanState is 'awaiting_classification'
- Verify needsClassification state has data

### Issue: Product type not saving to database
- Check that migration ran successfully
- Verify column exists: `SELECT column_name FROM information_schema.columns WHERE table_name = 'products';`
- Check API logs for `[SAVE] GPT classified as: ...`

### Issue: GPT always returns low confidence
- Increase threshold in research-ingredients.ts (currently 80%)
- Check GPT prompt in productClassifier.ts for clarity
- Verify product names are being passed correctly

## File Checklist

### Created
- ✅ `web/lib/productClassifier.ts`
- ✅ `web/components/ProductTypeSelector.tsx`
- ✅ `sage-extension/src/popup/components/ProductTypeSelector.tsx`
- ✅ `web/database-migrations/add-product-type.sql`
- ✅ `GPT-CLASSIFICATION-IMPLEMENTATION.md` (this file)

### Modified
- ✅ `web/pages/api/research-ingredients.ts` (removed 80 lines, added GPT)
- ✅ `web/pages/api/save-product.ts` (added product_type handling)
- ✅ `web/pages/dashboard.tsx` (added classification UI)
- ✅ `sage-extension/src/types/index.ts` (added awaiting_classification)
- ✅ `sage-extension/src/popup/components/ScanButton.tsx` (added classification flow)
- ✅ `sage-extension/src/lib/api.ts` (added product_type parameters)

## Questions?

If you encounter any issues or have questions about this implementation, please check:
1. Browser console logs (prefixed with `[ScanButton]`, `[API]`, `[B:research]`, `[SAVE]`)
2. Network tab for API requests/responses
3. Supabase logs for database errors
4. This documentation for troubleshooting steps
