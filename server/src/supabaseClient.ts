/**
 * BiblioVault AI — Supabase Client
 * Phase 11.6: Cloud storage integration
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null; // Supabase not configured — fallback to local
  }
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('☁️  Supabase client initialized');
  }
  return supabase;
}

export function isSupabaseConfigured(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

// ── Storage Helpers ──
const BUCKET = 'user-uploads';

export async function uploadToSupabase(
  fileName: string,
  fileBuffer: Buffer,
  contentType: string,
  userId: string
): Promise<{ path: string; url: string } | null> {
  const client = getSupabase();
  if (!client) return null;

  const storagePath = `${userId}/${fileName}`;
  
  const { data, error } = await client.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: false,
    });

  if (error) {
    console.error('Supabase upload error:', error.message);
    return null;
  }

  return {
    path: data.path,
    url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${data.path}`,
  };
}

export async function deleteFromSupabase(storagePath: string): Promise<boolean> {
  const client = getSupabase();
  if (!client) return false;

  const { error } = await client.storage
    .from(BUCKET)
    .remove([storagePath]);

  if (error) {
    console.error('Supabase delete error:', error.message);
    return false;
  }
  return true;
}

export async function getSupabaseFileUrl(storagePath: string): Promise<string | null> {
  const client = getSupabase();
  if (!client) return null;

  const { data } = await client.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600); // 1 hour signed URL

  return data?.signedUrl || null;
}
