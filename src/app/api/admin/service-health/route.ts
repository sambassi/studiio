import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import {
  getActiveAlerts,
  getAllAlerts,
  dismissServiceAlert,
  dismissServiceAlerts,
  ServiceName,
} from '@/lib/service-alerts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/service-health
 * Returns active service alerts for admin banner display.
 * Query param ?all=true to include dismissed alerts.
 */
export async function GET(req: NextRequest) {
  try {
    const { error: adminError } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const showAll = req.nextUrl.searchParams.get('all') === 'true';
    const alerts = showAll ? await getAllAlerts() : await getActiveAlerts();

    return NextResponse.json({
      success: true,
      alerts,
      hasActiveAlerts: alerts.some((a) => !a.dismissed),
      criticalCount: alerts.filter((a) => !a.dismissed && a.severity === 'critical').length,
      warningCount: alerts.filter((a) => !a.dismissed && a.severity === 'warning').length,
    });
  } catch (error) {
    console.error('[ServiceHealth] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Erreur lors de la vérification des services' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/service-health
 * Dismiss an alert or all alerts for a service.
 * Body: { action: "dismiss", alertId: "..." }
 *   or: { action: "dismiss-service", service: "replicate" }
 */
export async function POST(req: NextRequest) {
  try {
    const { error: adminError } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const { action, alertId, service } = await req.json();

    if (action === 'dismiss' && alertId) {
      await dismissServiceAlert(alertId);
      return NextResponse.json({ success: true, message: 'Alerte masquée' });
    }

    if (action === 'dismiss-service' && service) {
      await dismissServiceAlerts(service as ServiceName);
      return NextResponse.json({ success: true, message: `Alertes ${service} masquées` });
    }

    return NextResponse.json(
      { success: false, error: 'Action invalide' },
      { status: 400 },
    );
  } catch (error) {
    console.error('[ServiceHealth] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Erreur lors du traitement' },
      { status: 500 },
    );
  }
}
