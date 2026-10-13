/**
 * #562 — COÛT FOURNISSEUR AVANT TOUTE OPÉRATION PAYANTE (admin).
 *
 * Le devis (pur), la fenêtre de confirmation, le rejeu côté navigateur, et le
 * budget de l'Autopilote. Aucun appel HeyGen : les « appels fournisseur »
 * sont des doublures comptées.
 *
 * Les routes (428 avant tout appel, 1 appel après confirmation, verrou des
 * requêtes concurrentes) sont prouvées dans facturation-admin-exemption.test.ts
 * (Mon avatar) et moteur-jumeau.test.ts (Créer / relance).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, fireEvent, cleanup } from '@testing-library/react';
import {
  devisVideoHeygen, devisCreationAvatar, dureeParoleEstimee, budgetAutopilote, lignesDevis,
  libelleContinuer, libelleCoutUsd, lignesBudgetAutopilote, MESSAGE_PRIX_INCONNU, MESSAGE_AUCUN_APPEL,
} from '@/lib/fournisseurs/devis-fournisseur';
import { avecConfirmationCout, confirmerCreationAvatar, CHAMP_CONFIRMATION_COUT } from '@/lib/fournisseurs/confirmation-client';
import { ConfirmationCoutFournisseur } from '@/components/fournisseurs/ConfirmationCoutFournisseur';

const S = (n: number) => ({ min: n, max: n });

describe('A / B — le coût suit le moteur RÉEL et la durée', () => {
  it('A. Avatar III, Digital Twin, 30 s → 0,30 $ (0,01 $/s)', () => {
    const d = devisVideoHeygen({ operation: 'video_avatar', moteurEnvoye: 'avatar_iii', avatarType: 'video', dureeSecondes: S(30) });
    expect(d).toMatchObject({ moteur: 'avatar_iii', typeAvatar: 'twin', tarifUsdParSeconde: 0.01, coutUsd: { min: 0.3, max: 0.3 }, prixConnu: true });
    expect(libelleCoutUsd(d.coutUsd)).toBe('≈ 0,30 $');
  });

  it('A bis. 47 s en Avatar III → ≈ 0,47 $ ; plage 42–48 s → 0,42–0,48 $', () => {
    expect(devisVideoHeygen({ operation: 'video_avatar', moteurEnvoye: 'avatar_iii', avatarType: 'video', dureeSecondes: S(47) }).coutUsd).toEqual({ min: 0.47, max: 0.47 });
    const plage = devisVideoHeygen({ operation: 'video_avatar', moteurEnvoye: 'avatar_iii', avatarType: 'video', dureeSecondes: { min: 42, max: 48 } });
    expect(libelleCoutUsd(plage.coutUsd)).toBe('≈ 0,42–0,48 $');
  });

  it('B. Avatar IV : 5 s Digital Twin = 0,40 $ ; 5 s photo = 0,19 $ — jamais le tarif du mauvais moteur', () => {
    expect(devisVideoHeygen({ operation: 'video_avatar', moteurEnvoye: 'avatar_iv', avatarType: 'video', dureeSecondes: S(5) }).coutUsd).toEqual({ min: 0.4, max: 0.4 });
    expect(devisVideoHeygen({ operation: 'video_avatar', moteurEnvoye: 'avatar_iv', avatarType: 'photo', dureeSecondes: S(5) }).coutUsd).toEqual({ min: 0.19, max: 0.19 });
    // Avatar III connu : PAS le prix d'Avatar IV.
    expect(devisVideoHeygen({ operation: 'video_avatar', moteurEnvoye: 'avatar_iii', avatarType: 'video', dureeSecondes: S(5) }).coutUsd).toEqual({ min: 0.05, max: 0.05 });
  });

  it('B bis. aucun moteur envoyé → HeyGen applique Avatar IV : dit tel quel', () => {
    const d = devisVideoHeygen({ operation: 'apercu_avatar', moteurEnvoye: null, avatarType: 'video', dureeSecondes: S(5) });
    expect(d).toMatchObject({ moteur: 'avatar_iv', moteurImplicite: true });
    expect(lignesDevis(d).find((l) => l.libelle === 'Moteur')!.valeur).toContain('défaut HeyGen');
  });

  it('durée estimée du texte : une PLAGE (≈ 2,6 mots/s ± 15 %), au moins 3 s ; texte vide → inconnue', () => {
    const d = dureeParoleEstimee(['un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize dix-sept dix-huit dix-neuf vingt vingt-et-un vingt-deux vingt-trois vingt-quatre vingt-cinq vingt-six']);
    expect(d).toEqual({ min: 8, max: 12 });
    expect(dureeParoleEstimee(['Bonjour.'])).toEqual({ min: 2, max: 4 });
    expect(dureeParoleEstimee(['  '])).toBeNull();
  });
});

describe('C / D — jamais un prix inventé', () => {
  it('C. moteur inconnu → prix INCONNU, aucun montant affiché', () => {
    const d = devisVideoHeygen({ operation: 'video_avatar', moteurEnvoye: 'avatar_x', avatarType: 'video', dureeSecondes: S(30) });
    expect(d).toMatchObject({ prixConnu: false, coutUsd: null, tarifUsdParSeconde: null });
    expect(d.avertissement).toContain(MESSAGE_PRIX_INCONNU);
    const cout = lignesDevis(d).find((l) => l.libelle === 'Coût fournisseur estimé')!.valeur;
    expect(cout).toBe('montant exact non disponible');
    expect(cout).not.toMatch(/\d/);
    expect(libelleContinuer(d, false)).toBe('Continuer malgré le coût fournisseur inconnu');
  });

  it('C bis. durée inconnue → prix INCONNU (pas de repli sur une durée imaginaire)', () => {
    const d = devisVideoHeygen({ operation: 'video_avatar', moteurEnvoye: 'avatar_iii', avatarType: 'video', dureeSecondes: null });
    expect(d).toMatchObject({ prixConnu: false, coutUsd: null });
  });

  it('D. création Digital Twin : montant NON publié → avertissement explicite, aucun chiffre, bouton qui le dit', () => {
    const d = devisCreationAvatar({ avatarType: 'video', creditsStudiio: 0 });
    expect(d).toMatchObject({ operation: 'creation_avatar', prixConnu: false, coutUsd: null, avertissement: MESSAGE_PRIX_INCONNU });
    expect(MESSAGE_PRIX_INCONNU).toBe('Coût fournisseur : montant exact non disponible. Cette opération peut être facturée par HeyGen.');
    expect(libelleContinuer(d, false)).toBe('Créer l’avatar malgré le coût fournisseur variable');
    expect(libelleContinuer(d, true)).toBe('Créer une nouvelle version — coût fournisseur possible');
  });

  it('E. admin : « Crédits Studiio débités : 0 » ET le coût fournisseur, côte à côte', () => {
    const d = devisVideoHeygen({ operation: 'video_avatar', moteurEnvoye: 'avatar_iii', avatarType: 'video', dureeSecondes: S(47), creditsStudiio: 0 });
    const l = Object.fromEntries(lignesDevis(d).map((x) => [x.libelle, x.valeur]));
    expect(l['Crédits Studiio débités']).toBe('0');
    expect(l['Coût fournisseur estimé']).toBe('≈ 0,47 $');
    expect(l['Moteur']).toBe('Avatar III');
    expect(l['Durée estimée']).toContain('47 s');
    expect(l['Source du tarif']).toContain('help.heygen.com');
  });
});

describe('F / G / H — le navigateur ne rejoue qu’après « Continuer », une seule fois', () => {
  const devis = devisVideoHeygen({ operation: 'video_avatar', moteurEnvoye: 'avatar_iii', avatarType: 'video', dureeSecondes: S(30), creditsStudiio: 0 });
  /** Doublure du serveur : 428 sans confirmation ; « appel fournisseur » compté avec. */
  const serveur = () => {
    const appelsFournisseur: number[] = [];
    const envoyer = vi.fn(async (confirme: boolean) => {
      if (!confirme) return new Response(JSON.stringify({ success: false, code: 'confirmation_cout_fournisseur', devis }), { status: 428 });
      appelsFournisseur.push(1);
      return new Response(JSON.stringify({ success: true, data: { generationId: 'g1' } }), { status: 200 });
    });
    return { envoyer, appelsFournisseur };
  };

  it('F. Annuler → 0 appel fournisseur, la requête confirmée ne part jamais', async () => {
    const s = serveur();
    const issue = await avecConfirmationCout(s.envoyer, { confirmer: async () => 'annuler' });
    expect(issue).toEqual({ annule: true, choix: 'annuler' });
    expect(s.envoyer).toHaveBeenCalledTimes(1);
    expect(s.envoyer).toHaveBeenCalledWith(false);
    expect(s.appelsFournisseur).toHaveLength(0);
  });

  it('G. Continuer → exactement 1 appel fournisseur (doublure)', async () => {
    const s = serveur();
    const vu: unknown[] = [];
    const issue = await avecConfirmationCout(s.envoyer, { confirmer: async (d) => { vu.push(d); return 'continuer'; } });
    expect(vu).toEqual([devis]);
    expect(issue).toMatchObject({ annule: false, status: 200 });
    expect(s.appelsFournisseur).toHaveLength(1);
  });

  it('H. double clic AVANT/après la confirmation (même opération) → 1 seul appel', async () => {
    const s = serveur();
    let ouvrir!: (c: 'continuer') => void;
    const confirmer = () => new Promise<'continuer'>((r) => { ouvrir = r; });
    const premier = avecConfirmationCout(s.envoyer, { cle: 'test:op', confirmer });
    const second = await avecConfirmationCout(s.envoyer, { cle: 'test:op', confirmer });
    expect(second).toEqual({ annule: true, choix: 'deja_en_cours' });
    await new Promise((r) => setTimeout(r, 0));
    ouvrir('continuer');
    await premier;
    expect(s.appelsFournisseur).toHaveLength(1);
    // L'opération terminée libère la clé.
    await avecConfirmationCout(s.envoyer, { cle: 'test:op', confirmer: async () => 'annuler' });
    expect(s.appelsFournisseur).toHaveLength(1);
  });

  it('H bis. la fenêtre : un double clic sur « Continuer » ne rend qu’UN choix', () => {
    const onChoix = vi.fn();
    const { container } = render(<ConfirmationCoutFournisseur devis={devis} contexte={{}} onChoix={onChoix} />);
    const continuer = container.ownerDocument.querySelector('[data-choix="continuer"]') as HTMLButtonElement;
    expect(continuer.textContent).toBe('Continuer — coût estimé ≈ 0,30 $');
    fireEvent.click(continuer);
    fireEvent.click(continuer);
    expect(onChoix).toHaveBeenCalledTimes(1);
    expect(onChoix).toHaveBeenCalledWith('continuer');
    cleanup();
  });

  it('la fenêtre montre fournisseur, moteur, durée, tarif, coût, crédits Studiio et source', () => {
    const { container } = render(<ConfirmationCoutFournisseur devis={devis} contexte={{}} onChoix={() => {}} />);
    const doc = container.ownerDocument;
    const ligne = (l: string) => doc.querySelector(`[data-ligne="${l}"]`)?.textContent;
    expect(ligne('Fournisseur')).toBe('HeyGen');
    expect(ligne('Moteur')).toBe('Avatar III');
    expect(ligne('Durée estimée')).toBe('30 s (estimée depuis le texte)');
    expect(ligne('Tarif')).toBe('0,01 $ / seconde');
    expect(ligne('Coût fournisseur estimé')).toBe('≈ 0,30 $');
    expect(ligne('Crédits Studiio débités')).toBe('0');
    expect(doc.body.textContent).toContain('facturée directement sur le wallet HeyGen');
    cleanup();
  });

  it('D bis. création avec un avatar déjà prêt : « Utiliser l’existant » ne crée rien', async () => {
    const onChoix = vi.fn();
    const { container } = render(<ConfirmationCoutFournisseur
      devis={devisCreationAvatar({ avatarType: 'video', creditsStudiio: 0 })}
      contexte={{ avatarExistant: { id: 'a1', nom: 'Mon avatar vidéo', version: 6 } }}
      onChoix={onChoix}
    />);
    const doc = container.ownerDocument;
    expect(doc.querySelector('[data-avatar-existant]')?.textContent).toContain('Un avatar existant est déjà disponible');
    expect(doc.querySelector('[data-avertissement]')?.textContent).toContain('montant exact non disponible');
    expect(doc.querySelector('[data-choix="continuer"]')?.textContent).toBe('Créer une nouvelle version — coût fournisseur possible');
    fireEvent.click(doc.querySelector('[data-choix="existant"]')!);
    expect(onChoix).toHaveBeenCalledWith('existant');
    cleanup();
  });

  it('D ter. création : le devis est LU avant l’envoi du fichier ; annuler → l’envoi n’a pas lieu', async () => {
    const appels: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      appels.push(url);
      return new Response(JSON.stringify({ success: false, code: 'confirmation_cout_fournisseur', devis: devisCreationAvatar({ avatarType: 'video', creditsStudiio: 0 }), avatarExistant: null }), { status: 428 });
    }) as unknown as typeof fetch;
    const vus: unknown[] = [];
    const choix = await confirmerCreationAvatar({ type: 'video', fetchImpl, confirmer: async (d, c) => { vus.push([d.operation, c.avatarExistant]); return 'annuler'; } });
    expect(choix).toBe('annuler');
    expect(appels).toEqual(['/api/avatar/devis-creation?type=video']);
    expect(vus).toEqual([['creation_avatar', null]]);
    // Compte non admin : rien à confirmer, l'envoi se fait comme avant.
    const nonAdmin = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { confirmationRequise: false } }), { status: 200 })) as unknown as typeof fetch;
    expect(await confirmerCreationAvatar({ type: 'photo', fetchImpl: nonAdmin })).toBe('non_requis');
  });

  it('le champ de confirmation est le même des deux côtés', () => {
    expect(CHAMP_CONFIRMATION_COUT).toBe('confirmationCoutFournisseur');
  });
});

describe('I / J — relance : locale (aucun appel) ou nouvelle vidéo (coût d’abord)', () => {
  const wizard = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf8');
  it('I. « Reprendre le suivi » = lecture de statut seulement, et l’admin lit « Aucun nouvel appel vidéo fournisseur prévu »', () => {
    expect(MESSAGE_AUCUN_APPEL).toBe('Aucun nouvel appel vidéo fournisseur prévu.');
    expect(wizard).toContain("{jumeauRepriseErreur?.reprendreId ? MESSAGE_AUCUN_APPEL : 'Réessayer lance une NOUVELLE vidéo HeyGen : son coût sera affiché avant l’envoi.'}");
    const reprise = wizard.slice(wizard.indexOf('const reprendreJumeau = '), wizard.indexOf('const reprendreJumeauRef'));
    expect(reprise).toContain('attendreStatutJumeau(');
    expect(reprise).not.toContain('genererEtAttendreVideoJumeau(');
  });
  it('J. « Réessayer » = nouvelle vidéo : passe par la confirmation, marquée relance', () => {
    const relance = wizard.slice(wizard.indexOf('const relancerJumeau = '), wizard.indexOf('const theme = THEMES'));
    expect(relance).toContain('genererEtAttendreVideoJumeau(');
    expect(relance).toContain('relance: true');
    expect(relance).toContain('e instanceof LancementAnnule');
  });
});

describe('K — budget Autopilote (estimation admin, jamais un prélèvement)', () => {
  const parVideo = (usd: number) => ({ ...devisVideoHeygen({ operation: 'video_autopilote', moteurEnvoye: 'avatar_iii', avatarType: 'video', dureeSecondes: S(12) }), coutUsd: { min: usd, max: usd } });

  it('2 vidéos / jour à ≈ 0,12 $ → ≈ 0,24 $ / jour, ≈ 7,20 $ / mois', () => {
    const b = budgetAutopilote({ avatarUtilise: true, countPerCycle: 2, cadence: 'daily', devisParVideo: parVideo(0.12) });
    expect(b).toMatchObject({ videosParJour: 2, coutParVideoUsd: { min: 0.12, max: 0.12 }, coutJournalierUsd: { min: 0.24, max: 0.24 }, coutMensuelUsd: { min: 7.2, max: 7.2 }, prixConnu: true });
  });

  it('cadence tous les 2 jours / hebdomadaire : vidéos par jour proratisées', () => {
    expect(budgetAutopilote({ avatarUtilise: true, countPerCycle: 2, cadence: 'every_2_days', devisParVideo: parVideo(0.12) }).coutMensuelUsd).toEqual({ min: 3.6, max: 3.6 });
    expect(budgetAutopilote({ avatarUtilise: true, countPerCycle: 7, cadence: 'weekly', devisParVideo: parVideo(0.1) }).coutJournalierUsd).toEqual({ min: 0.1, max: 0.1 });
  });

  it('sans avatar : 0 $ chez HeyGen ; avatar sans devis : montant inconnu, pas de zéro', () => {
    expect(budgetAutopilote({ avatarUtilise: false, countPerCycle: 2, cadence: 'daily', devisParVideo: null }).coutMensuelUsd).toEqual({ min: 0, max: 0 });
    const inconnu = budgetAutopilote({ avatarUtilise: true, countPerCycle: 2, cadence: 'daily', devisParVideo: null });
    expect(inconnu).toMatchObject({ prixConnu: false, coutMensuelUsd: null });
    expect(lignesBudgetAutopilote(inconnu, null)[3]).toBe('Par mois (30 j) : montant exact non disponible');
  });

  it('les lignes lisibles : par vidéo (moteur, plage), par jour, par mois', () => {
    const d = devisVideoHeygen({ operation: 'video_autopilote', moteurEnvoye: 'avatar_iii', avatarType: 'video', dureeSecondes: { min: 3, max: 45 }, origineDuree: 'plage' });
    const b = budgetAutopilote({ avatarUtilise: true, countPerCycle: 1, cadence: 'daily', devisParVideo: d });
    expect(lignesBudgetAutopilote(b, d)).toEqual([
      'Par vidéo : ≈ 0,03–0,45 $ (HeyGen Avatar III, 3–45 s, plage prudente)',
      'Vidéos prévues : 1 / jour',
      'Par jour : ≈ 0,03–0,45 $',
      'Par mois (30 j) : ≈ 0,90–13,50 $',
    ]);
  });
});
