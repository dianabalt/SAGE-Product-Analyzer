# SAGE Better Alternatives & Best Deals Setup Instructions

## ✅ What Was Fixed

1. **Better Alternatives API** - Optimized to complete within 60 seconds (limit to 5 product attempts)
2. **Best Deals API** - Removed unreliable price scraping, now shows retailer links only
3. **Chrome Extension** - Both features now work in-app (no more Google search popups)
4. **UI Updates** - Clean interface showing retailer links without incorrect prices

## 📋 Step 1: Set Up Database Tables

1. Go to your Supabase dashboard: https://app.supabase.com/project/YOUR_PROJECT_ID/sql/new

2. Copy the **entire contents** of `database-schema.sql` (all 140 lines)

3. Paste into the SQL editor

4. Click **"Run"** button

This creates two new tables:
- `product_alternatives` - Stores healthier product recommendations
- `product_deals` - Stores retailer shopping links (24-hour cache)

## 📱 Step 2: Install Updated Chrome Extension

### Option A: Reload Existing Extension

If you already have the extension installed:

1. Open Chrome → `chrome://extensions/`
2. Find "SAGE - Product Ingredient Analyzer"
3. Click the **refresh icon** 🔄 on the extension card
4. Done! The new features are now active

### Option B: Fresh Install

If starting fresh:

1. Build the extension (already done):
   ```bash
   cd sage-extension
   npm run build
   ```

2. Open Chrome → `chrome://extensions/`

3. Enable **"Developer mode"** (top right toggle)

4. Click **"Load unpacked"**

5. Navigate to and select: `c:\SCHOOL\SAGE-WEB-EX\sage-extension\dist\`

6. Done!

## 🌐 Step 3: Test the Website

1. Start the dev server (if not already running):
   ```bash
   cd web
   npm run dev
   ```

2. Visit: http://localhost:3000/dashboard

3. Add a product (or use existing one)

4. Look for two new buttons:
   - **"Find Better Alternatives"** (sage green)
   - **"Find Best Deal"** (standard sage)

## 🧪 Testing the Features

### Test Better Alternatives

1. **In Extension:**
   - Scan a product with a grade of B or lower
   - Click **"Find Better Alternatives"** (sage green button)
   - Wait 30-60 seconds
   - You'll see 1-3 healthier alternatives with grades 85-100

2. **On Website:**
   - Click **"Find Better Alternatives"** button
   - Results expand below the product card
   - Shows grade comparisons and improvement scores

### Test Best Deal

1. **In Extension:**
   - View a scanned product's results
   - Click **"Find the Best Deal"**
   - You'll see a list of retailers (Amazon, Walmart, Target, Sephora, etc.)
   - Click **"Check Price"** to visit retailer website

2. **On Website:**
   - Click **"Find Best Deal"** button
   - Results expand showing multiple retailers
   - Click **"Check Price →"** to visit each store

## 🎨 What You'll See

### Better Alternatives Feature
- **Sage green button** (#7e9a7c)
- Shows 1-3 products with score ≥ 85
- Displays grade badges (A-F)
- Shows score improvement (+X points better)
- Lists beneficial/harmful ingredients
- "Top Pick" badge for highest scorer
- Direct links to product pages

### Best Deal Feature
- **Standard sage button**
- Shows 5-8 major retailers
- Retailer-specific icons and colors
- "Check Price" buttons for each store
- **NOTE:** Prices not shown (too unreliable)
- Tip message explaining to check retailer sites

## ⏱️ Performance Notes

**Better Alternatives:**
- Takes 30-90 seconds (grades 3-5 products live)
- Cached after first search
- Categories auto-detected (sunscreen, moisturizer, supplements, etc.)

**Best Deals:**
- Takes 5-15 seconds
- Results cached for 24 hours
- Shows 5-8 top retailers

## 🐛 Troubleshooting

### "Better Alternatives" stuck loading
- **Solution:** Wait up to 90 seconds. The API grades each alternative product individually.
- If it times out, refresh and try again.

### Extension not showing new buttons
- **Solution:** Reload the extension at `chrome://extensions/` (click refresh icon)
- Make sure you're viewing a scan result (not the scan screen)

### Website not showing features
- **Solution:**
  1. Restart dev server: `npm run dev` in `web/` folder
  2. Hard refresh browser: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

### Database errors
- **Solution:** Make sure you ran the SQL schema (Step 1)
- Check Supabase logs for RLS policy errors

## 📝 What's Different Now

### ✅ Fixed:
- ✅ Extension buttons now work (not just website)
- ✅ No more Google search popups
- ✅ No more incorrect prices
- ✅ Faster, more reliable alternatives search
- ✅ Clean retailer link display

### ⚠️ Changed:
- ⚠️ Prices removed from deals (too unreliable from search results)
- ⚠️ Now shows "Check Price" buttons to visit retailer sites
- ⚠️ Better Alternatives limited to 5 attempts (faster response)

## 🎉 You're All Set!

The features are now live on both the extension and website. Try scanning a product with a grade of C or lower to see the "Better Alternatives" feature in action!
