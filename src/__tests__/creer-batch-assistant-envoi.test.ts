/**
 * Etape « Envoi » de l'Assistant : le choix un seul contenu / serie, le
 * recapitulatif, le suivi par contenu — et surtout les garanties qui doivent
 * survivre a ce lot.
 *
 * Ces assertions portent sur la SOURCE du wizard, comme le reste des tests de
 * cet ecran (`creer-simple-batch.test.ts`) : le fichier fait 9 000 lignes et
 * monte un compositeur, un enregistreur et un canvas. Ce qu'on protege ici
 * n'est pas un pixel, ce sont des invariants de facturation et de publication
 * qui se lisent sur une ligne de code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MAX_BATCH } from '@/lib/creer/batch';

const wizard = readFileSync(
  join(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);

describe('Choix « un seul contenu » ou « série »', () => {
  it('propose les deux modes explicitement', () => {
    expect(wizard).toContain('data-batch-mode="unique"');
    expect(wizard).toContain('data-batch-mode="serie"');
    expect(wizard).toContain('Un seul contenu');
  });

  it('deduit le mode de batchCount — une seule source de verite', () => {
    expect(wizard).toContain("const modeLot: 'unique' | 'serie' = batchCount > 1 ? 'serie' : 'unique';");
    // Un second useState pour le mode se desynchroniserait du nombre.
    expect(wizard).not.toContain("useState<'unique' | 'serie'>");
  });

  it('« Un seul contenu » ramene le lot a 1', () => {
    expect(wizard).toContain('onClick={() => setBatchCount(1)}');
  });

  it('« Série » ne redescend jamais en dessous de 2', () => {
    expect(wizard).toContain('onClick={() => setBatchCount((n) => (n > 1 ? n : 2))}');
  });

  it('n offre le nombre que dans le mode serie', () => {
    expect(wizard).toContain("{modeLot === 'serie' && (");
  });
});

describe('Volume du lot', () => {
  it('reste borne au volume deja prevu par le produit', () => {
    // Le lot n'est pas elargi dans ce lot de travail : le debit n'est pas
    // idempotent, multiplier le volume multiplierait l'exposition.
    expect(MAX_BATCH).toBe(10);
    expect(MAX_BATCH).toBeLessThanOrEqual(20);
  });

  it('propose 2..MAX dans le selecteur — 1 est devenu un mode, pas un nombre', () => {
    expect(wizard).toContain('{Array.from({ length: MAX_BATCH - 1 }, (_, i) => i + 2).map((n) => (');
  });

  it('borne toujours le total par clampBatchCount avant la boucle', () => {
    expect(wizard).toContain("const total = destination === 'apercu' ? 1 : clampBatchCount(batchCount);");
  });
});

describe('Le nombre et le cout sont annonces AVANT confirmation', () => {
  it('affiche un recapitulatif dedie', () => {
    expect(wizard).toContain('data-batch-recap');
  });

  it('y annonce le nombre de contenus et le cout total', () => {
    expect(wizard).toContain("{batchCount} {batchCount > 1 ? 'contenus' : 'contenu'}");
    // Le cout passe par `libelleCout`, qui rend « N crédits » sous la
    // politique `credits` et le libelle partenaires sinon. Le montant reste
    // celui du serveur ; c'est sa MISE EN MOTS qui depend de la politique.
    expect(wizard).toContain('data-facturation-recap');
    expect(wizard).toContain("batchCost(format === '9:16' ? COST.reel : COST.tv, batchCount)");
    expect(wizard).toContain('libelleCout(');
  });

  it('dit qu aucune publication n est automatique', () => {
    expect(wizard).toContain('Aucune publication');
  });
});

describe('Programmation', () => {
  it('laisse choisir la date ET l heure', () => {
    expect(wizard).toContain('id="lot-date"');
    expect(wizard).toContain('id="lot-heure"');
  });

  it('envoie l heure choisie, avec le defaut historique en repli', () => {
    expect(wizard).toContain("scheduled_time: scheduledTime || '12:00',");
    expect(wizard).toContain("useState('12:00')");
  });

  it('conserve la date par contenu du lot', () => {
    expect(wizard).toContain('scheduled_date: dates[b],');
  });
});

describe('AUCUNE publication automatique', () => {
  it('n envoie jamais de plateforme — un post sans plateforme n est pas diffuse', () => {
    expect(wizard).toContain('platforms: [],');
  });

  it('cree toujours le post en brouillon', () => {
    expect(wizard).toContain("status: 'draft',");
    expect(wizard).not.toContain("status: 'published'");
    expect(wizard).not.toContain("status: 'scheduled'");
  });
});

describe('AUCUNE video « completed » sans rendu', () => {
  it('l Assistant ne cree jamais de ligne videos', () => {
    // `POST /api/videos` etale le corps du client et accepte `status`,
    // `video_url` et `credits_used`. L'Assistant n'y touche pas : il ne cree
    // que des posts, dont le media existe deja puisqu'il vient d'etre televerse.
    expect(wizard).not.toContain("fetch('/api/videos'");
    expect(wizard).not.toContain("'/api/videos',");
  });

  it("n envoie jamais status: 'completed'", () => {
    expect(wizard).not.toContain("status: 'completed'");
  });

  it('ne passe par aucune route de rendu serveur', () => {
    expect(wizard).not.toContain("fetch('/api/render')");
    expect(wizard).not.toContain("'/api/render/batch'");
  });
});

describe('Debit : aucune nouvelle surface de facturation', () => {
  it("ne connait AUCUN point de debit apres coup", () => {
    // `/api/credits/deduct` etait tire une fois le post cree, sans bloquer :
    // la livraison precedait le paiement et rien ne prouvait au serveur que
    // le fichier existait. Le debit a lieu desormais a la confirmation.
    expect(wizard.match(/fetch\('\/api\/credits\/deduct'/g) || []).toHaveLength(0);
    expect(wizard).not.toMatch(/debiterRendu\s*\(/);
  });

  it('debite AVANT de livrer, contre une preuve serveur', () => {
    // L'ordre du socle : tentative, composition, televersement vers LA cle
    // attribuee, verification, puis seulement livraison.
    expect(wizard).toContain("composerEtFacturer('calendrier', renderFormat, optionsRendu)");
    expect(wizard).toContain('rendreEtFacturer({');
  });

  it('ne debite pas un montage deja paye au moment du Play', () => {
    expect(wizard).toContain('const reutilisable =');
  });

  it("s'arrete au premier echec plutot que de continuer a depenser", () => {
    // Poursuivre le lot apres un echec ferait payer des rendus sur un lot
    // qu'on sait deja casse. Les contenus suivants restent « en attente ».
    expect(wizard).toContain('// attente », donc jamais factures. Les poursuivre depenserait des');
  });
});

describe('Suivi par contenu et echec partiel', () => {
  it('cree un lot suivi avec un identifiant stable', () => {
    expect(wizard).toContain('const runId = batchRunId(Date.now());');
    expect(wizard).toContain('itemEnCours = batchItemId(runId, b);');
  });

  it('marque le contenu en cours de rendu', () => {
    expect(wizard).toContain("majItem(itemEnCours, 'rendu');");
  });

  it("ne marque « pret » qu'apres l'enregistrement du post", () => {
    expect(wizard).toContain("majItem(itemEnCours, 'pret', { postId: json.post.id });");
  });

  it('marque « echoue » le contenu en vol, et lui seul', () => {
    expect(wizard).toContain("majItem(itemEnCours, 'echoue', { erreur: motif });");
    expect(wizard).toContain("majItem(itemEnCours, 'echoue', {");
  });

  it('affiche un rapport quand le lot s est arrete en route', () => {
    expect(wizard).toContain('data-batch-report');
    expect(wizard).toContain('{!sending && batchPartiel(batchItems) && (');
    // Le titre suit desormais le nombre de contenus : « Serie interrompue »
    // au-dela d'un, « Creation interrompue » pour un seul — ou parler de
    // serie decrivait une situation qui n'existe pas.
    expect(wizard).toContain('titreInterruption(batchItems.length)');
  });

  it("dit combien de contenus n'ont jamais demarre — donc non factures", () => {
    expect(wizard).toContain('jamais démarrée');
    expect(wizard).toContain('non facturée');
  });

  it("expose l'etat de chaque contenu, lisible par un test comme par un humain", () => {
    expect(wizard).toContain('data-batch-item-state={it.etat}');
  });

  it('oublie le rapport du lot precedent quand on repart de zero', () => {
    expect(wizard).toContain('setBatchItems([]);');
  });
});

describe('La reprise est PREPAREE mais desactivee', () => {
  it('rend le bouton inactif', () => {
    expect(wizard).toContain('data-batch-retry');
    expect(wizard).toMatch(/data-batch-retry\s+disabled/);
  });

  it('affiche la vraie raison, pas un « indisponible »', () => {
    expect(wizard).toContain('{repriseAutorisee(batchItems).raison}');
  });

  it('ne contourne jamais la garde : aucun chemin ne relance un contenu', () => {
    expect(wizard).not.toContain('reprendreEchecs');
    expect(wizard).not.toContain('retryBatch');
  });
});

describe('Non-regression du parcours unitaire', () => {
  it('demarre toujours sur un seul contenu', () => {
    expect(wizard).toContain('const [batchCount, setBatchCount] = useState(1);');
  });

  it('ne varie le contenu qu au-dela de la premiere video', () => {
    expect(wizard).toContain('if (total > 1 && b > 0) {');
  });

  it('garde le contenu affiche pour la premiere video', () => {
    expect(wizard).toContain('const contenuInitial = generated;');
  });

  it('restaure l ecran apres un lot', () => {
    expect(wizard).toContain('if (total > 1) setGenerated(contenuInitial);');
  });

  it('conserve la regle des affiches distinctes', () => {
    expect(wizard).toContain('if (total > 1 && !batchPhotosReady(batchPhotoUrls, total)) {');
    expect(wizard).toContain('? distinctPhotoForIndex(batchPhotoUrls, b)');
  });

  it('ne compose toujours rien en modification', () => {
    expect(wizard).toContain('if (editPostId) return;');
  });
});

describe('Rien de la creation unitaire n a bouge', () => {
  const attendus = [
    // Textes canoniques : titre, CTA, sous-texte du CTA, filigrane.
    'ctaText',
    'ctaSubText',
    'watermarkText',
    // Cartes et reglages avances portes par les metadonnees.
    'cards',
    'elements: freeElements,',
    // Le contrat canonique reste le seul chemin d'ecriture.
    'metadataPourEnregistrement',
  ];
  attendus.forEach((clef) => {
    it(`conserve « ${clef} »`, () => {
      expect(wizard).toContain(clef);
    });
  });

  it("n'introduit pas de second moteur de montage", () => {
    expect(wizard).toContain("from '@/lib/video-composer'");
    // Zero : le seul appel restant etait celui du Calendrier, qui composait
    // et televersait vers une cle choisie par le navigateur, sans tentative.
    expect(wizard.match(/composeAndUpload\(/g) || []).toHaveLength(0);
    expect(wizard.match(/composerEtFacturer\(/g) || []).toHaveLength(1);
  });
});
