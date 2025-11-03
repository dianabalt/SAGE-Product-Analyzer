-- web/database-migrations/add-grade-explanation.sql
-- Migration to add grade_explanation column to products table
-- This stores the GPT-generated explanation for why a product received its grade

-- Add grade_explanation column to products table
ALTER TABLE products
ADD COLUMN IF NOT EXISTS grade_explanation TEXT;

-- Add comment for documentation
COMMENT ON COLUMN products.grade_explanation IS '3-4 sentence explanation from GPT explaining why the product received its grade (based on beneficial ingredients, harmful ingredients, and overall safety profile)';

-- Add index for faster queries (optional but helpful for future features)
-- Only indexes rows that have an explanation (partial index for efficiency)
CREATE INDEX IF NOT EXISTS idx_products_grade_explanation
ON products(grade_explanation)
WHERE grade_explanation IS NOT NULL AND grade_explanation != '';

-- Note: Existing products will have NULL grade_explanation
-- New scans will automatically populate this field
