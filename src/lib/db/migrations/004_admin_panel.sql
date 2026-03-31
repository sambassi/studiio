-- ============================================================
-- Admin Panel Schema Updates
-- Migration 004: Admin columns, settings table, audit log
-- ============================================================

-- 1. Add admin columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text DEFAULT 'user';

-- Set admin role
UPDATE users SET role = 'admin' WHERE email = 'contact.artboost@gmail.com';

-- 2. App settings table
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz DEFAULT NOW(),
  updated_by text
);

INSERT INTO app_settings (key, value) VALUES
  ('free_credits', '"10"'),
  ('maintenance_mode', '"false"'),
  ('allow_signups', '"true"'),
  ('ai_generation_enabled', '"true"')
ON CONFLICT (key) DO NOTHING;

-- 3. Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_email text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_admin ON audit_log(admin_email);

-- 4. RLS policies
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Service role has full access (API routes use supabaseAdmin)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_settings_all') THEN
    CREATE POLICY service_settings_all ON app_settings FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_audit_all') THEN
    CREATE POLICY service_audit_all ON audit_log FOR ALL TO service_role USING (true);
  END IF;
END $$;

-- 5. Add stripe_payment_id to credit_transactions if not exists
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS stripe_payment_id text;
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS status text DEFAULT 'completed';
