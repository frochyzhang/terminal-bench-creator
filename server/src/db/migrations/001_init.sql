-- tasks table (metadata; file contents stored on disk)
CREATE TABLE IF NOT EXISTS tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT,
  description TEXT,
  category    TEXT,
  difficulty  TEXT CHECK (difficulty IN ('Easy','Medium','Hard')),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','submitted')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- submissions table
CREATE TABLE IF NOT EXISTS submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tb_submission_id  TEXT,
  status            TEXT NOT NULL DEFAULT 'local',
  agent_fail_reason TEXT,
  zip_path          TEXT,
  task_points       TEXT,
  error_analysis    TEXT,
  retry_count       INT DEFAULT 0,
  last_polled_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- settings table (key-value, sensitive values AES encrypted)
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default settings
INSERT INTO settings (key, value) VALUES
  ('ai_provider', 'poe'),
  ('poe_api_key', ''),
  ('poe_model', 'Claude-Sonnet-4.5'),
  ('poe_api_base', 'https://api.poe.com/v1'),
  ('tb_email', ''),
  ('tb_password', ''),
  ('tb_base_url', 'https://terminal-bench.com'),
  ('tb_jwt_token', ''),
  ('tb_jwt_expires_at', '')
ON CONFLICT (key) DO NOTHING;

-- updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tasks
DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Apply trigger to submissions
DROP TRIGGER IF EXISTS submissions_updated_at ON submissions;
CREATE TRIGGER submissions_updated_at
  BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Apply trigger to settings
DROP TRIGGER IF EXISTS settings_updated_at ON settings;
CREATE TRIGGER settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
