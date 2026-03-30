/**
 * Supabase Storage Upload Utilities
 * Handles file uploads to Supabase Storage buckets.
 */

import { supabaseAdmin } from '@/lib/db/supabase';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';

/**
 * Upload a local file to Supabase Storage
 */
export async function uploadToStorage(options: {
  filePath: string;
  bucket: string;
  storagePath: string;
  contentType?: string;
}): Promise<string> {
  const { filePath, bucket, storagePath, contentType } = options;

  // Read file
  const fileBuffer = fs.readFileSync(filePath);
  const mimeType = contentType || getMimeType(filePath);

  // Upload to Supabase Storage
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  // Get public URL
  const { data: urlData } = supabaseAdmin.storage
    .from(bucket)
    .getPublicUrl(storagePath);

  // Clean up temp file
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Ignore cleanup errors
  }

  return urlData.publicUrl;
}

/**
 * Upload a Buffer to Supabase Storage
 */
export async function uploadBufferToStorage(options: {
  buffer: Buffer;
  bucket: string;
  storagePath: string;
  contentType: string;
}): Promise<string> {
  const { buffer, bucket, storagePath, contentType } = options;

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data: urlData } = supabaseAdmin.storage
    .from(bucket)
    .getPublicUrl(storagePath);

  return urlData.publicUrl;
}

/**
 * Upload from a web request File/Blob
 */
export async function uploadFileToStorage(options: {
  file: File | Blob;
  bucket: string;
  storagePath: string;
}): Promise<string> {
  const { file, bucket, storagePath } = options;

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(storagePath, file, {
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data: urlData } = supabaseAdmin.storage
    .from(bucket)
    .getPublicUrl(storagePath);

  return urlData.publicUrl;
}

/**
 * Delete a file from Supabase Storage
 */
export async function deleteFromStorage(bucket: string, storagePath: string): Promise<void> {
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .remove([storagePath]);

  if (error) {
    console.error(`Storage delete failed: ${error.message}`);
  }
}

/**
 * Generate a signed URL for temporary access
 */
export async function getSignedUrl(
  bucket: string,
  storagePath: string,
  expiresInSeconds: number = 3600,
): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error) {
    throw new Error(`Signed URL failed: ${error.message}`);
  }

  return data.signedUrl;
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}
