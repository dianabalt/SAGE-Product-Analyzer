-- Migration: Add indexes and triggers for product caching system
-- Created: 2025-10-25
-- Purpose: Enable fast product lookups by URL and name to avoid duplicate scans

-- Step 1: Add updated_at column if it doesn't exist (for tracking manual edits)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE products ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    -- Backfill with created_at for existing records
    UPDATE products SET updated_at = created_at WHERE updated_at IS NULL;
  END IF;
END $$;

-- Step 2: Create indexes for fast lookups
-- Index for exact URL lookup (most common cache hit)
CREATE INDEX IF NOT EXISTS idx_products_url ON products(product_url);

-- Index for product name lookup (case-insensitive, for different URLs of same product)
CREATE INDEX IF NOT EXISTS idx_products_title_lower ON products(LOWER(product_title));

-- Composite indexes for user-specific lookups (with RLS policies)
CREATE INDEX IF NOT EXISTS idx_products_user_url ON products(user_id, product_url);
CREATE INDEX IF NOT EXISTS idx_products_user_title ON products(user_id, LOWER(product_title));

-- Index for recent products (helps with dashboard queries)
CREATE INDEX IF NOT EXISTS idx_products_user_created ON products(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_user_updated ON products(user_id, updated_at DESC);

-- Step 3: Create trigger function to auto-update updated_at on edits
CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create trigger (drop first if exists to avoid conflicts)
DROP TRIGGER IF EXISTS products_updated_at ON products;

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_products_updated_at();

-- Step 5: Add comments for documentation
COMMENT ON COLUMN products.updated_at IS 'Timestamp of last update - auto-updated on any edit, used for cache freshness';
COMMENT ON INDEX idx_products_url IS 'Fast lookup for cached products by exact URL';
COMMENT ON INDEX idx_products_title_lower IS 'Fast lookup for cached products by case-insensitive name';

-- Verification query (optional - run this to check the migration)
-- SELECT
--   indexname,
--   indexdef
-- FROM pg_indexes
-- WHERE tablename = 'products'
-- ORDER BY indexname;
