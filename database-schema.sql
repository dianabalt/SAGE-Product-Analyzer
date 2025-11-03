-- Database schema for SAGE product alternatives and deals caching
-- Run these queries in your Supabase SQL editor

-- Table for storing better product alternatives
CREATE TABLE IF NOT EXISTS product_alternatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  source_product_title TEXT NOT NULL,
  source_grade TEXT,
  source_score INTEGER,

  -- Alternative product details
  alternative_title TEXT NOT NULL,
  alternative_url TEXT NOT NULL,
  alternative_ingredients TEXT,
  alternative_grade TEXT NOT NULL,
  alternative_score INTEGER NOT NULL,
  beneficial_ingredients TEXT[] DEFAULT '{}',
  harmful_ingredients TEXT[] DEFAULT '{}',

  -- Search metadata
  category TEXT, -- e.g., 'sunscreen', 'moisturizer', 'supplement'
  search_query TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure we don't store duplicate alternatives
  UNIQUE(source_product_id, alternative_url)
);

-- Table for storing product shopping deals
CREATE TABLE IF NOT EXISTS product_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  product_title TEXT NOT NULL,

  -- Deal details
  retailer TEXT NOT NULL, -- e.g., 'Amazon', 'Walmart', 'Target'
  price DECIMAL(10, 2),
  currency TEXT DEFAULT 'USD',
  deal_url TEXT NOT NULL,
  image_url TEXT,
  availability TEXT, -- e.g., 'In Stock', 'Out of Stock', 'Pre-order'
  rating DECIMAL(3, 2), -- e.g., 4.5
  review_count INTEGER,

  -- Search metadata
  search_query TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Deals expire after 24 hours, so we want to refresh them
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),

  -- Ensure we don't store duplicate deals
  UNIQUE(product_id, retailer, deal_url)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_alternatives_source_product ON product_alternatives(source_product_id);
CREATE INDEX IF NOT EXISTS idx_alternatives_score ON product_alternatives(alternative_score DESC);
CREATE INDEX IF NOT EXISTS idx_alternatives_created ON product_alternatives(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deals_product ON product_deals(product_id);
CREATE INDEX IF NOT EXISTS idx_deals_expires ON product_deals(expires_at);
CREATE INDEX IF NOT EXISTS idx_deals_price ON product_deals(price ASC);

-- Enable Row Level Security
ALTER TABLE product_alternatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_deals ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only see alternatives/deals for their own products
CREATE POLICY "Users can view their own product alternatives"
  ON product_alternatives FOR SELECT
  USING (
    source_product_id IN (
      SELECT id FROM products WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own product alternatives"
  ON product_alternatives FOR INSERT
  WITH CHECK (
    source_product_id IN (
      SELECT id FROM products WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view their own product deals"
  ON product_deals FOR SELECT
  USING (
    product_id IN (
      SELECT id FROM products WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own product deals"
  ON product_deals FOR INSERT
  WITH CHECK (
    product_id IN (
      SELECT id FROM products WHERE user_id = auth.uid()
    )
  );

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to update updated_at
CREATE TRIGGER update_alternatives_updated_at
  BEFORE UPDATE ON product_alternatives
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deals_updated_at
  BEFORE UPDATE ON product_deals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to clean up expired deals (run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_deals()
RETURNS void AS $$
BEGIN
  DELETE FROM product_deals WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE product_alternatives IS 'Stores better alternative products with higher grades';
COMMENT ON TABLE product_deals IS 'Stores shopping deals and prices for products (24hr cache)';
COMMENT ON COLUMN product_alternatives.alternative_score IS 'Numeric score 0-100, alternatives must be >= 85';
COMMENT ON COLUMN product_deals.expires_at IS 'Deals expire after 24 hours to ensure fresh pricing';
