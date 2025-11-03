# SAGE Better Alternatives - Testing Guide

## 🎯 Quick Test Instructions

### Prerequisites
1. ✅ Database tables created (ran `database-schema.sql`)
2. ✅ Extension reloaded at `chrome://extensions/`
3. ✅ Website dev server running (`npm run dev` in `web/`)

---

## 📱 Testing "Better Alternatives" Feature

### Expected Behavior

The feature will:
- Search for 5 products maximum
- Grade each one (takes ~10-15 seconds per product)
- Only show alternatives with score ≥ 80 that are better than your product
- Return 0-3 results

### When It Works Best

✅ **Good candidates** (likely to find alternatives):
- Products with grades **C or lower** (score < 80)
- Common categories: sunscreens, moisturizers, cleansers
- Well-known brands: Neutrogena, CeraVe, Aveeno

✅ **Examples to try**:
1. "Neutrogena Ultra Sheer Sunscreen SPF 70"
2. "CeraVe Hydrating Facial Cleanser"
3. "Aveeno Daily Moisturizing Lotion"
4. Generic drugstore supplements

### When It Won't Find Results

⚠️ **Expected to show "No alternatives found"**:
- Products already scoring **80+** (they're already good!)
- Niche/luxury products (e.g., La Mer, Tatcha)
- Very new products (not indexed yet)
- Products with uncommon ingredients

---

## 🧪 Test Cases

### Test Case 1: Low-Scoring Product (Should Find Alternatives)

**Product**: "Neutrogena Ultra Sheer Dry-Touch SPF 70"
**Expected Grade**: B- to C+ (70-82)
**Expected Result**: 1-3 alternatives with scores 80-95

**Steps**:
1. Scan or enter this product
2. Click "Find Better Alternatives"
3. Wait 30-60 seconds
4. Should show alternatives with higher scores

**If it fails**: The product might already be scoring well (80+), or the search couldn't find better options.

---

### Test Case 2: High-Scoring Product (Won't Find Better)

**Product**: "Supergoop! Unseen Sunscreen SPF 40"
**Expected Grade**: A- to B+ (85-92)
**Expected Result**: "No better alternatives found" message

**Steps**:
1. Scan this product
2. Click "Find Better Alternatives"
3. Wait 30-60 seconds
4. Should show message: "Your product already has a good score"

**This is correct!** Products scoring 80+ are already good choices.

---

### Test Case 3: Generic Drugstore Product

**Product**: "Cetaphil Daily Facial Cleanser"
**Expected Grade**: B- to C+ (70-82)
**Expected Result**: 1-3 cleaner alternatives

**Steps**:
1. Scan this product
2. Click "Find Better Alternatives"
3. Should find cleaner cleansers (CeraVe, Vanicream, etc.)

---

## 🔍 Debugging Tips

### Check Browser Console

**In Extension**:
1. Right-click extension icon → "Inspect"
2. Go to Console tab
3. Look for logs starting with `[AlternativesView]`

**On Website**:
1. Press F12 to open DevTools
2. Go to Console tab
3. Look for logs starting with `[ALTERNATIVES]`

### What to Look For

**Good logs** (working correctly):
```
[ALTERNATIVES] Finding alternatives for: Neutrogena SPF 70
[ALTERNATIVES] Detected category: sunscreen
[ALTERNATIVES] Search query: best healthiest cleanest sunscreen clean ingredients
[ALTERNATIVES] Found 8 search results
[ALTERNATIVES] Analyzing: CeraVe Hydrating Sunscreen (1/5)
[ALTERNATIVES] ✅ Added alternative: CeraVe Hydrating Sunscreen - Score: 88
[ALTERNATIVES] Final count: 2
```

**Problem logs** (needs investigation):
```
[ALTERNATIVES] Found 0 search results  ← No results from Tavily search
[ALTERNATIVES] ⚠️ Failed to grade: Product Name  ← Grading failed
[ALTERNATIVES] ⏭️ Skipped (not better): Product - Score: 75  ← Alternatives scored too low
```

---

## ⚙️ Configuration Notes

### Current Settings (Optimized for Speed)

```typescript
minScore = 80          // Minimum score to be considered
maxAttempts = 5        // Only grade 5 products max
search_depth = 'basic' // Faster than 'advanced'
```

### If You Want More Results (Slower)

Edit `web/pages/api/find-alternatives.ts`:

```typescript
// Line 270: Increase attempts
const maxAttempts = 10;  // Try 10 products (will take 2-3 minutes)

// Line 270: Lower minimum score
const minScore = 75;  // Accept lower-scoring alternatives
```

⚠️ **Warning**: This will make the feature much slower (90-180 seconds)

---

## 🐛 Common Issues & Solutions

### Issue: "No alternatives found" for everything

**Possible causes**:
1. Tavily API key not set (check `.env.local`)
2. Search returning 0 results
3. All alternatives scoring < 80

**Solution**:
```bash
# Check if SEARCH_API_KEY is set
cd web
cat .env.local | grep SEARCH_API_KEY

# If missing, add it:
echo "SEARCH_API_KEY=your_tavily_key" >> .env.local
```

---

### Issue: Feature stuck loading forever

**Possible causes**:
1. API timeout (grading takes too long)
2. Network error
3. OpenAI API quota exceeded

**Solution**:
1. Check browser console for errors
2. Wait 90 seconds before refreshing
3. Check OpenAI API usage at platform.openai.com

---

### Issue: Extension not showing button

**Solution**:
1. Go to `chrome://extensions/`
2. Find "SAGE - Product Ingredient Analyzer"
3. Click the refresh icon 🔄
4. Close and reopen extension popup

---

## 📊 Performance Expectations

| Scenario | Time | Results |
|----------|------|---------|
| Product already good (80+) | 30-45s | 0 alternatives (expected) |
| Low-scoring product | 45-90s | 1-3 alternatives |
| No search results | 5-10s | 0 alternatives |
| All alternatives < 80 | 60-90s | 0 alternatives |

---

## 🎯 Success Criteria

The feature is working correctly if:

✅ Products scoring < 80 find 1-3 alternatives
✅ Products scoring 80+ show "already good" message
✅ Results appear within 30-90 seconds
✅ No errors in console
✅ Results are cached (instant on 2nd click)

---

## 🆘 Still Not Working?

1. **Check the logs** in browser console
2. **Share the console output** - it shows exactly what's happening
3. **Try a different product** - some products just don't have better alternatives
4. **Verify database tables exist** in Supabase dashboard

Remember: **Not finding alternatives isn't always a bug!** If your product already scores 80+, there may genuinely be no better options available.
