// Supabase client for Chrome Extension

import { createClient } from '@supabase/supabase-js';
import { storage } from './storage';

const SUPABASE_URL = 'https://btwnjsbjkgxreegsmfjo.supabase.co'; // Replace with actual URL or use env var
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0d25qc2Jqa2d4cmVlZ3NtZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY5MjY3NzcsImV4cCI6MjA3MjUwMjc3N30.iKa477mFqKFSxP_eO-xFeo2bAByshJMJiNkUHcUnH7A'; // Replace with actual key or use env var

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: {
      getItem: async (key: string) => {
        const session = await storage.getSession();
        if (key === 'sb-auth-token' && session) {
          return JSON.stringify(session);
        }
        return null;
      },
      setItem: async (key: string, value: string) => {
        if (key === 'sb-auth-token') {
          try {
            const session = JSON.parse(value);
            await storage.setSession(session);
            console.log('[Supabase] Session saved to storage');
          } catch (error) {
            console.error('[Supabase] Error saving session:', error);
          }
        }
      },
      removeItem: async (key: string) => {
        if (key === 'sb-auth-token') {
          await storage.setSession(null);
          console.log('[Supabase] Session removed from storage');
        }
      },
    },
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Aggressively refresh tokens to prevent expiration
    flowType: 'pkce',
  },
});

// Set up auth state change listener to keep session in sync
supabase.auth.onAuthStateChange(async (event, session) => {
  console.log('[Supabase] Auth state changed:', event, session ? 'Session exists' : 'No session');

  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    if (session) {
      await storage.setSession(session);
      console.log('[Supabase] Session updated in storage');
    }
  } else if (event === 'SIGNED_OUT') {
    await storage.setSession(null);
    console.log('[Supabase] Session cleared from storage');
  } else if (event === 'USER_UPDATED' && session) {
    await storage.setSession(session);
    console.log('[Supabase] User updated, session saved');
  }
});

export async function initializeAuth() {
  console.log('[Supabase] Initializing auth...');

  const session = await storage.getSession();
  if (session) {
    console.log('[Supabase] Found stored session, restoring...');

    // Try to restore session (this will automatically refresh if expired)
    const { data, error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });

    if (error) {
      console.error('[Supabase] Failed to restore session:', error.message);

      // If session is invalid, try to refresh it explicitly
      if (session.refresh_token) {
        console.log('[Supabase] Attempting to refresh session...');
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
          refresh_token: session.refresh_token
        });

        if (refreshData.session) {
          console.log('[Supabase] ✅ Session refreshed successfully');
          await storage.setSession(refreshData.session);
          return refreshData.user;
        } else {
          console.error('[Supabase] ❌ Failed to refresh session:', refreshError?.message);
        }
      }

      // Clear invalid session
      await storage.setSession(null);
      return null;
    }

    console.log('[Supabase] ✅ Session restored successfully');

    // Update stored session in case it was refreshed
    if (data.session) {
      await storage.setSession(data.session);
    }

    return data.user;
  }

  console.log('[Supabase] No stored session found');
  return null;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;

  if (data.session) {
    await storage.setSession(data.session);
  }

  return data.user;
}

export async function signOut() {
  await supabase.auth.signOut();
  await storage.clear();
}

// Helper function to check if session exists (simplified to avoid false positives)
export async function ensureValidSession(): Promise<boolean> {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (error) {
    console.error('[Supabase] Error getting session:', error.message);
    return false;
  }

  if (!session) {
    console.warn('[Supabase] No active session found');
    return false;
  }

  console.log('[Supabase] ✓ Active session found');
  return true;
}
