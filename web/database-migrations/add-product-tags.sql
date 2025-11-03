-- Migration: Add Product Subtype and Custom Tags
-- Created: 2025-10-26
-- Purpose: Add product_subtype for user-facing categories and custom tag support

-- Step 1: Ensure product_type constraint is FOOD | COSMETIC only (revert if changed)
ALTER TABLE products
DROP CONSTRAINT IF EXISTS products_product_type_check;

ALTER TABLE products
ADD CONSTRAINT products_product_type_check
CHECK (product_type IN ('FOOD', 'COSMETIC'));

-- Step 2: Add product_subtype column with 5 subcategories
ALTER TABLE products
ADD COLUMN IF NOT EXISTS product_subtype TEXT;

ALTER TABLE products
DROP CONSTRAINT IF EXISTS products_product_subtype_check;

ALTER TABLE products
ADD CONSTRAINT products_product_subtype_check
CHECK (product_subtype IN ('COSMETIC', 'SKINCARE', 'HEALTH_SUPPLEMENT', 'FOOD', 'BEAUTY'));

-- Step 3: Add custom tag columns for user customization
ALTER TABLE products
ADD COLUMN IF NOT EXISTS custom_tag_name TEXT,
ADD COLUMN IF NOT EXISTS custom_tag_color TEXT;

-- Step 4: Create index for filtering by subtype
CREATE INDEX IF NOT EXISTS idx_products_product_subtype ON products(product_subtype);

-- Step 5: Add comments for documentation
COMMENT ON COLUMN products.product_type IS 'Extraction pipeline type: FOOD (uses OpenFoodFacts, supplements) or COSMETIC (uses INCI databases, skincare). Determined by GPT during research phase. NOT user-editable.';

COMMENT ON COLUMN products.product_subtype IS 'User-facing category for filtering: COSMETIC (makeup), SKINCARE (creams/serums), HEALTH_SUPPLEMENT (vitamins/pills), FOOD (edible), BEAUTY (hair/nails). Determined by GPT during research, user CAN edit.';

COMMENT ON COLUMN products.custom_tag_name IS 'User-defined custom tag name (overrides product_subtype display if set)';

COMMENT ON COLUMN products.custom_tag_color IS 'User-defined custom tag color hex code (overrides default color if set)';

-- Verification queries (optional - run these to check the migration)
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'products'
-- AND column_name IN ('product_type', 'product_subtype', 'custom_tag_name', 'custom_tag_color');

-- SELECT product_type, product_subtype, COUNT(*) as count
-- FROM products
-- GROUP BY product_type, product_subtype
-- ORDER BY product_type, count DESC;
