// Extension types

export interface User {
  id: string;
  email?: string;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user: User;
}

export interface Alternative {
  id: string;
  alternative_title: string;
  alternative_url: string;
  alternative_ingredients: string | null;
  alternative_grade: string;
  alternative_score: number;
  beneficial_ingredients: string[] | null;
  harmful_ingredients: string[] | null;
  category: string | null;
}

export interface ScanResult {
  id?: string;
  product_title: string;
  product_url?: string;
  ingredients: string;
  grade: string;
  numeric_grade: number;
  grade_explanation?: string | null; // 3-4 sentence explanation from GPT
  beneficial_ingredients: string[];
  harmful_ingredients: string[];
  sources?: string[];
  product_type?: string | null; // FOOD or COSMETIC (for extraction pipeline)
  product_subtype?: string | null; // User-facing category (5 options)
  custom_tag_name?: string | null;
  custom_tag_color?: string | null;
  has_alternatives?: boolean;
  alternatives_count?: number;
  cached_alternatives?: Alternative[];
}

export interface StorageData {
  session?: Session;
  lastScan?: ScanResult;
}

export type AuthState = 'loading' | 'authenticated' | 'unauthenticated';

export type ScanState = 'idle' | 'capturing' | 'uploading' | 'analyzing' | 'awaiting_classification' | 'complete' | 'error';
