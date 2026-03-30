# Skill : Playwright (Automatisation navigateur)

## Description
Ce skill permet d'utiliser Playwright avec un navigateur Chromium headless pour scraper des pages web, extraire des données structurées, et automatiser des interactions navigateur.

## Utilisation
Pour scraper une page web et récupérer son contenu en JSON :

```bash
node .claude/skills/playwright/scripts/run.js <URL>
```

### Sortie JSON
Le script retourne un objet JSON avec :
- `title` : le titre de la page
- `text` : le contenu textuel principal (sans nav, footer, bannières cookies)
- `links` : tableau des liens trouvés `[{ text, href }]`

## Cas d'usage
- Lire la documentation d'une API externe
- Vérifier qu'une page déployée charge correctement
- Extraire des données structurées d'un site
- Tester des endpoints ou des redirections

## Dépendances
- `playwright` (npm)
- Chromium (installé via `npx playwright install chromium`)

## Fichiers
- `SKILL.md` : cette documentation
- `scripts/run.js` : script principal de scraping
