/**
 * Les pays que le collecteur de Pub Track parcourt, et l'ordre dans lequel il
 * les parcourt. Décision de l'équipe, 07/10/2026 : tous les pays faisables,
 * d'abord les 54 pays d'Afrique.
 *
 * `priorite` 1 = chaque nuit ; 2 = un jour sur deux ; 3 = une fois par semaine.
 * C'est la seule liste : le collecteur, les filtres et l'écran la lisent ici.
 */
export interface PaysPubTrack {
  code: string;
  nom: string;
  nomEn: string;
  priorite: 1 | 2 | 3;
}

export const PAYS_PUB_TRACK: readonly PaysPubTrack[] = [
  { code: 'CI', nom: "Côte d'Ivoire", nomEn: "Côte d'Ivoire", priorite: 1 },
  { code: 'SN', nom: 'Sénégal', nomEn: 'Senegal', priorite: 1 },
  { code: 'CM', nom: 'Cameroun', nomEn: 'Cameroon', priorite: 1 },
  { code: 'GN', nom: 'Guinée', nomEn: 'Guinea', priorite: 1 },
  { code: 'BJ', nom: 'Bénin', nomEn: 'Benin', priorite: 1 },
  { code: 'TG', nom: 'Togo', nomEn: 'Togo', priorite: 1 },
  { code: 'BF', nom: 'Burkina Faso', nomEn: 'Burkina Faso', priorite: 1 },
  { code: 'ML', nom: 'Mali', nomEn: 'Mali', priorite: 1 },
  { code: 'CD', nom: 'RD Congo', nomEn: 'DR Congo', priorite: 1 },
  { code: 'MA', nom: 'Maroc', nomEn: 'Morocco', priorite: 1 },
  { code: 'NG', nom: 'Nigeria', nomEn: 'Nigeria', priorite: 1 },
  { code: 'GH', nom: 'Ghana', nomEn: 'Ghana', priorite: 1 },
  { code: 'CG', nom: 'Congo', nomEn: 'Congo', priorite: 2 },
  { code: 'GA', nom: 'Gabon', nomEn: 'Gabon', priorite: 2 },
  { code: 'NE', nom: 'Niger', nomEn: 'Niger', priorite: 2 },
  { code: 'DZ', nom: 'Algérie', nomEn: 'Algeria', priorite: 2 },
  { code: 'TN', nom: 'Tunisie', nomEn: 'Tunisia', priorite: 2 },
  { code: 'KE', nom: 'Kenya', nomEn: 'Kenya', priorite: 2 },
  { code: 'EG', nom: 'Égypte', nomEn: 'Egypt', priorite: 2 },
  { code: 'ZA', nom: 'Afrique du Sud', nomEn: 'South Africa', priorite: 2 },
  { code: 'MG', nom: 'Madagascar', nomEn: 'Madagascar', priorite: 2 },
  { code: 'TD', nom: 'Tchad', nomEn: 'Chad', priorite: 2 },
  { code: 'MR', nom: 'Mauritanie', nomEn: 'Mauritania', priorite: 2 },
  { code: 'RW', nom: 'Rwanda', nomEn: 'Rwanda', priorite: 2 },
  { code: 'UG', nom: 'Ouganda', nomEn: 'Uganda', priorite: 2 },
  { code: 'TZ', nom: 'Tanzanie', nomEn: 'Tanzania', priorite: 2 },
  { code: 'ET', nom: 'Éthiopie', nomEn: 'Ethiopia', priorite: 2 },
  { code: 'CF', nom: 'Centrafrique', nomEn: 'Central African Republic', priorite: 3 },
  { code: 'BI', nom: 'Burundi', nomEn: 'Burundi', priorite: 3 },
  { code: 'DJ', nom: 'Djibouti', nomEn: 'Djibouti', priorite: 3 },
  { code: 'KM', nom: 'Comores', nomEn: 'Comoros', priorite: 3 },
  { code: 'GQ', nom: 'Guinée équatoriale', nomEn: 'Equatorial Guinea', priorite: 3 },
  { code: 'GW', nom: 'Guinée-Bissau', nomEn: 'Guinea-Bissau', priorite: 3 },
  { code: 'SL', nom: 'Sierra Leone', nomEn: 'Sierra Leone', priorite: 3 },
  { code: 'LR', nom: 'Liberia', nomEn: 'Liberia', priorite: 3 },
  { code: 'GM', nom: 'Gambie', nomEn: 'Gambia', priorite: 3 },
  { code: 'CV', nom: 'Cap-Vert', nomEn: 'Cabo Verde', priorite: 3 },
  { code: 'ST', nom: 'Sao Tomé-et-Principe', nomEn: 'São Tomé and Príncipe', priorite: 3 },
  { code: 'AO', nom: 'Angola', nomEn: 'Angola', priorite: 3 },
  { code: 'MZ', nom: 'Mozambique', nomEn: 'Mozambique', priorite: 3 },
  { code: 'ZM', nom: 'Zambie', nomEn: 'Zambia', priorite: 3 },
  { code: 'ZW', nom: 'Zimbabwe', nomEn: 'Zimbabwe', priorite: 3 },
  { code: 'MW', nom: 'Malawi', nomEn: 'Malawi', priorite: 3 },
  { code: 'BW', nom: 'Botswana', nomEn: 'Botswana', priorite: 3 },
  { code: 'NA', nom: 'Namibie', nomEn: 'Namibia', priorite: 3 },
  { code: 'LS', nom: 'Lesotho', nomEn: 'Lesotho', priorite: 3 },
  { code: 'SZ', nom: 'Eswatini', nomEn: 'Eswatini', priorite: 3 },
  { code: 'MU', nom: 'Maurice', nomEn: 'Mauritius', priorite: 3 },
  { code: 'SC', nom: 'Seychelles', nomEn: 'Seychelles', priorite: 3 },
  { code: 'SO', nom: 'Somalie', nomEn: 'Somalia', priorite: 3 },
  { code: 'ER', nom: 'Érythrée', nomEn: 'Eritrea', priorite: 3 },
  { code: 'SS', nom: 'Soudan du Sud', nomEn: 'South Sudan', priorite: 3 },
  { code: 'SD', nom: 'Soudan', nomEn: 'Sudan', priorite: 3 },
  { code: 'LY', nom: 'Libye', nomEn: 'Libya', priorite: 3 },
];

const PAR_CODE = new Map(PAYS_PUB_TRACK.map((p) => [p.code, p]));

export function estPaysPubTrack(code: unknown): code is string {
  return typeof code === 'string' && PAR_CODE.has(code.toUpperCase());
}

export function paysPubTrack(code: string): PaysPubTrack | null {
  return PAR_CODE.get(code.toUpperCase()) ?? null;
}

/**
 * Les pays à parcourir ce jour-là. Priorité 1 chaque nuit, 2 un jour sur deux,
 * 3 le jour de la semaine qui tombe sur son rang : chaque pays passe au moins
 * une fois par semaine.
 */
export function paysDuJour(jour: Date): PaysPubTrack[] {
  const n = Math.floor(jour.getTime() / 86_400_000);
  return PAYS_PUB_TRACK.filter((p, i) => {
    if (p.priorite === 1) return true;
    if (p.priorite === 2) return n % 2 === i % 2;
    return n % 7 === i % 7;
  });
}

const plat = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

function distance(a: string, b: string): number {
  const ligne = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = ligne[0]!;
    ligne[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const garde = ligne[j]!;
      ligne[j] = Math.min(ligne[j]! + 1, ligne[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = garde;
    }
  }
  return ligne[b.length]!;
}

const motsDe = (nom: string) =>
  nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

/**
 * Les pays que désigne ce que le vendeur tape, même mal écrit (demande du
 * équipe, 07/10/2026 : « gine », « bnin » ou « senegale » doivent trouver).
 * Dans l'ordre : le code ISO, les noms dont un MOT commence par la saisie, ceux qui
 * la CONTIENNENT ; et seulement si rien ne correspond, les noms les PLUS PROCHES
 * à une ou deux fautes près. Jamais une liste de pays au hasard.
 */
export function rechercherPays<T extends PaysPubTrack>(saisie: string, liste: readonly T[]): T[] {
  const q = plat(saisie);
  if (!q) return [...liste];
  const noms = (p: T) => [p.nom, p.nomEn].map(plat);
  const parCode = liste.filter((p) => p.code.toLowerCase() === q);
  const debut = liste.filter((p) => noms(p).some((n) => n.startsWith(q)) || [p.nom, p.nomEn].flatMap(motsDe).some((m) => m.startsWith(q)));
  if (parCode.length || debut.length) return [...new Set([...parCode, ...debut])];
  if (q.length < 3) return [];
  const contient = liste.filter((p) => noms(p).some((n) => n.includes(q)));
  if (contient.length) return contient;
  const tolere = q.length <= 3 ? 1 : q.length <= 6 ? 2 : 3;
  const ecarts = liste.map((p) => ({
    p,
    ecart: Math.min(...[p.nom, p.nomEn].flatMap(motsDe).map((m) => distance(q, m))),
  }));
  const meilleur = Math.min(...ecarts.map((x) => x.ecart));
  return meilleur <= tolere ? ecarts.filter((x) => x.ecart === meilleur).map((x) => x.p) : [];
}
