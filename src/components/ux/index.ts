/**
 * Le socle UX commun de Studiio (cahier `tasks/ux-unifiee-creer-autopilote-avatar.md`).
 * Six briques, une implémentation chacune — à brancher dans Créer, Autopilote
 * et Mon avatar par les chantiers suivants. Aucune logique métier ici.
 */
export { default as Notification } from './Notification';
export type { NotificationProps, NiveauNotification, ActionNotification } from './Notification';
export { default as ProgressStatus, formaterDuree, pourcentageWorkflow } from './ProgressStatus';
export type { ProgressStatusProps, StatutProgression, EtapeProgression, ActionProgression } from './ProgressStatus';
export { default as FilEtapes } from './FilEtapes';
export type { FilEtapesProps, Etape, EtatEtape } from './FilEtapes';
export { default as Consigne } from './Consigne';
export type { ConsigneProps, PointChecklist } from './Consigne';
export { default as ZoneApercu } from './ZoneApercu';
export type { ZoneApercuProps, EtatApercu, ActionApercu } from './ZoneApercu';
export { default as EnteteSection } from './EnteteSection';
export { default as DeuxColonnes, ColonneTravail, ColonneApercu } from './DeuxColonnes';
export type { DeuxColonnesProps } from './DeuxColonnes';
export type { EnteteSectionProps, NiveauStatut } from './EnteteSection';
