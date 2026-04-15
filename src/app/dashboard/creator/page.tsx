/**
 * LEGACY /dashboard/creator route.
 *
 * The unified "Créer" experience now lives at /dashboard/creer (formerly
 * /dashboard/infographie). This file exists only to redirect any existing
 * bookmark / external link that still points at the old URL.
 *
 * TODO: delete this file once we've confirmed no bookmarks rely on it
 * (~2 weeks after deploy).
 */
import { redirect } from 'next/navigation';

export default function CreatorLegacyRedirect() {
  redirect('/dashboard/creer');
}
