-- ============================================================
-- Cities table: German cities with population data
-- Run this in the Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS cities (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  regional_key TEXT,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  postal_code TEXT,
  area_km2 DOUBLE PRECISION,
  population INTEGER,
  population_male INTEGER,
  population_female INTEGER,
  density_per_km2 INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cities_name_normalized ON cities (name_normalized);
CREATE INDEX IF NOT EXISTS idx_cities_postal_code ON cities (postal_code);
CREATE INDEX IF NOT EXISTS idx_cities_population ON cities (population DESC);
