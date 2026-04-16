-- ============================================================
-- Supabase Migration: ZVG Scraper Database
-- Run this in the Supabase SQL Editor to create all tables
-- ============================================================

-- 1. Scrape Runs
CREATE TABLE IF NOT EXISTS scrape_runs (
  run_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  selected_states_json JSONB NOT NULL DEFAULT '[]',
  options_json JSONB NOT NULL DEFAULT '{}',
  summary_json JSONB,
  error_message TEXT
);

-- 2. Auctions (main table)
CREATE TABLE IF NOT EXISTS auctions (
  auction_key TEXT PRIMARY KEY,
  zvg_id TEXT,
  land_code TEXT,
  aktenzeichen TEXT,
  detail_available BOOLEAN NOT NULL DEFAULT FALSE,
  detail_url TEXT,
  last_update_text TEXT,
  court_context TEXT,
  procedure_type TEXT,
  land_register TEXT,
  object_type TEXT,
  location_text TEXT,
  address_full TEXT,
  street TEXT,
  postal_code TEXT,
  city TEXT,
  district TEXT,
  state TEXT,
  description TEXT,
  valuation_text TEXT,
  valuation_amount_eur DOUBLE PRECISION,
  auction_date_text TEXT,
  auction_date_iso TEXT,
  auction_location TEXT,
  geo_url TEXT,
  summary_fields_json JSONB,
  detail_fields_json JSONB,
  documents_json JSONB NOT NULL DEFAULT '[]',
  first_seen_run_id TEXT NOT NULL,
  last_seen_run_id TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_scraped_at TIMESTAMPTZ NOT NULL,
  source_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auctions_state ON auctions (state);
CREATE INDEX IF NOT EXISTS idx_auctions_auction_date ON auctions (auction_date_iso);
CREATE INDEX IF NOT EXISTS idx_auctions_object_type ON auctions (object_type);

-- 3. Auction Documents
CREATE TABLE IF NOT EXISTS auction_documents (
  document_key TEXT PRIMARY KEY,
  auction_key TEXT NOT NULL REFERENCES auctions(auction_key) ON DELETE CASCADE,
  name TEXT,
  label TEXT,
  category TEXT,
  url TEXT,
  size_text TEXT,
  first_seen_run_id TEXT NOT NULL,
  last_seen_run_id TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auction_documents_auction ON auction_documents (auction_key);

-- 4. Auction History (change tracking)
CREATE TABLE IF NOT EXISTS auction_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id TEXT NOT NULL,
  auction_key TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  source_hash TEXT NOT NULL,
  changed BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auction_history_auction ON auction_history (auction_key);
CREATE INDEX IF NOT EXISTS idx_auction_history_run ON auction_history (run_id);

-- 5. Pipeline Items (deal tracking)
CREATE TABLE IF NOT EXISTS pipeline_items (
  auction_key TEXT PRIMARY KEY REFERENCES auctions(auction_key) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'shortlist',
  priority TEXT NOT NULL DEFAULT 'medium',
  source TEXT NOT NULL DEFAULT 'manual',
  thesis TEXT,
  next_step TEXT,
  target_bid_eur DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 6. Auction Analysis (scoring)
CREATE TABLE IF NOT EXISTS auction_analysis (
  auction_key TEXT PRIMARY KEY REFERENCES auctions(auction_key) ON DELETE CASCADE,
  strategy_fit TEXT,
  location_score INTEGER,
  asset_score INTEGER,
  execution_score INTEGER,
  screening_json JSONB NOT NULL DEFAULT '{}',
  finance_json JSONB NOT NULL DEFAULT '{}',
  due_diligence_json JSONB NOT NULL DEFAULT '{}',
  notes TEXT,
  decision TEXT NOT NULL DEFAULT 'open',
  updated_at TIMESTAMPTZ NOT NULL
);

-- ============================================================
-- Row Level Security (optional, enable if needed)
-- ============================================================
-- ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE auction_documents ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE auction_history ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pipeline_items ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE auction_analysis ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE scrape_runs ENABLE ROW LEVEL SECURITY;
