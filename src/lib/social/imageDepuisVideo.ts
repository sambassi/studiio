import { execFile } from 'child_process';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { supabaseAdmin } from '@/lib/db/supabase';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';
import { downloadMediaToFile } from '@/lib/storage/fetch-media';

const executer = promisify(execFile);

/**
 * L'image de la vidéo au moment choisi, en JPEG publié sur le stockage.
 *
 * Pour Facebook et YouTube, qui n'acceptent qu'une IMAGE de miniature (aucun
 * moment) : la couverture « choisir dans la vidéo » y devient cette image.
 * Instagram et TikTok, eux, reçoivent directement le moment — rien n'est
 * extrait pour eux.
 *
 * ⚠️ NE LÈVE JAMAIS. Un échec rend `null` : la publication part avec la
 * couverture automatique du réseau (repli dit en clair), jamais en échec.
 *
 * Taille : 1280 px de large au plus, JPEG qualité 3 — sous les 2 Mo exigés par
 * YouTube pour une miniature.
 */
export async function imageDepuisVideo(
  videoUrl: string,
  frameMs: number,
  userId: string,
): Promise<string | null> {
  const ts = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const entree = join(tmpdir(), `couverture_${ts}.video`);
  const sortie = join(tmpdir(), `couverture_${ts}.jpg`);
  try {
    await downloadMediaToFile(videoUrl, entree, { userId });
    await executer(cheminFfmpeg(), [
      '-y', '-ss', (Math.max(0, frameMs) / 1000).toFixed(3), '-i', entree,
      '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', sortie,
    ], { timeout: 60_000 });
    const image = await readFile(sortie);
    if (image.length === 0) return null;
    // Préfixe du PROPRIÉTAIRE (`<userId>/…`) : la convention du stockage —
    // la clé prouve à qui appartient l image, comme les affiches et les rushes.
    const chemin = `${userId}/couvertures/frame_${ts}.jpg`;
    const { error } = await supabaseAdmin.storage
      .from('media')
      .upload(chemin, image, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      console.error('[Couverture] image extraite non enregistree :', error.message);
      return null;
    }
    const { data } = supabaseAdmin.storage.from('media').getPublicUrl(chemin);
    return data?.publicUrl ?? null;
  } catch (err) {
    console.error('[Couverture] extraction de l image impossible :', err instanceof Error ? err.message : err);
    return null;
  } finally {
    await unlink(entree).catch(() => {});
    await unlink(sortie).catch(() => {});
  }
}
