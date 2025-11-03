-- Migration: Add product_type column to products table
-- Created: 2025-10-25
-- Purpose: Store whether a product is FOOD or COSMETIC for GPT-based classification

-- Step 1: Add product_type column (nullable initially to allow existing records)
ALTER TABLE products
ADD COLUMN product_type TEXT;

-- Step 2: Add check constraint to ensure only valid values
ALTER TABLE products
ADD CONSTRAINT products_product_type_check
CHECK (product_type IN ('FOOD', 'COSMETIC'));

-- Step 3: Create index for filtering by product type (improves query performance)
CREATE INDEX idx_products_product_type
ON products(product_type);

-- Step 4: (Optional) Update existing records based on product_url patterns
-- This is a best-effort migration - you may want to review and update manually
UPDATE products
SET product_type = 'FOOD'
WHERE product_type IS NULL
  AND (
    product_url ILIKE '%openfoodfacts%'
    OR product_url ILIKE '%protein%'
    OR product_url ILIKE '%vitamin%'
    OR product_url ILIKE '%supplement%'
    OR product_title ILIKE '%protein%'
    OR product_title ILIKE '%vitamin%'
    OR product_title ILIKE '%supplement%'
  );

UPDATE products
SET product_type = 'COSMETIC'
WHERE product_type IS NULL
  AND (
    product_url ILIKE '%incidecoder%'
    OR product_url ILIKE '%skinsort%'
    OR product_url ILIKE '%sephora%'
    OR product_url ILIKE '%ulta%'
    OR product_url ILIKE '%dermstore%'
  );

-- Step 5: Add comment to column for documentation
COMMENT ON COLUMN products.product_type IS 'Product category: FOOD (ice cream, supplements, vitamins) or COSMETIC (skincare, beauty products). Determined by GPT classification or user selection.';

-- Verification query (optional - run this to check the migration)
-- SELECT product_type, COUNT(*) as count
-- FROM products
-- GROUP BY product_type
-- ORDER BY count DESC;
