# Debugging "Better Alternatives" Feature

## ✅ What I Just Fixed

### 1. **Scrolling Issue** - FIXED ✅
- Extension popup now scrolls properly
- History view now scrolls properly
- Buttons no longer cut off
- **Action**: Reload extension at `chrome://extensions/` (click refresh 🔄)

### 2. **Better Logging Added** ✅
- Extension now logs detailed info to console
- Shows exactly what's being sent to API
- Shows API response
- **Action**: Open console to see what's happening

---

## 🔍 How to Debug "No Alternatives Found"

### Step 1: Reload Extension
1. Go to `chrome://extensions/`
2. Find "SAGE - Product Ingredient Analyzer"
3. Click the **refresh icon** 🔄
4. Close and reopen the extension

### Step 2: Open Console
1. Right-click the extension icon
2. Click "Inspect"
3. Go to **Console** tab
4. Keep it open while testing

### Step 3: Test with the Neutrogena Product
You scanned: **Neutrogena ULTRA SHEER Dry-Touch Sunscreen SPF 70**
- Grade: C+ (70/100)
- This SHOULD find alternatives (score is < 80)

1. Click "Find Better Alternatives" button
2. Watch the console logs

### Step 4: Check Console Output

Look for these logs:

**✅ Good logs** (feature working):
```
[AlternativesView] Requesting alternatives for: {product_title: "Neutrogena...", grade: "C+", numeric_grade: 70}
[AlternativesView] Response status: 200
[AlternativesView] Response data: {success: true, alternatives: [...]}
[AlternativesView] Loaded 2 alternatives
```

**❌ Problem logs** (feature broken):
```
[ALTERNATIVES] Found 0 search results  ← Tavily returned nothing
[ALTERNATIVES] Failed to grade: Product  ← Grading failed
[AlternativesView] Error response: {error: "..."}  ← API error
```

---

## 🐛 Common Issues & Fixes

### Issue 1: "Tavily API key not configured"

**In console you see**:
```
[ALTERNATIVES] No Tavily API key configured
```

**Fix**:
```bash
cd web
echo "SEARCH_API_KEY=your_tavily_key" >> .env.local
# Then restart dev server
npm run dev
```

---

### Issue 2: "Found 0 search results"

**In console you see**:
```
[ALTERNATIVES] Found 0 search results
```

**This means**: Tavily search returned nothing for this category

**Why this happens**:
- Uncommon product category
- Product too new/not indexed
- Search query too specific

**Fix**: This is normal for some products. Try a different, more common product like:
- "CeraVe Hydrating Facial Cleanser"
- "Aveeno Daily Moisturizing Lotion"
- "Cetaphil Daily Facial Cleanser"

---

### Issue 3: "All alternatives scored below 80"

**In console you see**:
```
[ALTERNATIVES] ⏭️  Skipped (score too low): Product - Score: 75
[ALTERNATIVES] ⏭️  Skipped (score too low): Product - Score: 72
[ALTERNATIVES] Final count: 0
```

**This means**: We found products, but none scored 80+

**Why this happens**:
- Your product might already be one of the better options
- The category doesn't have many clean alternatives
- The specific type of product (sunscreen with SPF 70) limits options

**Fix**: This is working as designed! The feature only shows alternatives that are actually better.

---

### Issue 4: Server logs show errors

**Check your web server terminal** (where you ran `npm run dev`):

Look for:
```
[ALTERNATIVES] Tavily error: 401  ← API key invalid
[ALTERNATIVES] Tavily error: 429  ← Rate limit exceeded
[ALTERNATIVES] OpenAI error  ← Grading API failed
```

**Fix based on error**:
- 401: Check `SEARCH_API_KEY` in `.env.local`
- 429: Wait a few minutes (rate limited)
- OpenAI error: Check `OPENAI_API_KEY` in `.env.local`

---

## 📊 What to Share for Help

If it's still not working, share these from the console:

1. **Extension console logs** (right-click extension → Inspect):
   ```
   [AlternativesView] Requesting alternatives for: {...}
   [AlternativesView] Response status: ...
   [AlternativesView] Response data: ...
   ```

2. **Web server logs** (terminal where `npm run dev` is running):
   ```
   [ALTERNATIVES] Finding alternatives for: ...
   [ALTERNATIVES] Detected category: ...
   [ALTERNATIVES] Found X search results
   ```

3. **Product details**:
   - Product name
   - Grade and score
   - Category detected

This will help me pinpoint exactly what's failing!

---

## 🎯 Quick Test Commands

### Test 1: Check if API is responding

Open browser console (F12) on the website and run:
```javascript
fetch('http://localhost:3000/api/find-alternatives', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  credentials: 'include',
  body: JSON.stringify({
    product_title: 'Neutrogena Ultra Sheer Sunscreen SPF 70',
    numeric_grade: 70,
    grade: 'C+',
    ingredients: 'test'
  })
})
.then(r => r.json())
.then(console.log)
```

This should return:
- `success: true` if working
- `error: "Unauthorized"` if not logged in
- `alternatives: []` if no results found

### Test 2: Check Tavily API key

In web terminal:
```bash
cd web
cat .env.local | grep SEARCH_API_KEY
```

Should show your Tavily API key.

---

## ✅ Success Criteria

The feature is working correctly if:

1. **For low-scoring products (< 80)**: Shows 0-3 alternatives OR message "may already be a good choice"
2. **For high-scoring products (80+)**: Shows "Great Choice!" message
3. **Completes within 30-90 seconds**
4. **No errors in console**

Remember: **Not finding alternatives doesn't mean it's broken!** Some products genuinely don't have better alternatives available.

---

## 📞 Next Steps

1. ✅ Reload extension (done above)
2. ✅ Open console (done above)
3. 🔄 Test with Neutrogena sunscreen
4. 📋 Share console logs if still not working

The detailed logs will show exactly where it's failing!
