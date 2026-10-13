/**
 * /api/admin/fournisseurs — ADMIN uniquement. Le financement de Studiio chez
 * ses fournisseurs : état, solde, seuils, recharges constatées, dernière
 * erreur BRUTE, générations en attente, et l'économie (coût fournisseur).
 *
 *   GET   → tout l'écran Admin › Fournisseurs ;
 *   PATCH → { fournisseur, config } : seuils et plafonds (bornés) ;
 *   POST  → { fournisseur, action: 'verifier' } : relit le solde maintenant.
 *
 * ⚠️ Aucune clé API, aucun moyen de paiement n'est lu ni renvoyé ici.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getAllAlerts } from '@/lib/service-alerts';
import {
  CAPACITES, CLE_CONFIG, FOURNISSEURS_SURVEILLES, NOMS_FOURNISSEURS, assainirConfig, lireConfig, lireEtats, fournisseurSurveille,
  magasinAppSettings, verifierFournisseur, type FournisseurId,
} from '@/lib/fournisseurs/sante';
import { PREFIXE_ATTENTE } from '@/lib/avatar/attente-fournisseur';
import { economieParMois } from '@/lib/fournisseurs/economie';

export const dynamic = 'force-dynamic';

const PAS_DE_CACHE = { 'Cache-Control': 'private, no-store' };

function estFournisseur(v: unknown): v is FournisseurId {
  return typeof v === 'string' && (FOURNISSEURS_SURVEILLES as readonly string[]).includes(v);
}

export async function GET() {
  const { error: adminError } = await requireAdmin();
  if (adminError) return adminError as NextResponse;

  const [config, etats, alertes] = await Promise.all([lireConfig(), lireEtats(), getAllAlerts().catch(() => [])]);

  const { count: enAttente } = await supabaseAdmin
    .from('avatar_generations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .is('provider_video_id', null)
    .like('provider_error', `${PREFIXE_ATTENTE}%`);

  // Économie : 6 derniers mois de générations d'avatar (coût mesuré seulement).
  const depuis = new Date();
  depuis.setUTCMonth(depuis.getUTCMonth() - 5, 1);
  depuis.setUTCHours(0, 0, 0, 0);
  const { data: gens, error: erreurGens } = await supabaseAdmin
    .from('avatar_generations')
    .select('provider, status, provider_cost_eur, studiio_price_eur, admin_usage, created_at, engine, duration_seconds, user_avatar_id')
    .gte('created_at', depuis.toISOString())
    .limit(5000);
  // Type d'avatar (photo / Digital Twin) : il fixe le tarif HeyGen du moteur.
  const idsAvatars = [...new Set(((gens ?? []) as Array<{ user_avatar_id?: string | null }>).map((g) => g.user_avatar_id).filter((v): v is string => !!v))];
  const { data: avatars } = idsAvatars.length
    ? await supabaseAdmin.from('user_avatars').select('id, avatar_type').in('id', idsAvatars)
    : { data: [] as Array<{ id: string; avatar_type: string | null }> };
  const typeParAvatar = new Map(((avatars ?? []) as Array<{ id: string; avatar_type: string | null }>).map((a) => [a.id, a.avatar_type]));
  const gensTypees = ((gens ?? []) as Array<Record<string, unknown>>).map((g) => ({ ...g, avatar_type: typeParAvatar.get(String(g.user_avatar_id)) ?? null }));

  return NextResponse.json({
    success: true,
    data: {
      fournisseurs: FOURNISSEURS_SURVEILLES.map((id) => ({
        id,
        nom: NOMS_FOURNISSEURS[id],
        capacites: CAPACITES[id],
        config: config[id],
        surveille: fournisseurSurveille(id),
        // Sans flux actif, l'écran dit « inactif » au lieu d'un dernier solde périmé.
        etat: fournisseurSurveille(id) ? etats[id] : { ...etats[id], statut: 'inactif' as const },
        alertes: alertes.filter((a) => a.service === id).slice(0, 10),
      })),
      generationsEnAttente: enAttente ?? 0,
      economie: erreurGens ? { erreur: erreurGens.message } : economieParMois(gensTypees),
    },
  }, { headers: PAS_DE_CACHE });
}

export async function PATCH(req: NextRequest) {
  const { error: adminError, session } = await requireAdmin();
  if (adminError) return adminError as NextResponse;
  const corps = await req.json().catch(() => null) as { fournisseur?: unknown; config?: unknown } | null;
  if (!estFournisseur(corps?.fournisseur) || !corps?.config || typeof corps.config !== 'object') {
    return NextResponse.json({ success: false, error: 'Fournisseur ou configuration invalide.' }, { status: 400 });
  }
  const id = corps.fournisseur;
  const tous = await lireConfig();
  tous[id] = assainirConfig({ ...tous[id], ...(corps.config as Record<string, unknown>) }, id);
  await magasinAppSettings.ecrire(CLE_CONFIG, tous);
  await logAdminAction({
    adminEmail: session?.user?.email ?? 'inconnu',
    action: 'fournisseur_config',
    targetType: 'provider',
    targetId: id,
    details: tous[id] as unknown as Record<string, unknown>,
  }).catch(() => {});
  return NextResponse.json({ success: true, data: { config: tous[id] } }, { headers: PAS_DE_CACHE });
}

export async function POST(req: NextRequest) {
  const { error: adminError } = await requireAdmin();
  if (adminError) return adminError as NextResponse;
  const corps = await req.json().catch(() => null) as { fournisseur?: unknown; action?: unknown } | null;
  if (!estFournisseur(corps?.fournisseur) || corps?.action !== 'verifier') {
    return NextResponse.json({ success: false, error: 'Action invalide.' }, { status: 400 });
  }
  const etat = await verifierFournisseur(corps.fournisseur);
  return NextResponse.json({ success: true, data: { etat, enCours: etat === null } }, { headers: PAS_DE_CACHE });
}
