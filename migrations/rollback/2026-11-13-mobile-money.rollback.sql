-- Retour arriere de 2026-11-13-mobile-money.sql.
--
-- ⚠️ CE QUI EST SUPPRIME, ET CE QUI NE L'EST PAS.
--
-- La fonction et l'index partent. La TABLE `pawapay_depots` RESTE : elle
-- porte le journal des paiements, et un depot reussi dont le credit a ete
-- accorde doit rester tracable meme apres un retour arriere. La supprimer
-- effacerait la preuve d'un encaissement.
--
-- Les credits deja accordes ne sont PAS repris : ce sont des lignes
-- `credit_transactions` ordinaires, de type `purchase`, acceptees bien avant
-- cette migration.
--
-- Pour supprimer aussi la table — a ne faire que si AUCUN depot n'y figure —
-- la commande est donnee en commentaire a la fin, volontairement non active.
begin;

drop function if exists public.crediter_credits_mobile_money(uuid, integer, text, text, text);

-- L'index unique part avec la fonction : sans elle, plus rien n'ecrit de
-- reference `mm:%`. Le laisser serait sans effet, mais le retirer rend le
-- retour arriere complet et verifiable.
drop trigger if exists pawapay_depots_plafond on public.pawapay_depots;
drop function if exists public.pawapay_plafond_depots_ouverts();

drop index if exists public.credit_transactions_mm_reference_unique;

commit;

-- A n'executer QUE si `select count(*) from public.pawapay_depots;` vaut 0 :
--   drop table if exists public.pawapay_depots;
