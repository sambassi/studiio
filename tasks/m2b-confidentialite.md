# M2-b — Confidentialité de l'analyse IA des rushes personnels

État : code livré ÉTEINT (interrupteurs OFF par défaut). Rien n'est envoyé tant que les quatre verrous ne sont pas ouverts : interrupteur + modèle configurés, compte administrateur (`isAdmin`), consentement explicite valide du compte, rush personnel du compte de la session.

## Fournisseurs et données envoyées

| Fournisseur | Quoi | Combien | Quand |
|---|---|---|---|
| Anthropic (API Messages, modèle `STUDIIO_VISION_RUSH_MODEL`) | images fixes JPEG, 640 px de large au plus, réparties sur la durée | 6 par défaut (`STUDIIO_VISION_RUSH_IMAGES`, plafond 8) | une fois par fichier (cache), sur action explicite |
| Groq (transcription, modèle `STUDIIO_TRANSCRIPTION_RUSH_MODEL`) | piste son FLAC 16 kHz mono | 120 s au plus (`-t`) | seulement s'il y a du son et une énergie non muette (M1) |

Jamais envoyés : nom de fichier, URL, identifiant de compte, e-mail, texte de l'utilisateur. Le nom du fichier FLAC envoyé est le littéral `piste.flac`. L'invite système est une constante du dépôt.

Rien n'est envoyé : image noire, floue ou vide (verdict M1 « inutilisable » sur un motif fort), rush sans piste vidéo, son muet, média stock, URL externe, rush d'un autre compte.

## Transferts hors UE

Les deux fournisseurs traitent aux États-Unis. La révocation est relue juste avant CHAQUE envoi (vision puis transcription), pas seulement au lancement. Le texte de consentement (fr/en/de, `src/lib/creer/consentement-ia.ts`) le dit explicitement.

## Conservation et entraînement — vérifié dans la documentation publique le 2026-10-16

- **Anthropic API** — https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data : suppression en général sous 30 jours (« we automatically delete inputs and outputs on our backend within 30 days of receipt or generation »), SAUF exceptions prévues par Anthropic : accord contraire, application de sa politique d'usage, obligations légales (durée alors plus longue). Ce n'est donc pas un « au plus 30 jours » absolu. https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training : « By default, we will not use your inputs or outputs from our commercial products » pour l'entraînement (sauf retour volontaire type pouce haut/bas). La page vision (https://platform.claude.com/docs/en/build-with-claude/vision) précise que les images ne sont pas utilisées pour entraîner les modèles. La **zéro conservation (ZDR)** existe mais par **accord contractuel** avec Anthropic, pas par un réglage de console : à demander avant une ouverture au-delà de l'admin.
- **Groq** — https://console.groq.com/docs/your-data : « By default, Groq does not retain customer data for inference requests » ; journaux temporaires possibles pour fiabilité / abus, **jusqu'à 30 jours** (plus si la loi l'exige) ; `/openai/v1/audio/transcriptions` est **éligible ZDR**, activable par tout client dans **Data Controls** de la console (globalement ou par fonction). La page ne dit rien de l'entraînement : non vérifié, à confirmer dans les conditions commerciales Groq.

## Paramètres à activer côté console AVANT activation

1. Groq : console → Settings → **Data Controls** → activer **Zero Data Retention** (au moins pour les transcriptions).
2. Anthropic : vérifier dans la console que le partage de retours (feedback) n'est pas activé ; demander l'accord ZDR si l'analyse sort du périmètre admin/canari.
3. Clés dédiées (workspace séparé) pour mesurer le coût de M2-b à part.

## Chez Studiio

- Fiche v2 : `media/fiches-contenu/<uid>/analyse/<sha1>.<taille>.v2.json` — sujets (taxonomie fermée), lieu, objets (≤ 5), action, nombre de personnes (`aucune|une|plusieurs|inconnu`), langue, présence et durée de parole, sujets de la parole (identifiants de la liste fermée `CONCEPTS` seulement), usage (jetons, secondes, modèle, coût estimé). Aucune image, aucun son, AUCUN texte de la parole (ni extrait, ni mot libre) n'est conservé ni journalisé : le texte transcrit n'existe qu'en mémoire le temps d'en tirer des identifiants. Une transcription Autopilote réutilisée reste dans `rush_transcriptions`, rien de nouveau n'est écrit. Les images et le FLAC n'existent qu'en mémoire / fichier temporaire supprimé (`avecAudioFlac`).
- Consentement : `media/fiches-contenu/<uid>/analyse/consentement-ia.json` (version du texte, fournisseurs, langue, date d'accord, date de révocation).
- Les deux sont dans le namespace privé (refusés par le relais public, illisibles au nom d'un compte) et sous le préfixe `fiches-contenu/<uid>/` **purgé par la suppression RGPD** (`prefixesStockageDuCompte`, testé).
- Aucune donnée personnelle dans les journaux : les modules M2-b n'écrivent rien en console ; les motifs d'échec sont des littéraux à nous (`fournisseur_http_429`, `delai_depasse`…).
- Biométrie : aucun champ ne porte nom, âge, genre, origine, émotion ou santé ; l'invite l'interdit et le validateur refuse en sortie les catégories « personnes » et « qualité » et tout libre qui en parle.

## Suppression chez les fournisseurs

Appels sans état : aucun identifiant de fichier ni de requête n'est conservé chez nous, il n'y a rien d'adressable à supprimer par compte. La purge repose sur la durée de conservation du fournisseur (≤ 30 jours, 0 avec ZDR). Ajouté au tableau de `tasks/rgpd-points-restants.md`.

## Reste à faire avant activation

- Mention dans `src/app/privacy/page.tsx` (non modifiée dans ce lot).
- Écran de consentement dans Créer (la route `/api/creer/consentement-ia` et les textes sont prêts ; aucun composant n'est branché).
- Test réel payant minimal, sur accord explicite.
