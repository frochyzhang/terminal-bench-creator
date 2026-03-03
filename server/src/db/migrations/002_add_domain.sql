-- Add domain and workload fields to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS domain TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workload TEXT;

-- Extend status to include 'discarded' (task discarded by screening)
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('draft', 'ready', 'submitted', 'discarded'));

-- Add screening_elapsed_sec (how long the screening agent ran, null = not screened)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS screening_elapsed_sec INT;
