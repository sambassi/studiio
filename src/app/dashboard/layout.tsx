export const dynamic = 'force-dynamic';

import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { StudiioAssistant } from '@/components/chat/StudiioAssistant';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-studiio-dark">
      <Sidebar />
      <Navbar />
      {/* ⚠️ `pb-28` SUR TELEPHONE : TROIS BARRES FLOTTENT AU-DESSUS DU BAS.
          La banniere d'installation PWA (`fixed bottom-0`, z-50), le bouton
          de discussion (`bottom-4`, z-40) et la barre d'outils mobile de
          l'editeur avance (`fixed bottom-0`, z-40) se posent sur le contenu.
          Aucune page ne reservait d'espace : le dernier champ, le dernier
          bouton, la derniere ligne d'un formulaire finissaient dessous, sans
          moyen de les faire remonter. On rend cet espace au defilement, et on
          y ajoute l'encoche du bas des iPhone — que le produit ignorait
          partout jusqu'ici. Au-dessus de 1024 px, rien ne flotte : `lg:pb-8`
          rend le rembourrage d'origine. */}
      <main
        className="mt-16 lg:ml-64 p-4 lg:p-8 min-h-[calc(100vh-64px)]
          pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-8"
      >
        {children}
      </main>
      <StudiioAssistant />
    </div>
  );
}
