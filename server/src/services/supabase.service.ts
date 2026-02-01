/**
 * Supabase Service
 * Provides admin-level Supabase client for server-side operations
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

class SupabaseService {
  private static instance: SupabaseService;
  private client: SupabaseClient;

  private constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error(
        'Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.'
      );
    }

    // Create admin client with service role key (bypasses RLS)
    this.client = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  /**
   * Get singleton instance of SupabaseService
   */
  public static getInstance(): SupabaseService {
    if (!SupabaseService.instance) {
      SupabaseService.instance = new SupabaseService();
    }
    return SupabaseService.instance;
  }

  /**
   * Get the Supabase admin client
   */
  public getClient(): SupabaseClient {
    return this.client;
  }

  /**
   * Get user by ID
   */
  public async getUserById(userId: string) {
    const { data, error } = await this.client.auth.admin.getUserById(userId);
    return { data, error };
  }

  /**
   * Get user by email
   */
  public async getUserByEmail(email: string) {
    const { data, error } = await this.client
      .from('auth.users')
      .select('*')
      .eq('email', email)
      .single();
    return { data, error };
  }
}

// Export singleton instance
export const supabaseService = SupabaseService.getInstance();
export const supabase = supabaseService.getClient();
