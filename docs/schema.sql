CREATE TABLE IF NOT EXISTS campaign (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  total_limit INTEGER NOT NULL CHECK (total_limit >= 0),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0)
);
CREATE TABLE IF NOT EXISTS codes (
  hash TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  quota INTEGER NOT NULL CHECK (quota >= 0),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  expires_at INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL REFERENCES codes(hash),
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','done','failed'))
);
CREATE INDEX IF NOT EXISTS requests_code_status ON requests(code_hash, status, created_at);
CREATE TRIGGER IF NOT EXISTS consume_attempt AFTER INSERT ON requests
BEGIN
  UPDATE codes SET used = used + 1 WHERE hash = NEW.code_hash;
  UPDATE campaign SET used = used + 1 WHERE id = 1;
END;
