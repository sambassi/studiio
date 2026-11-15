// Lots pour les propositions IA (ln/wo/bm/bas) : clés SANS traduction dans le catalogue, par ordre de priorité d'écran.
//   node scripts/i18n/lots-ia.cjs <dossier-sortie> <langue> [taille=260]
const fs = require('fs'); const path = require('path');
const [, , sortie, langue, tailleArg] = process.argv; const taille = Number(tailleArg || 260);
const racine = path.resolve(__dirname, '..', '..');
const lire = (f) => JSON.parse(fs.readFileSync(path.join(racine, f), 'utf8'));
const aplatir = (o, p = '', out = {}) => { for (const k of Object.keys(o)) { const v = o[k]; const c = p ? `${p}.${k}` : k; if (v && typeof v === 'object') aplatir(v, c, out); else if (typeof v === 'string') out[c] = v; } return out; };
const fr = aplatir(lire('messages/fr.json')); const deja = aplatir(lire(`messages/${langue}.json`));
const EXCLUES = /^(admin|adminSidebar|email|privacy|terms)\./;
const ORDRE = [/^(sidebar|navbar|common|dashboardHome|notifications)\./, /^ui\.appDashboardCreerAssistantWizard\./, /^ui\.(componentsCreer|appDashboardCreer)/, /^creator\./, /^ui\.(appDashboardCinema|componentsCinema)/, /^ui\.componentsCreerAutopilotPanel|Autopilote/, /^(billing|ui\.componentsSettings|objectives|auth)\./, /^(calendar|ui\.appDashboardCalendar|library|ui\.componentsShared|social|ui\.componentsSocial)/, /^(audioStudio|infographic|ui\.appDashboardInfographic|ui\.libelles)/];
const rang = (k) => { const i = ORDRE.findIndex((r) => r.test(k)); return i < 0 ? 99 : i; };
const cles = Object.keys(fr).filter((k) => !EXCLUES.test(k) && !(deja[k] && deja[k].trim()) && !/^(landing)\./.test(k)).sort((a, b) => rang(a) - rang(b));
fs.mkdirSync(sortie, { recursive: true });
for (let i = 0; i < cles.length; i += taille) fs.writeFileSync(path.join(sortie, `${langue}-${String(i / taille + 1).padStart(2, '0')}.json`), JSON.stringify(Object.fromEntries(cles.slice(i, i + taille).map((k) => [k, fr[k]])), null, 1));
console.log(`${langue}: ${cles.length} clés → ${Math.ceil(cles.length / taille)} lots`);
