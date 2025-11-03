-- Migration to add missing columns to existing products table
-- Run this in your Supabase SQL Editor if the products table already exists

-- Add beneficial_ingredients column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'beneficial_ingredients'
  ) THEN
    ALTER TABLE products ADD COLUMN beneficial_ingredients TEXT[];
  END IF;
END $$;

-- Add numeric_grade column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'numeric_grade'
  ) THEN
    ALTER TABLE products ADD COLUMN numeric_grade INTEGER;
  END IF;
END $$;

-- Add analysis column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'analysis'
  ) THEN
    ALTER TABLE products ADD COLUMN analysis JSONB;
  END IF;
END $$;

-- Verify columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'products'
ORDER BY ordinal_position;
