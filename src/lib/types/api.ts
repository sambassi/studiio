export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface CreateVideoRequest {
  title: string;
  description: string;
  format: 'reel' | 'tv';
  objective_id?: string;
  script: string;
}

export interface CreateObjectiveRequest {
  name: string;
  description: string;
  target_audience: string;
  platform: string;
  tone: string;
}

export interface UpdateUserRequest {
  name?: string;
  avatar_url?: string;
}

export interface PurchaseCreditsRequest {
  amount: number;
}

export interface CreateCheckoutRequest {
  plan: 'starter' | 'pro' | 'enterprise';
  billingCycle?: 'monthly' | 'annual';
}
