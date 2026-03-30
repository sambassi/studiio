-- ============================================================
-- Studiio.pro Storage Buckets Configuration
-- Run this in the Supabase SQL editor to create storage buckets
-- ============================================================

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('videos', 'videos', true, 524288000, ARRAY['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska']),
  ('media', 'media', true, 104857600, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']),
  ('audio', 'audio', true, 52428800, ARRAY['audio/mpeg', 'audio/wav', 'audio/aac', 'audio/ogg']),
  ('thumbnails', 'thumbnails', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies: authenticated users can upload to their own folder
CREATE POLICY "users_upload_videos" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'videos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "users_upload_media" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'media' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "users_upload_audio" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'audio' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "users_upload_thumbnails" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'thumbnails' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Public read access for all buckets (videos, media, thumbnails are public)
CREATE POLICY "public_read_videos" ON storage.objects FOR SELECT
  TO public
  USING (bucket_id IN ('videos', 'media', 'audio', 'thumbnails'));

-- Users can delete their own files
CREATE POLICY "users_delete_own" ON storage.objects FOR DELETE
  TO authenticated
  USING ((storage.foldername(name))[1] = auth.uid()::text);

-- Service role can do anything (for API routes with supabaseAdmin)
CREATE POLICY "service_role_all" ON storage.objects FOR ALL
  TO service_role
  USING (true);
