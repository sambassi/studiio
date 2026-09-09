import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { validationPossible, MESSAGES_VALIDATION } from '@/lib/avatar/etats';

/**
 * A_8e — « JE VALIDE MON CLONE ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE VALIDER VEUT DIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * « J'accepte que ceci parle a ma place. » C'est la seule porte qui ouvrira
 * l'usage du clone a l'Autopilote. Elle ne doit donc jamais s'ouvrir sur autre
 * chose qu'un clone reellement entraine et reellement regarde.
 *
 * ⚠️ TROIS CONDITIONS, TENUES PAR `validationPossible` : un identifiant chez le
 * fournisseur, un entrainement termine, un apercu reel. Un enrollment
 * `source_ready` echoue sur les trois — sa video est prete, rien d'autre.
 *
 * ⚠️ L'ETAT VIENT DE LA BASE, JAMAIS DE LA REQUETE. Le navigateur envoie un
 * identifiant d'avatar, et c'est tout : accepter un statut ou un apercu depuis
 * le corps reviendrait a laisser n'importe qui declarer son clone valide.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const introuvable = () => NextResponse.json(
  { ok: false, error: 'Clone introuvable' }, { status: 404 },
);

export async function POST(
  _req: NextRequest, { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  /* La propriete est DANS la requete : l'avatar d'autrui ne revient pas, donc
     il n'y a rien a decider ensuite — et un 403 aurait confirme son existence. */
  const { data, error } = await supabaseAdmin
    .from('user_avatars')
    .select('id, status, provider_avatar_id, validated_at')
    .eq('id', params.id ?? '')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return introuvable();

  /* ⚠️ L'APERCU N'EXISTE PAS ENCORE, ET C'EST VOULU. Il naitra avec le premier
     entrainement reel (A_8_FINAL). Tant qu'aucune generation d'apercu n'est
     rattachee au clone, la validation reste fermee — plutot que d'inventer une
     image pour deverrouiller un bouton. */
  const apercuUrl = await apercuDuClone(userId, (data as { id: string }).id);

  const verdict = validationPossible({ ...(data as Record<string, unknown>), apercuUrl });
  if (!verdict.ok) {
    return NextResponse.json(
      { ok: false, motif: verdict.motif, error: MESSAGES_VALIDATION[verdict.motif] },
      { status: 409 },
    );
  }

  const { data: maj, error: erreurMaj } = await supabaseAdmin
    .from('user_avatars')
    .update({ validated_at: new Date().toISOString() })
    .eq('id', (data as { id: string }).id)
    .eq('user_id', userId)
    /* ⚠️ ET SEULEMENT SI ELLE NE L'EST PAS DEJA. Deux clics rapides ne doivent
       pas reecrire la date : ce qui a ete accepte l'a ete a un instant donne. */
    .is('validated_at', null)
    .select()
    .single();

  if (erreurMaj || !maj) {
    return NextResponse.json(
      { ok: false, error: 'Votre validation n’a pas pu être enregistrée.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, avatar: maj });
}

/**
 * L'apercu reel du clone, s'il en existe un.
 *
 * Aujourd'hui : la generation d'apercu n'existe pas encore, donc cette
 * fonction ne trouve rien et la validation reste fermee. Elle est ecrite pour
 * que A_8_FINAL n'ait qu'a la remplir, pas pour simuler un resultat.
 */
async function apercuDuClone(userId: string, avatarId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('avatar_generations')
    .select('video_url')
    .eq('user_id', userId)
    .eq('user_avatar_id', avatarId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const url = (data as { video_url?: unknown } | null)?.video_url;
  return typeof url === 'string' && url.length > 0 ? url : null;
}
