CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  sku        TEXT UNIQUE NOT NULL,
  price      NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  stock      INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  category   TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

CREATE TABLE IF NOT EXISTS import_jobs (
  id             TEXT PRIMARY KEY,
  status         TEXT NOT NULL DEFAULT 'queued',
  file_path      TEXT NOT NULL,
  total_rows     INT NOT NULL DEFAULT 0,
  processed_rows INT NOT NULL DEFAULT 0,
  failed_rows    INT NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
