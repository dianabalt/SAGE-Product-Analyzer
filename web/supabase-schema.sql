-- SAGE Product Analyzer Database Schema
-- Run this in your Supabase SQL Editor

-- Products table
CREATE TABLE IF NOT EXISTS products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_title TEXT,
  product_url TEXT NOT NULL,
  ingredients TEXT,
  grade TEXT,
  numeric_grade INTEGER,
  beneficial_ingredients TEXT[],
  issues TEXT[],
  sources TEXT[],
  analysis JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own products
CREATE POLICY "Users can view their own products" ON products
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Users can insert their own products
CREATE POLICY "Users can insert their own products" ON products
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own products
CREATE POLICY "Users can update their own products" ON products
  FOR UPDATE USING (auth.uid() = user_id);

-- Policy: Users can delete their own products
CREATE POLICY "Users can delete their own products" ON products
  FOR DELETE USING (auth.uid() = user_id);

-- Create index for faster user queries
CREATE INDEX IF NOT EXISTS products_user_id_idx ON products(user_id);
CREATE INDEX IF NOT EXISTS products_created_at_idx ON products(created_at DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Index for searching products by title (for history search)
CREATE INDEX IF NOT EXISTS products_product_title_idx ON products USING gin(to_tsvector('english', product_title));

-- Ingredient suggestions cache table
-- Stores unique ingredients from scanned products for autocomplete suggestions
CREATE TABLE IF NOT EXISTS ingredient_suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  frequency INTEGER DEFAULT 1, -- How many times this ingredient appeared
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(user_id, ingredient)
);

-- Enable Row Level Security
ALTER TABLE ingredient_suggestions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own ingredient suggestions
CREATE POLICY "Users can view their own ingredient suggestions" ON ingredient_suggestions
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Users can insert their own ingredient suggestions
CREATE POLICY "Users can insert their own ingredient suggestions" ON ingredient_suggestions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own ingredient suggestions
CREATE POLICY "Users can update their own ingredient suggestions" ON ingredient_suggestions
  FOR UPDATE USING (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS ingredient_suggestions_user_id_idx ON ingredient_suggestions(user_id);
CREATE INDEX IF NOT EXISTS ingredient_suggestions_ingredient_idx ON ingredient_suggestions(ingredient);
CREATE INDEX IF NOT EXISTS ingredient_suggestions_frequency_idx ON ingredient_suggestions(frequency DESC);
