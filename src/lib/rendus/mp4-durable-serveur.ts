/**
 * MP4 DURABLE d'un rendu confirmé — le travail serveur (téléchargement,
 * ffmpeg, dépôt, mise à jour du post).
 *
 * Les décisions vivent dans `mp4-durable.ts` (pur, testé). Ici :
 *
 *  1. le post est relu SOUS LE COMPTE ; sa `renderedVideoUrl` doit désigner
 *     un rendu WebM de ce compte (`<uid>/rendus/<uuid>.webm`) ;
 *  2. la ligne `rendus` correspondante doit être `confirmed` : seul un rendu
 *     PROUVÉ et payé reçoit un MP4 ;
 *  3. si `<uuid>.mp4` existe déjà, il est réutilisé (idempotent) ;
 *  4. sinon : jeton du limiteur de conversions (le même que
 *     `/api/convert/to-mp4`), téléchargement borné, échelle ffmpeg partagée
 *     (`transcode-to-mp4.ts` : H.264 + AAC + `+faststart`, AUCUN filtre
 *     audio — ni volume, ni normalisation, ni vitesse), contrôle du contenu
 *     (boîte `ftyp`), dépôt à côté du WebM ;
 *  5. le post n'est mis à jour que s'il pointe ENCORE sur ce WebM.
 *
 * Un échec laisse le WebM en place et le signale sur le post
 * (`mp4Indisponible`). Rien n'est jamais renommé.
 *
 * Aucun crédit, aucun prix, aucun fournisseur payant : une conversion locale.
 */
import { randomUUID } from 'crypto';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { supabaseAdmin } from '@/lib/db/supabase';
import { clientMinio } from '@/lib/storage/minio-client';
import { verifierObjet } from '@/lib/storage/verifier-objet';
import { downloadMediaToFile } from '@/lib/storage/fetch-media';
import {
  extraireCibleStockage, originesStockageConfigurees,
} from '@/lib/storage/acces-objet';
import { montageAmelioreActifPourCompte } from '@/lib/creer/montage-ameliore-config';
import { controlerMp4, messagesControle, type AttentesMp4, type ResultatControleMp4 } from '@/lib/render/controle-qualite-mp4';
import { transcodeWebmToMp4WithLadder } from '@/lib/ffmpeg/transcode-to-mp4';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';
import {
  limiteurConversions, tailleMaxSourceConversion, DELAI_DEPOT_MS,
} from '@/lib/ffmpeg/limiteur-conversions';
import { BUCKET_RENDUS } from '@/lib/rendus/service';
import {
  cleMp4DuRendu, idRenduDeCle, decisionStockageMp4,
  patchPostAvecMp4, patchPostEchecMp4,
} from '@/lib/rendus/mp4-durable';

export type MotifMp4 =
  | 'post_introuvable' | 'non_applicable' | 'non_confirme' | 'occupe'
  | 'telechargement' | 'conversion' | 'sortie_invalide' | 'depot' | 'perime';

export type IssueMp4 =
  | { ok: true; mp4Url: string; reutilise: boolean; postMisAJour: boolean }
  | { ok: false; motif: MotifMp4 };

function urlPublique(bucket: string, cle: string): string {
  return supabaseAdmin.storage.from(bucket).getPublicUrl(cle).data.publicUrl;
}

async function deposer(bucket: string, cle: string, octets: Buffer): Promise<boolean> {
  if ((process.env.STORAGE_PROVIDER || '').toLowerCase() === 's3') {
    try {
      await clientMinio({ timeoutMs: DELAI_DEPOT_MS })
        .putObject(bucket, cle, octets, octets.length, { 'Content-Type': 'video/mp4' });
      return true;
    } catch (err) {
      console.error('[MP4-DURABLE] depot', err instanceof Error ? err.message : String(err));
      return false;
    }
  }
  const { error } = await supabaseAdmin.storage
    .from(bucket).upload(cle, octets, { contentType: 'video/mp4', upsert: false });
  if (error) console.error('[MP4-DURABLE] depot', error.message);
  return !error;
}

/**
 * Ce que le post dit de sa vidéo : durée du montage, son prévu, format. Rien d'inventé : inconnu reste inconnu.
 *  - durée : `sequences.total` SEUL — Créer l'écrit comme « la durée RÉELLE de la vidéo »
 *    (AssistantWizard). Les durées par séquence n'en tiennent pas lieu : en surimpression,
 *    titre / cartes / CTA gardent les durées de l'éditeur, posées SUR la vidéo.
 *  - format : `videoFormat` (9:16, 1:1, 16:9). Jamais `format`, valeur de FACTURATION où le
 *    carré vaut « tv » — il faisait signaler à tort chaque vidéo carrée comme mal orientée.
 */
export function attentesDuPost(meta: Record<string, unknown>): AttentesMp4 {
  const seq = (meta.sequences ?? null) as Record<string, unknown> | null;
  const dureeS = seq && typeof seq.total === 'number' && seq.total > 0 ? seq.total : null;
  const format = meta.videoFormat === '9:16' ? 'reel' : meta.videoFormat === '16:9' ? 'tv' : meta.videoFormat === '1:1' ? 'carre' : null;
  return { dureeS, son: meta.hasAudio === true ? 'attendu' : 'inconnu', format };
}

async function marquerEchec(userId: string, postId: string, post: { metadata?: unknown }, webmUrl: string, motif: MotifMp4) {
  const patch = patchPostEchecMp4(post, webmUrl, motif);
  if (!patch) return;
  const { error } = await supabaseAdmin
    .from('scheduled_posts').update(patch).eq('id', postId).eq('user_id', userId);
  if (error) console.error('[MP4-DURABLE] marquage echec', error.message);
}

/** Produit (ou retrouve) le MP4 du rendu de ce post, puis met le post à jour. */
export async function produireMp4DuPost(userId: string, postId: string): Promise<IssueMp4> {
  const { data: post, error: ePost } = await supabaseAdmin
    .from('scheduled_posts')
    .select('id, media_url, metadata')
    .eq('id', postId)
    .eq('user_id', userId)
    .maybeSingle();
  if (ePost || !post) return { ok: false, motif: 'post_introuvable' };

  const meta = (post.metadata ?? {}) as Record<string, unknown>;
  const webmUrl = typeof meta.renderedVideoUrl === 'string' ? meta.renderedVideoUrl : '';
  const cible = extraireCibleStockage(webmUrl, { origines: originesStockageConfigurees() });
  if (!cible || cible.bucket !== BUCKET_RENDUS) return { ok: false, motif: 'non_applicable' };
  const renduId = idRenduDeCle(cible.cle, userId);
  const cleMp4 = cleMp4DuRendu(cible.cle, userId);
  if (!renduId || !cleMp4) return { ok: false, motif: 'non_applicable' };

  // Seul un rendu PROUVÉ (vu par le serveur, confirmé) reçoit un MP4.
  const { data: rendu } = await supabaseAdmin
    .from('rendus').select('id, etat, cle_objet')
    .eq('id', renduId).eq('user_id', userId).maybeSingle();
  if (!rendu || rendu.etat !== 'confirmed' || rendu.cle_objet !== cible.cle) {
    return { ok: false, motif: 'non_confirme' };
  }

  const appliquer = async (
    mp4Url: string, reutilise: boolean, controle: { resultat: unknown; avertissements: string[] } | null = null,
  ): Promise<IssueMp4> => {
    // Relu juste avant d'écrire : un rendu plus récent a pu arriver.
    const { data: frais } = await supabaseAdmin
      .from('scheduled_posts').select('id, media_url, metadata')
      .eq('id', postId).eq('user_id', userId).maybeSingle();
    const patch = frais ? patchPostAvecMp4(frais, { webmUrl, mp4Url }, controle) : null;
    if (!patch) return { ok: true, mp4Url, reutilise, postMisAJour: false };
    const { error } = await supabaseAdmin
      .from('scheduled_posts').update(patch).eq('id', postId).eq('user_id', userId);
    if (error) {
      console.error('[MP4-DURABLE] mise a jour du post', error.message);
      return { ok: false, motif: 'depot' };
    }
    return { ok: true, mp4Url, reutilise, postMisAJour: true };
  };

  // Idempotent : le MP4 existe déjà (double appel, reprise).
  const deja = await verifierObjet(cible.bucket, cleMp4, userId);
  if (deja.ok) return appliquer(urlPublique(cible.bucket, cleMp4), true);

  const jeton = limiteurConversions().acquerir(userId);
  if (!jeton.ok) return { ok: false, motif: 'occupe' };

  const id = randomUUID();
  const entree = join(tmpdir(), `mp4durable_${id}.webm`);
  const sortie = join(tmpdir(), `mp4durable_${id}.mp4`);
  try {
    try {
      await downloadMediaToFile(webmUrl, entree, { userId, maxBytes: tailleMaxSourceConversion() });
    } catch (err) {
      console.error('[MP4-DURABLE] telechargement', err instanceof Error ? err.message : String(err));
      await marquerEchec(userId, postId, post, webmUrl, 'telechargement');
      return { ok: false, motif: 'telechargement' };
    }

    try {
      // Pas de `signal` : la conversion va à son terme même si l'onglet se
      // ferme — c'est ce qui rend le MP4 durable.
      await transcodeWebmToMp4WithLadder(cheminFfmpeg(), entree, sortie, '[MP4-DURABLE]');
    } catch (err) {
      console.error('[MP4-DURABLE] ffmpeg', (err instanceof Error ? err.message : String(err)).slice(-300));
      await marquerEchec(userId, postId, post, webmUrl, 'conversion');
      return { ok: false, motif: 'conversion' };
    }

    const octets = await readFile(sortie);
    const decision = decisionStockageMp4({ cleWebm: cible.cle, userId, sortie: octets });
    if (!decision.stocker) {
      await marquerEchec(userId, postId, post, webmUrl, decision.motif);
      return { ok: false, motif: decision.motif };
    }

    // Contrôle qualité du MP4 produit (ffmpeg local, aucun crédit) : observe, ne change pas l'encodage.
    // Illisible / sans vidéo / presque noir : même gestion d'erreur qu'une sortie invalide (le WebM reste).
    // Défauts mineurs : avertissements discrets sur le post, lus par le Calendrier. Panne du contrôle : ignorée.
    // « Montage amélioré » : interrupteur serveur + utilisateur connecté (`montage-ameliore-config.ts`)
    // — éteint : aucun contrôle, le MP4 est déposé comme en production.
    let controle: { resultat: ResultatControleMp4; avertissements: string[] } | null = null;
    try {
      if (await montageAmelioreActifPourCompte(userId)) {
        const resultat = await controlerMp4(sortie, attentesDuPost(meta), { ffmpeg: cheminFfmpeg() });
        if (resultat) controle = { resultat, avertissements: messagesControle(resultat) };
      }
    } catch (err) {
      console.warn('[MP4-DURABLE] controle qualite indisponible', err instanceof Error ? err.message : String(err));
    }
    if (controle?.resultat.niveau === 'inutilisable') {
      console.error('[MP4-DURABLE] sortie inutilisable', controle.resultat.problemes.map((p) => p.code).join(','));
      await marquerEchec(userId, postId, post, webmUrl, 'sortie_invalide');
      return { ok: false, motif: 'sortie_invalide' };
    }

    if (!(await deposer(cible.bucket, decision.cleMp4, octets))) {
      // Course : un autre appel l'a peut-être déposé entre-temps.
      const revu = await verifierObjet(cible.bucket, decision.cleMp4, userId);
      if (!revu.ok) {
        await marquerEchec(userId, postId, post, webmUrl, 'depot');
        return { ok: false, motif: 'depot' };
      }
    }
    return appliquer(urlPublique(cible.bucket, decision.cleMp4), false, controle);
  } finally {
    jeton.liberer();
    await unlink(entree).catch(() => {});
    await unlink(sortie).catch(() => {});
  }
}
