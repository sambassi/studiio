/**
 * LEGACY /dashboard/infographie route.
 *
 * The page was renamed to /dashboard/creer. This redirect keeps existing
 * bookmarks and external links working.
 *
 * TODO: delete this file once we've confirmed no bookmarks rely on it
 * (~2 weeks after deploy).
 */
import { redirect } from 'next/navigation';

export default function InfographieLegacyRedirect() {
  redirect('/dashboard/creer');
}
