-- ============================================================
-- Studiio.pro Complete Database Schema
-- Migration 002: All tables for SaaS video creation platform
-- ============================================================

-- 1. Update users table with missing columns
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Update default credits from 100 to 10 (free tier)
ALTER TABLE users ALTER COLUMN credits SET DEFAULT 10;

-- 2. Objectives table
CREATE TABLE IF NOT EXISTS objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT DEFAULT '',
  target_audience TEXT DEFAULT '',
  platform VARCHAR(50) DEFAULT 'instagram',
  tone VARCHAR(50) DEFAULT 'motivant',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_objectives_user_id ON objectives(user_id);

-- 3. Videos table
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT DEFAULT '',
  format VARCHAR(10) NOT NULL DEFAULT 'reel' CHECK (format IN ('reel', 'tv')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'rendering', 'completed', 'published', 'failed')),
  objective_id UUID REFERENCES objectives(id) ON DELETE SET NULL,
  script TEXT,
  thumbnail_url TEXT,
  video_url TEXT,
  credits_used INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  render_job_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at DESC);

-- 4. Credit transactions table
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('purchase', 'render', 'refund', 'bonus', 'subscription')),
  reference_id VARCHAR(255),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at DESC);

-- 5. Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan VARCHAR(20) NOT NULL CHECK (plan IN ('starter', 'pro', 'enterprise')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'expired', 'past_due')),
  stripe_subscription_id VARCHAR(255) UNIQUE,
  stripe_customer_id VARCHAR(255),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_id ON subscriptions(stripe_subscription_id);

-- 6. Social accounts table
CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'facebook', 'youtube')),
  account_id VARCHAR(255),
  account_name VARCHAR(255),
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  connected BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_social_accounts_user_id ON social_accounts(user_id);

-- 7. Scheduled posts table (calendar)
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL DEFAULT '',
  caption TEXT DEFAULT '',
  media_url TEXT,
  media_type VARCHAR(10) DEFAULT 'video' CHECK (media_type IN ('video', 'image')),
  format VARCHAR(10) DEFAULT 'reel' CHECK (format IN ('reel', 'tv')),
  platforms TEXT[] DEFAULT '{}',
  scheduled_date DATE NOT NULL,
  scheduled_time TIME DEFAULT '12:00',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'failed')),
  video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  agent_plan_id UUID,
  agent_generated BOOLEAN DEFAULT FALSE,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user_id ON scheduled_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_date ON scheduled_posts(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status);

-- 8. Agent plans table (AI content generation)
CREATE TABLE IF NOT EXISTS agent_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  config JSONB NOT NULL DEFAULT '{}',
  stats JSONB DEFAULT '{}',
  rushes_used TEXT[] DEFAULT '{}',
  plan_days INTEGER DEFAULT 30,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_plans_user_id ON agent_plans(user_id);

-- 9. Render jobs table (video rendering queue)
CREATE TABLE IF NOT EXISTS render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'rendering', 'completed', 'failed', 'cancelled')),
  progress REAL DEFAULT 0,
  stage VARCHAR(100) DEFAULT '',
  composition_id VARCHAR(50) NOT NULL DEFAULT 'AfroboostComposition',
  input_props JSONB NOT NULL DEFAULT '{}',
  output_url TEXT,
  error_message TEXT,
  credits_charged INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_render_jobs_user_id ON render_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON render_jobs(status);
CREATE INDEX IF NOT EXISTS idx_render_jobs_video_id ON render_jobs(video_id);

-- 10. Publishing history table
CREATE TABLE IF NOT EXISTS publishing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  scheduled_post_id UUID REFERENCES scheduled_posts(id) ON DELETE SET NULL,
  platform VARCHAR(20) NOT NULL,
  platform_post_id VARCHAR(255),
  platform_url TEXT,
  status VARCHAR(20) DEFAULT 'published' CHECK (status IN ('publishing', 'published', 'failed')),
  error_message TEXT,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publishing_history_video_id ON publishing_history(video_id);
CREATE INDEX IF NOT EXISTS idx_publishing_history_social_account_id ON publishing_history(social_account_id);

-- ============================================================
-- Row Level Security (RLS) Policies
-- ============================================================

ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE render_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_history ENABLE ROW LEVEL SECURITY;

-- Users can only access their own data
CREATE POLICY IF NOT EXISTS "users_own_objectives" ON objectives FOR ALL USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "users_own_videos" ON videos FOR ALL USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "users_own_credits" ON credit_transactions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "users_own_subscriptions" ON subscriptions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "users_own_social" ON social_accounts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "users_own_posts" ON scheduled_posts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "users_own_plans" ON agent_plans FOR ALL USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "users_own_renders" ON render_jobs FOR ALL USING (auth.uid() = user_id);

-- Service role bypasses RLS (used by supabaseAdmin)

-- ============================================================
-- Functions
-- ============================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Auto-update triggers
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['users', 'objectives', 'videos', 'subscriptions', 'social_accounts', 'scheduled_posts', 'agent_plans', 'render_jobs'])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS update_%I_updated_at ON %I', tbl, tbl);
    EXECUTE format('CREATE TRIGGER update_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', tbl, tbl);
  END LOOP;
END;
$$;
