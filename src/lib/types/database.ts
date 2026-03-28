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
  status: 'draft' | 'rendering' | 'completed' | 'published';
  objective_id?: string;
  script?: string;
  thumbnail_url?: string;
  video_url?: string;
  credits_used: number;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan: 'starter' | 'pro' | 'enterprise';
  status: 'active' | 'canceled' | 'expired';
  stripe_subscription_id: string;
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
  type: 'purchase' | 'render' | 'refund' | 'bonus';
  reference_id?: string;
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

export interface PublishingHistory {
  id: string;
  video_id: string;
  social_account_id: string;
  published_at: string;
  platform_url: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  created_at: string;
}
