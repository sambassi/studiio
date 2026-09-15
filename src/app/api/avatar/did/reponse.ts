import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import type { ResultatDid } from '@/lib/avatar/did';

/** La session, ou la réponse 401 — le même garde pour toutes les routes D-ID. */
export async function compteCourant(): Promise<{ userId: string } | { reponse: NextResponse }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { reponse: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  }
  return { userId: session.user.id };
}

/** Un résultat du domaine → la réponse HTTP. Les refus portent leur statut et leur code ; rien d'autre ne sort. */
export function reponseDid<T extends object>(r: ResultatDid<T>): NextResponse {
  if (!r.ok) {
    return NextResponse.json({ success: false, error: r.message, code: r.motif }, { status: r.statut, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const { ok: _ok, ...data } = r as { ok: true } & T;
  void _ok;
  return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
