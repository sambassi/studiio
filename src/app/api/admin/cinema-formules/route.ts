/**
 * /api/admin/cinema-formules — ADMIN uniquement.
 *
 * GET : chaque formule existante (`plans`) avec ce qu'elle inclut de Cinema IA. Le prix
 *       CHF est rendu EN LECTURE pour comparaison : il se modifie dans Tarification.
 * PUT : enregistre ce qu'UNE formule inclut. N'ecrit que `cinema_formules` — jamais
 *       `plans`, jamais Stripe. Aucun prix ni abonnement n'est touche.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { getPlans } from '@/lib/pricing/fetch';
import { validerFormule, formuleNonIncluse } from '@/lib/cinema/abonnement/formules';
import { lireFormules, enregistrerFormule } from '@/lib/cinema/abonnement/depot';

export const dynamic = 'force-dynamic';
const SANS_CACHE = { 'Cache-Control': 'private, no-store' };

interface PlanLu { key: string; name?: string; price_cents?: number }

export async function GET() {
  const garde = await requireAdmin();
  if (garde.error) return garde.error;

  const plans = (await getPlans()) as PlanLu[];
  const lecture = await lireFormules();
  const formules = lecture.disponible ? lecture.formules : new Map();

  return NextResponse.json({
    success: true,
    data: {
      migrationAppliquee: lecture.disponible,
      ...(lecture.disponible ? { invalides: lecture.invalides } : { message: lecture.message }),
      formules: plans.map((p) => ({
        planKey: p.key,
        nom: p.name ?? p.key,
        prixMensuelCentimes: typeof p.price_cents === 'number' ? p.price_cents : null,
        configuree: formules.has(p.key),
        formule: formules.get(p.key) ?? formuleNonIncluse(p.key),
      })),
    },
  }, { headers: SANS_CACHE });
}

export async function PUT(req: NextRequest) {
  const garde = await requireAdmin();
  if (garde.error) return garde.error;

  const corps = await req.json().catch(() => null);
  const v = validerFormule(corps);
  if (!v.ok) return NextResponse.json({ success: false, erreurs: v.erreurs }, { status: 400, headers: SANS_CACHE });

  const plans = (await getPlans()) as PlanLu[];
  if (!plans.some((p) => p.key === v.formule.planKey)) {
    return NextResponse.json({ success: false, erreurs: ['formule inconnue'] }, { status: 400, headers: SANS_CACHE });
  }

  const ecrit = await enregistrerFormule(v.formule, garde.session!.user!.email!);
  if (!ecrit.ok) {
    return NextResponse.json(
      { success: false, erreurs: [ecrit.message] },
      { status: ecrit.raison === 'migration_absente' ? 503 : 500, headers: SANS_CACHE },
    );
  }
  await logAdminAction({
    adminEmail: garde.session!.user!.email!, action: 'cinema.formule', targetType: 'plan',
    targetId: v.formule.planKey, details: { ...v.formule },
  });
  return NextResponse.json({ success: true, formule: v.formule }, { headers: SANS_CACHE });
}
