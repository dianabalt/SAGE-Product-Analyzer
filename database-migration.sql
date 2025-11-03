-- Database migration for SAGE product grading improvements
-- Run this in your Supabase SQL editor

-- Add new columns to products table
ALTER TABLE products
ADD COLUMN IF NOT EXISTS numeric_grade INTEGER,
ADD COLUMN IF NOT EXISTS beneficial_ingredients TEXT[],
ADD COLUMN IF NOT EXISTS image_scan BOOLEAN DEFAULT FALSE;

-- Add comments for documentation
COMMENT ON COLUMN products.numeric_grade IS 'Numeric grade from 0-100 (0=worst, 100=best)';
COMMENT ON COLUMN products.beneficial_ingredients IS 'Array of beneficial/positive ingredient names';
COMMENT ON COLUMN products.image_scan IS 'True if ingredients came from Chrome extension image scan';

-- Optional: Add index for better query performance on numeric_grade
CREATE INDEX IF NOT EXISTS idx_products_numeric_grade ON products(numeric_grade);

-- Optional: Update existing products with default values (if needed)
-- UPDATE products SET numeric_grade = NULL WHERE numeric_grade IS NULL;
-- UPDATE products SET beneficial_ingredients = '{}' WHERE beneficial_ingredients IS NULL;
-- UPDATE products SET image_scan = FALSE WHERE image_scan IS NULL;
