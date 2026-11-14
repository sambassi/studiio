// Empreinte d'un texte français (FNV-1a 32 bits, base 36) — IDENTIQUE à `empreinteLibelle`
// de src/i18n/messages.ts (un test vérifie l'égalité). Sert de clé dans `ui.libelles`.
function normaliser(t) { return String(t).normalize('NFC').replace(/\s+/g, ' ').trim(); }
function empreinte(t) {
  const s = normaliser(t);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `h${h.toString(36)}${s.length.toString(36)}`;
}
module.exports = { empreinte, normaliser };
