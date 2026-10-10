/**
 * POST /api/voice/audio-complet — « Générer l'audio complet » avec LA voix
 * personnelle du compte. Opération autonome et PAYANTE : 1 crédit Studiio
 * par bloc entamé de 1000 caractères (`coutAudioComplet`), 0 pour un
 * administrateur. La pré-écoute (`/api/voice/ecoute`) reste gratuite.
 *
 * Le navigateur envoie `{ texte }` et RIEN d'autre : un champ de coût, de
 * crédits ou d'identité est refusé (422). Le serveur :
 *   1. résout la voix du compte (409 sans voix) et le texte dit ;
 *   2. calcule le prix sur le texte reçu, relit l'exemption EN BASE ;
 *   3. dérive l'empreinte sha256(compte | voix | texte dit) → chemin de
 *      l'objet + référence du débit ;
 *   4. objet déjà là → le rend, sans synthèse ni débit (`dejaGenere`) ;
 *   5. solde vérifié AVANT tout appel fournisseur (402) ;
 *   6. une seule génération en vol par empreinte (double clic partagé) ;
 *   7. synthèse → envoi au stockage → débit, DANS CET ORDRE : il n'existe
 *      aucun remboursement atomique, on ne débite donc qu'un audio réussi.
 *      Débit refusé → l'objet est supprimé, rien n'est livré.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { resoudreVoixDuCompte, MESSAGES_VOIX } from '@/lib/voice/profil';
import { scriptParle } from '@/lib/voice/prononciations';
import { synthetiserAvecVoix } from '@/lib/voice/synthese';
import { getUserCredits, deductCredits } from '@/lib/credits/system';
import { referenceOperation } from '@/lib/credits/atomique';
import { compteExempteDeCredits } from '@/lib/facturation/exemption';
import { CHAMPS_INTERDITS_FACTURATION } from '@/lib/facturation/politique';
import { uploadBufferToStorage, deleteFromStorage } from '@/lib/storage/upload';
import {
  MAX_CARACTERES_AUDIO_COMPLET, coutAudioComplet, messageCreditsInsuffisants,
  MESSAGE_TEXTE_AUDIO_COMPLET_VIDE, MESSAGE_TEXTE_AUDIO_COMPLET_TROP_LONG,
  MESSAGE_AUDIO_COMPLET_ECHEC, MESSAGE_AUDIO_COMPLET_INDISPONIBLE,
} from '@/lib/voice/audio-complet';
import {
  BUCKET_AUDIO_COMPLET, OPERATION_AUDIO_COMPLET, empreinteAudioComplet, cheminAudioComplet,
  objetAudioCompletExiste, partagerEnVol, type ResultatAudioComplet,
} from '@/lib/voice/audio-complet-serveur';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const SANS_CACHE = { 'Cache-Control': 'private, no-store' };
const repondre = (r: ResultatAudioComplet) => NextResponse.json(r.corps, { status: r.status, headers: SANS_CACHE });
const refus = (status: number, error: string, code: string, extra: Record<string, unknown> = {}): ResultatAudioComplet =>
  ({ status, corps: { success: false, error, code, ...extra } });

/** Les champs que ce corps ne doit JAMAIS porter : prix, crédits, identité, référence. */
const CHAMPS_REFUSES: readonly string[] = [...CHAMPS_INTERDITS_FACTURATION, 'reference', 'reference_id'];

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: SANS_CACHE });

  let corps: unknown = null;
  try { corps = await req.json(); } catch { corps = null; }
  if (corps && typeof corps === 'object' && !Array.isArray(corps)) {
    const interdits = Object.keys(corps).filter((k) => CHAMPS_REFUSES.includes(k));
    if (interdits.length > 0) {
      return repondre(refus(422, 'Le prix est calculé par le serveur : ces champs ne sont pas acceptés.', 'champs_interdits', { champs: interdits }));
    }
  }
  const brut = corps && typeof corps === 'object' ? (corps as { texte?: unknown }).texte : undefined;
  const texte = typeof brut === 'string' ? brut.trim() : '';
  if (!texte) return repondre(refus(400, MESSAGE_TEXTE_AUDIO_COMPLET_VIDE, 'texte_invalide'));
  if (texte.length > MAX_CARACTERES_AUDIO_COMPLET) return repondre(refus(400, MESSAGE_TEXTE_AUDIO_COMPLET_TROP_LONG, 'texte_trop_long'));

  const voix = await resoudreVoixDuCompte(userId);
  if (!voix.ok) {
    if ('motif' in voix) return repondre(refus(409, MESSAGES_VOIX[voix.motif], voix.motif));
    console.error('[Voice][audio-complet] voix illisible :', voix.erreur);
    return repondre(refus(500, 'Votre voix n’a pas pu être lue.', 'voix_illisible'));
  }

  const spoken = scriptParle(texte, voix.prononciations);
  // Garde du fournisseur : les prononciations allongent un peu le texte, jamais du double.
  if (spoken.length > MAX_CARACTERES_AUDIO_COMPLET * 2) return repondre(refus(400, MESSAGE_TEXTE_AUDIO_COMPLET_TROP_LONG, 'texte_trop_long'));

  const cout = coutAudioComplet(texte.length);
  const empreinte = empreinteAudioComplet(userId, voix.providerVoiceId, spoken);
  const reference = referenceOperation(OPERATION_AUDIO_COMPLET, empreinte) as string;
  const chemin = cheminAudioComplet(userId, empreinte);
  const caracteres = texte.length;

  const resultat = await partagerEnVol(`${userId}\u0000${empreinte}`, async () => {
    const exempt = await compteExempteDeCredits(userId);

    // Déjà généré (rafraîchissement, second envoi) : rendu tel quel, rien n'est facturé deux fois.
    if (await objetAudioCompletExiste(BUCKET_AUDIO_COMPLET, chemin)) {
      const { data } = supabaseAdmin.storage.from(BUCKET_AUDIO_COMPLET).getPublicUrl(chemin);
      return { status: 200, corps: { success: true, url: data.publicUrl, creditsDebites: 0, cout, caracteres, dejaGenere: true } };
    }

    // Le solde AVANT tout appel fournisseur.
    if (!exempt) {
      let solde = 0;
      try { solde = await getUserCredits(userId); } catch (e) {
        console.error('[Voice][audio-complet] solde illisible :', e instanceof Error ? e.message : e);
        return refus(503, 'Votre solde de crédits n’a pas pu être lu. Réessayez.', 'solde_indisponible');
      }
      if (solde < cout) return refus(402, messageCreditsInsuffisants(cout), 'credits_insuffisants', { cout });
    }

    const synthese = await synthetiserAvecVoix({ providerVoiceId: voix.providerVoiceId, texte: spoken });
    if (!synthese.ok) {
      if (synthese.motif === 'indisponible') return refus(503, MESSAGE_AUDIO_COMPLET_INDISPONIBLE, 'audio_indisponible');
      console.error(`[Voice][audio-complet] ElevenLabs ${synthese.statut ?? 'sans statut'} : ${synthese.detail}`);
      return refus(502, MESSAGE_AUDIO_COMPLET_ECHEC, 'audio_echec');
    }

    let url: string;
    try {
      url = await uploadBufferToStorage({ buffer: synthese.audio, bucket: BUCKET_AUDIO_COMPLET, storagePath: chemin, contentType: synthese.contentType });
    } catch (e) {
      console.error('[Voice][audio-complet] envoi au stockage :', e instanceof Error ? e.message : e);
      return refus(503, MESSAGE_AUDIO_COMPLET_ECHEC, 'stockage_indisponible');
    }

    // Le débit APRÈS le succès, idempotent sur la référence. Refusé → rien n'est livré.
    if (!exempt) {
      try {
        await deductCredits(userId, cout, OPERATION_AUDIO_COMPLET, reference);
      } catch (e) {
        await deleteFromStorage(BUCKET_AUDIO_COMPLET, chemin);
        const message = e instanceof Error ? e.message : String(e);
        if (message === 'Insufficient credits') return refus(402, messageCreditsInsuffisants(cout), 'credits_insuffisants', { cout });
        console.error('[Voice][audio-complet] débit refusé :', message);
        return refus(503, 'Le débit des crédits a échoué : l’audio n’a pas été livré. Réessayez.', 'debit_indisponible');
      }
    }

    return { status: 200, corps: { success: true, url, creditsDebites: exempt ? 0 : cout, cout, caracteres, dejaGenere: false } };
  });

  return repondre(resultat);
}
