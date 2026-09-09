/**
 * A_6c — GÉNÉRER LA VOIX-OFF DU COMPTE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LA VOIX EST VÉRIFIÉE AVANT D'ÊTRE EMPLOYÉE, PAS APRÈS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `resoudreVoixElevenLabs` répond à une seule question : ce compte a-t-il le
 * droit de faire parler CETTE voix ? Une voix clonée doit être la sienne, avec
 * sa preuve datée de consentement ; une voix du catalogue n'appartient à
 * personne. Le contrôle est ici, avant l'appel au fournisseur, et il n'a
 * aucune exception.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ STUDIIO N'ÉCRIT PAS LE SCRIPT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le texte vient de la personne, et de personne d'autre. Faire écrire une
 * phrase par une machine, puis la faire dire par la voix clonée de quelqu'un,
 * c'est fabriquer une déclaration qu'il n'a jamais faite — et c'est vrai même
 * quand l'objectif de la vidéo s'appelle « témoignage ». Aucune génération de
 * script n'existe dans ce chemin, et il n'y en aura pas par accident : il n'y
 * a rien à désactiver.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ET ON DEMANDE LES MINUTAGES DÈS LA SYNTHÈSE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A_4 refuse de sous-titrer sans mots horodatés — répartir un texte
 * uniformément donnerait un minutage inventé. `with-timestamps` rend l'audio
 * ET l'alignement dans le même appel : c'est ce qui rend les sous-titres de
 * voix-off possibles sans rien deviner.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { clientMinio } from '@/lib/storage/minio-client';
import { BUCKET_MUSIQUE } from '@/lib/autopilot/analyse/recette-audio';
import {
  resoudreVoixElevenLabs, MESSAGES_VOIX, ELEVENLABS_PREFIXE,
} from '@/lib/voice/perimetre';
import { texteParle } from '@/lib/voice/pipeline';
import {
  motsDepuisAlignement, scriptValide, dureeVoixSecondes, SCRIPT_MAX,
} from '@/lib/voice/synthese';
import {
  lireBibliothequeUtilisateur, enregistrerBibliothequeUtilisateur,
  MESSAGES_BIBLIOTHEQUE,
} from '@/lib/autopilot/analyse/profil-compte';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE = 'https://api.elevenlabs.io';
const MODELE = 'eleven_multilingual_v2';
const TIMEOUT_MS = 60_000;

/** Ce qu'une voix-off pèse au plus. Au-delà, ce n'est plus une voix-off. */
const OCTETS_MAX = 12 * 1024 * 1024;

function cle(userId: string): string {
  // ⚠️ FABRIQUÉE PAR LE SERVEUR. Rien de ce que le navigateur envoie n'entre
  // dans un chemin de stockage.
  return `${userId}/voix/${Date.now()}-voix-off.mp3`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'La voix-off n’est pas encore disponible sur ce compte.' },
      { status: 503 },
    );
  }

  let corps: Record<string, unknown>;
  try { corps = (await req.json()) as Record<string, unknown>; } catch {
    return NextResponse.json({ ok: false, error: 'Corps invalide' }, { status: 400 });
  }

  const script = scriptValide(corps.script);
  if (script === null) {
    return NextResponse.json(
      { ok: false, error: `Écris ce que ta voix doit dire (${SCRIPT_MAX} caractères au plus).` },
      { status: 400 },
    );
  }

  const brut = typeof corps.voiceId === 'string' ? corps.voiceId : '';
  const nu = brut.replace(new RegExp(`^${ELEVENLABS_PREFIXE}`), '').trim();

  /* ⚠️ LE PÉRIMÈTRE D'ABORD, LE FOURNISSEUR ENSUITE. Appeler ElevenLabs pour
     une voix qu'on va refuser dépenserait des crédits sur la voix de
     quelqu'un d'autre. */
  const perimetre = await resoudreVoixElevenLabs(userId, nu, async () => {
    // Le catalogue partagé n'est pas relu ici : une voix-off enregistrée pour
    // un compte se fait avec SA voix. Une voix de catalogue reste possible
    // par le sélecteur, et elle passera par la même porte.
    const r = await fetch(`${BASE}/v2/voices?page_size=100`, {
      headers: { 'xi-api-key': apiKey }, cache: 'no-store',
    }).catch(() => null);
    if (!r || !r.ok) return [];
    const j = await r.json().catch(() => null) as { voices?: { voice_id?: string }[] } | null;
    return (j?.voices ?? [])
      .filter((v) => typeof v.voice_id === 'string')
      .map((v) => ({ id: `${ELEVENLABS_PREFIXE}${v.voice_id}` }));
  });
  if (!perimetre.ok) {
    return NextResponse.json(
      { ok: false, error: MESSAGES_VOIX[perimetre.motif] },
      { status: perimetre.motif === 'voix_sans_consentement' ? 403 : 404 },
    );
  }

  // ── La synthèse, avec ses minutages ───────────────────────────────────
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), TIMEOUT_MS);
  let reponse: Response;
  try {
    reponse = await fetch(
      `${BASE}/v1/text-to-speech/${perimetre.providerVoiceId}/with-timestamps`
      + '?output_format=mp3_44100_128',
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        /* ⚠️ LE TEXTE PARLE, PAS LE TEXTE AFFICHE — A_8d. `script` reste ce
           que la personne a ecrit : il est persiste tel quel plus bas, il
           alimente les sous-titres et l'historique. Ce qui part au moteur de
           synthese est une VUE de ce texte — « 25 CHF » devient « vingt-cinq
           francs suisses » — fabriquee ici et jetee ensuite. */
        body: JSON.stringify({ text: texteParle(script, {
          prononciations: (await lireBibliothequeUtilisateur(userId)).prononciations,
        }), model_id: MODELE }),
        signal: controleur.signal,
        cache: 'no-store',
      },
    );
  } catch {
    clearTimeout(minuterie);
    return NextResponse.json(
      { ok: false, error: 'La synthèse a mis trop de temps. Réessaie.' },
      { status: 504 },
    );
  } finally {
    clearTimeout(minuterie);
  }

  if (!reponse.ok) {
    // Le corps de la réponse n'est PAS repris : il porte des détails du
    // fournisseur qui n'aident personne et peuvent porter un identifiant.
    return NextResponse.json(
      { ok: false, error: 'La synthèse a échoué. Réessaie dans un instant.' },
      { status: 502 },
    );
  }

  const charge = await reponse.json().catch(() => null) as {
    audio_base64?: unknown; alignment?: unknown;
  } | null;
  const base64 = typeof charge?.audio_base64 === 'string' ? charge.audio_base64 : '';
  if (base64.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'La synthèse n’a rien produit. Réessaie.' },
      { status: 502 },
    );
  }
  const octets = Buffer.from(base64, 'base64');
  if (octets.length === 0 || octets.length > OCTETS_MAX) {
    return NextResponse.json(
      { ok: false, error: 'La voix produite est inutilisable. Raccourcis ton texte.' },
      { status: 400 },
    );
  }

  const mots = motsDepuisAlignement(charge?.alignment as never);
  const dureeMs = Math.round(dureeVoixSecondes(mots) * 1000);

  // ── Le dépôt, dans le compartiment audio du compte ────────────────────
  const cheminCle = cle(userId);
  try {
    await clientMinio().putObject(
      BUCKET_MUSIQUE, cheminCle, octets, octets.length,
      { 'Content-Type': 'audio/mpeg' },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: 'La voix n’a pas pu être enregistrée. Réessaie.' },
      { status: 503 },
    );
  }

  const voixOff = {
    cle: cheminCle,
    /* ⚠️ L'EMPREINTE PORTE LES OCTETS. Deux synthèses du même texte ne sont
       pas le même fichier — et deux rendus différents doivent en découler. */
    empreinte: `${octets.length}-${Date.now().toString(36)}`,
    /* Sans minutage, la durée du fichier reste inconnue ici : on prend celle
       des mots, et à défaut une borne minimale qui ne ment pas sur zéro. */
    dureeMs: dureeMs > 0 ? dureeMs : 1_000,
    script,
    voiceId: nu,
    creeeLe: new Date().toISOString(),
    mots,
  };

  const biblio = await lireBibliothequeUtilisateur(userId);
  const r = await enregistrerBibliothequeUtilisateur(userId, { ...biblio, voixOff });
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: MESSAGES_BIBLIOTHEQUE[r.motif] },
      { status: r.motif === 'store_indisponible' ? 503 : 500 },
    );
  }

  /* ⚠️ LE SCRIPT ET LES MOTS REVIENNENT ; LES OCTETS, NON. L'écran a besoin
     de savoir ce qui a été dit et combien de temps ça dure, pas de recevoir
     un fichier qu'il ira chercher par le proxy de stockage comme le reste. */
  return NextResponse.json({ ok: true, voixOff: r.bibliotheque.voixOff });
}

/** Retirer la voix-off du compte. Le fichier, lui, reste dans la médiathèque. */
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const biblio = await lireBibliothequeUtilisateur(session.user.id);
  const r = await enregistrerBibliothequeUtilisateur(
    session.user.id, { ...biblio, voixOff: null },
  );
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: MESSAGES_BIBLIOTHEQUE[r.motif] },
      { status: r.motif === 'store_indisponible' ? 503 : 500 },
    );
  }
  return NextResponse.json({ ok: true, voixOff: null });
}
