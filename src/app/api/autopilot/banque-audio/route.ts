/**
 * A_5a — LA BANQUE AUDIO : AJOUTER, RENOMMER, RETIRER.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AJOUTER N'EST PAS TÉLÉVERSER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le fichier est DÉJÀ dans la médiathèque du compte — c'est le téléversement
 * existant qui l'y a mis, et il n'a pas besoin d'être refait. Cette route
 * CATALOGUE un objet existant : elle le sonde, mesure son blanc de départ,
 * dessine sa forme d'onde, et écrit une fiche.
 *
 * Aucun octet n'est dupliqué : la banque désigne, elle ne copie pas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LA PROPRIÉTÉ AVANT LE STOCKAGE, COMME AILLEURS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le préfixe `<userId>/` est vérifié AVANT la moindre requête à MinIO :
 * interroger le stockage sur la clé d'un tiers, même pour refuser ensuite,
 * ferait de cette route un révélateur d'existence.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ RETIRER DU CATALOGUE NE DÉTRUIT RIEN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La fiche part, le fichier reste dans la médiathèque. Détruire l'objet
 * depuis ici casserait les rendus passés qui le nomment — et la médiathèque a
 * déjà sa propre suppression, explicite, à laquelle personne ne s'attend
 * quand il retire une musique d'une liste.
 */
import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { auth } from '@/lib/auth/config';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';
import { lecteurMinio, clientMinio } from '@/lib/storage/minio-client';
import {
  lireBibliothequeUtilisateur,
  ajouterPisteBanqueAudio, muterPisteBanqueAudio,
  MESSAGES_BIBLIOTHEQUE, type MutationBanqueAudio,
} from '@/lib/autopilot/analyse/profil-compte';
import {
  cleAudioValide, nomPisteValide, moodsValides, pisteParCle,
  PISTES_AUDIO_MAX, type PisteAudio,
} from '@/lib/creatif/audio';
import {
  argumentsSondeAudio, lireSondeAudio, argumentsFormeOnde, formeOndeDepuisPcm,
  encoderFormeOnde, empreinteAsset, dureeAudioAcceptable,
  OCTETS_AUDIO_MAX, MESSAGES_IMPORT_AUDIO, type MotifImportAudio,
} from '@/lib/autopilot/analyse/audio-import';
import { BUCKET_MUSIQUE } from '@/lib/autopilot/analyse/recette-audio';
import {
  argumentsMesureSilence, silenceInitialSecondes,
} from '@/lib/autopilot/analyse/musique-silence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const executer = promisify(execFile);
const TIMEOUT_MS = 30_000;

const refus = (motif: MotifImportAudio, statut = 400) => NextResponse.json(
  { ok: false, motif, error: MESSAGES_IMPORT_AUDIO[motif] }, { status: statut },
);

/**
 * L'echec d'une mutation atomique, traduit en reponse HTTP.
 *
 * ⚠️ UN SEUL ENDROIT, POUR QUE `200` VEUILLE TOUJOURS DIRE « PERSISTE ». Avant
 * la mutation atomique, la route repondait 200 apres une ecriture qu'une
 * ecriture voisine pouvait avoir deja effacee. Desormais le succes de la RPC
 * EST la persistance ; tout le reste passe par ici et sort en erreur.
 */
function echecMutation(motif: Extract<MutationBanqueAudio, { ok: false }>['motif']) {
  if (motif === 'pleine') return refus('banque_pleine');
  if (motif === 'absente') return refus('fichier_absent', 404);
  return NextResponse.json(
    {
      ok: false,
      error: motif === 'socle_absent'
        ? MESSAGES_BIBLIOTHEQUE.store_indisponible
        : MESSAGES_BIBLIOTHEQUE.ecriture_impossible,
    },
    { status: motif === 'socle_absent' ? 503 : 500 },
  );
}

/** Le PCM mono, lu au fil de l'eau puis rassemblé — jamais le fichier entier. */
function decoder(args: string[]): Promise<Buffer> {
  return new Promise((resoudre, rejeter) => {
    const proc = spawn(cheminFfmpeg(), args);
    const bouts: Buffer[] = [];
    let octets = 0;
    const minuterie = setTimeout(() => proc.kill('SIGKILL'), TIMEOUT_MS);
    proc.stdout.on('data', (d: Buffer) => {
      // Une borne pendant la lecture : un fichier aberrant ne doit pas faire
      // grossir le tas avant d'être plafonné.
      if (octets > 120 * 1024 * 1024) { proc.kill('SIGKILL'); return; }
      octets += d.length;
      bouts.push(d);
    });
    proc.on('error', (e) => { clearTimeout(minuterie); rejeter(e); });
    proc.on('close', () => { clearTimeout(minuterie); resoudre(Buffer.concat(bouts)); });
    proc.stdin.end();
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const b = await lireBibliothequeUtilisateur(session.user.id);
  return NextResponse.json({ ok: true, pistes: b.audio.pistes });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let corps: Record<string, unknown>;
  try { corps = (await req.json()) as Record<string, unknown>; } catch {
    return NextResponse.json({ ok: false, error: 'Corps invalide' }, { status: 400 });
  }

  const cle = corps.cle;
  if (!cleAudioValide(cle, userId)) return refus('cle_hors_perimetre', 403);
  /* ⚠️ LES DROITS SONT DÉCLARÉS, PAS DEVINÉS. Studiio ne peut pas savoir si
     quelqu'un possède un morceau ; il peut lui demander de l'affirmer, et
     garder la date de cette affirmation. */
  if (corps.droitsConfirmes !== true) return refus('droits_non_confirmes');

  /* ⚠️ CE PREMIER REGARD EST UNE ECONOMIE, PAS LA GARANTIE. Il evite de
     descendre puis d'analyser un fichier pour une banque manifestement pleine.
     La decision qui FAIT AUTORITE est prise dans la transaction, par la RPC :
     entre cette lecture et l'ecriture, une piste voisine peut arriver. */
  const biblio = await lireBibliothequeUtilisateur(userId);
  const dejaLa = pisteParCle(biblio.audio, cle);
  if (!dejaLa && biblio.audio.pistes.length >= PISTES_AUDIO_MAX) {
    return refus('banque_pleine');
  }

  let dossier: string | null = null;
  try {
    // ── L'objet, et sa taille, AVANT de le descendre ────────────────────
    let stat: { size: number; etag?: string } | null = null;
    try {
      stat = await clientMinio().statObject(BUCKET_MUSIQUE, cle) as unknown as
        { size: number; etag?: string };
    } catch {
      return refus('fichier_absent', 404);
    }
    const octets = Number(stat?.size ?? 0);
    if (!(octets > 0)) return refus('fichier_absent', 404);
    if (octets > OCTETS_AUDIO_MAX) return refus('fichier_trop_gros');

    dossier = await mkdtemp(join(tmpdir(), 'audio-import-'));
    const local = join(dossier, 'piste');
    const flux = await lecteurMinio().getObject(BUCKET_MUSIQUE, cle);
    const bouts: Buffer[] = [];
    for await (const c of flux as AsyncIterable<Buffer>) bouts.push(c);
    await writeFile(local, Buffer.concat(bouts));

    // ── La sonde : c'est elle qui dit si c'est un audio ─────────────────
    let sonde;
    try {
      const { stdout } = await executer(cheminFfprobe(), argumentsSondeAudio(local),
        { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 });
      sonde = lireSondeAudio(stdout);
    } catch {
      return refus('analyse_impossible', 503);
    }
    if (sonde === null) return refus('pas_un_audio');
    if (!dureeAudioAcceptable(sonde.dureeMs)) return refus('duree_hors_bornes');

    // ── Le blanc de départ, mesuré une fois pour l'écran ────────────────
    let silenceInitialMs = 0;
    try {
      const { stderr } = await executer(
        cheminFfmpeg(), [...argumentsMesureSilence(local)],
        { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      ).catch((e: { stderr?: string }) => ({ stderr: e?.stderr ?? '' }));
      silenceInitialMs = Math.round(silenceInitialSecondes(stderr ?? '') * 1000);
    } catch {
      silenceInitialMs = 0;
    }

    // ── La forme d'onde, depuis le VRAI signal ──────────────────────────
    let formeOnde: string | undefined;
    try {
      const pcm = await decoder(argumentsFormeOnde(local));
      const points = formeOndeDepuisPcm(pcm);
      if (points.length > 0) formeOnde = encoderFormeOnde(points);
    } catch {
      // Une onde absente n'empêche pas d'utiliser la musique : la carte
      // affichera son nom et sa durée, et rien de faux.
      formeOnde = undefined;
    }

    const piste: PisteAudio = {
      cle,
      nom: nomPisteValide(corps.nom) ?? nomPisteValide(cle.split('/').pop()) ?? 'Musique',
      moods: moodsValides(corps.moods),
      dureeMs: sonde.dureeMs,
      silenceInitialMs,
      octets,
      empreinte: empreinteAsset(octets, stat?.etag),
      /* La date proposee ne sert que si la fiche n'existait pas : quand elle
         existe, la RPC conserve la sienne — une declaration de droits atteste
         un jour donne, la réécrire l'effacerait. */
      droitsConfirmesLe: dejaLa?.droitsConfirmesLe ?? new Date().toISOString(),
      ...(formeOnde ? { formeOnde } : {}),
    };

    /* ⚠️ NI LECTURE NI CALCUL DE LISTE ICI — C'EST TOUT LE CORRECTIF. La liste
       est relue sous verrou par la RPC au moment ou elle l'ecrit ; deux imports
       simultanes ne peuvent plus se recouvrir. Reconstituer `[...pistes, piste]`
       en memoire, meme suivi d'une fusion atomique, ecrivait fidelement une
       valeur perimee et effacait la piste voisine. */
    const r = await ajouterPisteBanqueAudio(userId, piste, PISTES_AUDIO_MAX);
    if (!r.ok) return echecMutation(r.motif);
    /* `issue` distingue « ajoutee » de « deja la, fiche remise a jour » — et le
       succes designe desormais un etat REELLEMENT persiste, pas une intention. */
    return NextResponse.json({ ok: true, issue: r.issue, piste, pistes: r.pistes });
  } catch {
    // Le message n'est PAS repris : il porterait un chemin.
    return refus('analyse_impossible', 503);
  } finally {
    if (dossier) await rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
}

/** Renommer, retagger, ou retirer du catalogue. */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  let corps: Record<string, unknown>;
  try { corps = (await req.json()) as Record<string, unknown>; } catch {
    return NextResponse.json({ ok: false, error: 'Corps invalide' }, { status: 400 });
  }
  const cle = corps.cle;
  if (!cleAudioValide(cle, userId)) return refus('cle_hors_perimetre', 403);

  /* ⚠️ LE MEME VERROU QUE L'AJOUT, ET POUR LA MEME RAISON. Reecrire la liste
     depuis une lecture anterieure faisait disparaitre la piste qu'un import
     voisin venait d'ajouter : un retrait et un ajout concurrents se perdaient
     l'un l'autre. La RPC relit la liste au moment ou elle l'ecrit — et, quand
     elle retire, nettoie favoris et autorisations DANS LA MEME TRANSACTION,
     pour qu'aucun favori ne designe jamais une fiche disparue. */
  const retirer = corps.retirer === true;
  const r = retirer
    ? await muterPisteBanqueAudio(userId, cle, { retirer: true })
    : await muterPisteBanqueAudio(userId, cle, {
      retirer: false,
      nom: nomPisteValide(corps.nom) ?? null,
      moods: corps.moods === undefined ? null : moodsValides(corps.moods),
    });
  if (!r.ok) return echecMutation(r.motif);
  return NextResponse.json({ ok: true, issue: r.issue, pistes: r.pistes });
}
