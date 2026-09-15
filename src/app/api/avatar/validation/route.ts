/**
 * POST /api/avatar/validation — « Valider mon avatar ».
 *
 * Conditions, toutes vérifiées ICI, sur l'état serveur :
 *   - avatar vivant du compte, entraîné chez le fournisseur (statut réel
 *     synchronisé), pas encore validé (`validationPossible`) ;
 *   - un aperçu RÉEL prêt pour la version courante (`apercuDuClone`) ;
 *   - le JETON d'ouverture de CET aperçu (compte, avatar, version,
 *     génération) — obtenu en demandant à le voir, jamais en cochant une case.
 * Puis `validated_at` par compare-and-set : id, user_id, version,
 * deleted_at IS NULL, validated_at IS NULL. Zéro ligne = la version a bougé
 * ou est déjà validée : on relit et on le dit, sans jamais écrire ailleurs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { avatarVivantDuCompte } from '@/lib/avatar/lecture';
import { apercuDuClone, jetonOuvertureValide } from '@/lib/avatar/apercu';
import { etatAvatar, validationPossible, MESSAGES_VALIDATION } from '@/lib/avatar/contrat';

export const dynamic = 'force-dynamic';

const refus = (code: string, error: string, status = 409) =>
  NextResponse.json({ success: false, error, code }, { status });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let jeton: unknown = null;
  try { jeton = ((await req.json()) as { jeton?: unknown } | null)?.jeton ?? null; } catch { jeton = null; }

  const lecture = await avatarVivantDuCompte(userId);
  if (!lecture.ok) return NextResponse.json({ success: false, error: "Votre avatar n'a pas pu être lu." }, { status: 500 });
  if (!lecture.avatar) return refus('avatar_absent', 'Aucun avatar.', 404);
  const a = lecture.avatar;

  // 1. L'état du clone, avant même de regarder l'aperçu.
  const preliminaire = validationPossible(a, true);
  if (!preliminaire.ok) return refus(preliminaire.motif, MESSAGES_VALIDATION[preliminaire.motif]);

  // 2. L'aperçu réel de CETTE version.
  let apercu;
  try {
    apercu = await apercuDuClone(userId, a.id, a.version);
  } catch (e) {
    console.error('[Avatar][validation] aperçu illisible :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: "L'aperçu n'a pas pu être lu." }, { status: 500 });
  }
  // Un seul garde pour l'aperçu (le contrat `validationPossible` a déjà
  // tranché l'état du clone au-dessus) : sans aperçu PRÊT, rien à valider.
  if (apercu.statut !== 'pret') return refus('apercu_absent', MESSAGES_VALIDATION.apercu_absent);

  // 3. La preuve d'ouverture, liée à cet aperçu et à cette version.
  if (!jetonOuvertureValide(jeton, { userId, avatarId: a.id, version: a.version, generationId: apercu.generationId })) {
    return refus('apercu_non_ouvert', 'Ouvrez d’abord l’aperçu de votre avatar (« Voir mon avatar ») avant de le valider.');
  }

  // 4. L'écriture, par compare-and-set.
  const { data: touchees, error } = await supabaseAdmin
    .from('user_avatars')
    .update({ validated_at: new Date().toISOString() })
    .eq('id', a.id)
    .eq('user_id', userId)
    .eq('version', a.version)
    .is('deleted_at', null)
    .is('validated_at', null)
    .select('id, version, validated_at, status, provider_avatar_id, deleted_at');
  if (error) {
    console.error('[Avatar][validation] écriture impossible :', error.message);
    return NextResponse.json({ success: false, error: 'Votre validation n’a pas pu être enregistrée.', code: 'validation_persistence_failed' }, { status: 500 });
  }
  const ligne = touchees?.[0] as { id: string; version: number; validated_at: string } | undefined;
  if (!ligne) {
    // La version a bougé, ou une autre requête a validé : on relit et on le dit.
    const relu = await avatarVivantDuCompte(userId);
    if (relu.ok && relu.avatar && relu.avatar.id === a.id && relu.avatar.version === a.version && relu.avatar.validated_at) {
      return NextResponse.json({ success: true, data: { avatarId: a.id, version: a.version, validatedAt: relu.avatar.validated_at, dejaValide: true } });
    }
    return refus('avatar_superseded', 'Votre avatar vient d’être remplacé. Rechargez la page.');
  }

  return NextResponse.json({
    success: true,
    data: { avatarId: ligne.id, version: ligne.version, validatedAt: ligne.validated_at, dejaValide: false, etat: etatAvatar({ ...a, validated_at: ligne.validated_at }) },
  });
}
