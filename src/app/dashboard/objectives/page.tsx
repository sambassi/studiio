import { redirect } from 'next/navigation';

export default function ObjectivesLegacyRedirect() {
  redirect('/dashboard/settings?tab=contenu');
}
