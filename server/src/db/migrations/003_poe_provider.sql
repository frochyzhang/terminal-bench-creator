-- Add Poe provider settings and set default provider
INSERT INTO settings (key, value) VALUES
  ('poe_api_key', ''),
  ('poe_model', 'Claude-Sonnet-4.5'),
  ('poe_api_base', 'https://api.poe.com/v1')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value) VALUES
  ('ai_provider', 'poe')
ON CONFLICT (key) DO UPDATE SET value = 'poe', updated_at = NOW();
