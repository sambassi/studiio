export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
  credits: number;
  plan: 'free' | 'starter' | 'pro' | 'enterprise';
}

export interface Objective {
  id: string;
  user_id: string;
  name: string;
  description: string;
  target_audience: string;
  platform: string;
  tone: string;
  created_at: string;
  updated_at: string;
}

export interface Video {
  id: string;
  user_id: string;
  title: string;
  description: string;
  format: 'reel' | 'tv';
  status: 'draft' | 'rendering' | 'completed' | 'published' | 'failed';
  objective_id?: string;
  script?: string;
  thumbnail_url?: string;
  video_url?: string;
  credits_used: number;
  metadata?: Record<string, any>;
  render_job_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan: 'starter' | 'pro' | 'enterprise';
  status: 'active' | 'canceled' | 'expired' | 'past_due';
  stripe_subscription_id: string;
  stripe_customer_id?: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreditTransaction {
  id: string;
  user_id: string;
  amount: number;
  type: 'purchase' | 'render' | 'refund' | 'bonus' | 'subscription';
  reference_id?: string;
  description?: string;
  created_at: string;
}

export interface SocialAccount {
  id: string;
  user_id: string;
  platform: 'instagram' | 'tiktok' | 'facebook' | 'youtube';
  account_id: string;
  account_name: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  connected: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScheduledPost {
  id: string;
  user_id: string;
  title: string;
  caption: string;
  media_url?: string;
  media_type: 'video' | 'image';
  format: 'reel' | 'tv';
  platforms: string[];
  scheduled_date: string;
  scheduled_time: string;
  status: 'draft' | 'scheduled' | 'published' | 'failed';
  video_id?: string;
  agent_plan_id?: string;
  agent_generated: boolean;
  approved_by?: string;
  approved_at?: string;
  published_at?: string;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface AgentPlan {
  id: string;
  user_id: string;
  config: Record<string, any>;
  stats: Record<string, any>;
  rushes_used: string[];
  plan_days: number;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export interface RenderJob {
  id: string;
  user_id: string;
  video_id?: string;
  status: 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  stage: string;
  composition_id: string;
  input_props: Record<string, any>;
  output_url?: string;
  error_message?: string;
  credits_charged: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface PublishingHistory {
  id: string;
  video_id: string;
  social_account_id: string;
  scheduled_post_id?: string;
  platform: string;
  platform_post_id?: string;
  platform_url?: string;
  status: 'publishing' | 'published' | 'failed';
  error_message?: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  published_at: string;
  created_at: string;
}
