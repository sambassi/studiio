import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { listNotifications, markRead, notificationStoreReady } from '@/lib/notifications/store';

/**
 * Notifications de l'utilisateur — ce que lit la cloche du tableau de bord.
 *
 * `GET` rend les plus récentes et le nombre de non-lues. `PATCH` marque comme
 * lues, toutes ou celles listées.
 *
 * ⚠️ NI L'UN NI L'AUTRE NE PEUT ÉCHOUER BRUYAMMENT. Une cloche est un
 * ornement du cadre : tant que la migration n'est pas appliquée — ou si la
 * base est indisponible — l'écran doit afficher zéro notification, pas une
 * erreur qui casserait toute la barre de navigation.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await notificationStoreReady())) {
      return NextResponse.json({ success: true, ready: false, unread: 0, notifications: [] });
    }
    const notifications = await listNotifications(session.user.id);
    return NextResponse.json({
      success: true,
      ready: true,
      unread: notifications.filter((n) => !n.readAt).length,
      notifications,
    });
  } catch (err) {
    console.error('[Notifications] lecture :', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: true, ready: false, unread: 0, notifications: [] });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const corps = await req.json().catch(() => ({})) as { ids?: unknown };
    // Sans identifiants, on marque TOUT : c'est le geste « j'ai vu » du clic
    // sur la cloche. Avec, on ne marque que ceux-là.
    const ids = Array.isArray(corps.ids)
      ? corps.ids.filter((v): v is string => typeof v === 'string' && !!v)
      : undefined;
    const ok = await markRead(session.user.id, ids);
    return NextResponse.json({ success: ok });
  } catch (err) {
    console.error('[Notifications] marquage :', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
