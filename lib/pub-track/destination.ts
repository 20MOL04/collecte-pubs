/**
 * Où mène une pub, et quelle est sa boutique (cahier, sections 4.1 et 4.2).
 *
 * En Afrique, la majorité des pubs vendent par message, pas sur un site. Le
 * numéro WhatsApp est donc une boutique à part entière : `wa:+224622342720`.
 */
export const DESTINATIONS = ['boutique', 'message_whatsapp', 'message_messenger', 'appel', 'inconnue'] as const;
export type Destination = (typeof DESTINATIONS)[number];

export function estDestination(v: unknown): v is Destination {
  return typeof v === 'string' && (DESTINATIONS as readonly string[]).includes(v);
}

function url(lien: string | null | undefined): URL | null {
  if (!lien) return null;
  try {
    return new URL(lien.startsWith('http') ? lien : `https://${lien}`);
  } catch {
    return null;
  }
}

/** Le domaine d'une boutique, sans `www.`, en minuscules. */
export function domaineDe(lien: string | null | undefined): string | null {
  const u = url(lien);
  if (!u) return null;
  const hote = u.hostname.toLowerCase().replace(/^www\./, '');
  return hote.includes('.') ? hote : null;
}

const HOTES_WHATSAPP = new Set(['wa.me', 'api.whatsapp.com', 'whatsapp.com', 'chat.whatsapp.com', 'wa.link']);
const HOTES_MESSENGER = new Set(['m.me', 'messenger.com']);
/** Liens qui ne sont pas une boutique : la page Facebook elle-même, un raccourcisseur. */
const HOTES_SANS_BOUTIQUE = new Set(['facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'l.facebook.com']);

export function destinationDe(lien: string | null | undefined, appelAction?: string | null): Destination {
  if (lien?.startsWith('whatsapp:')) return 'message_whatsapp';
  const d = domaineDe(lien);
  if (d && HOTES_WHATSAPP.has(d)) return 'message_whatsapp';
  if (d && HOTES_MESSENGER.has(d)) return 'message_messenger';
  if (/whatsapp/i.test(appelAction ?? '')) return 'message_whatsapp';
  if (/messenger|send message/i.test(appelAction ?? '')) return 'message_messenger';
  if (d && !HOTES_SANS_BOUTIQUE.has(d)) return 'boutique';
  if (/call|appel/i.test(appelAction ?? '')) return 'appel';
  return 'inconnue';
}

/**
 * Le numéro WhatsApp en E.164, lu dans le lien (`wa.me/224...`,
 * `?phone=224...`) ou, à défaut, dans le texte (« +224 622 34 27 20 »).
 */
export function numeroWhatsApp(lien: string | null | undefined, texte?: string | null): string | null {
  const u = url(lien);
  const candidats = [
    u?.searchParams.get('phone') ?? '',
    u && HOTES_WHATSAPP.has(u.hostname.replace(/^www\./, '')) ? u.pathname.replace(/\//g, '') : '',
  ];
  for (const c of candidats) {
    const chiffres = c.replace(/\D/g, '');
    if (chiffres.length >= 9 && chiffres.length <= 15) return `+${chiffres}`;
  }
  const dansTexte = (texte ?? '').match(/\+\s?\d[\d\s.-]{7,18}\d/);
  if (dansTexte) {
    const chiffres = dansTexte[0].replace(/\D/g, '');
    if (chiffres.length >= 9 && chiffres.length <= 15) return `+${chiffres}`;
  }
  return null;
}

/**
 * Des domaines qui ne sont PAS une boutique : magasins d'applications,
 * raccourcisseurs, réseaux. Mesuré le 07/10/2026 : `play.google.com` sortait
 * première « boutique » avec 115 pubs, toutes d'annonceurs différents.
 */
const PLATEFORMES = new Set([
  'play.google.com', 'apps.apple.com', 'itunes.apple.com', 'linktr.ee', 'bit.ly', 'tinyurl.com', 'cutt.ly',
  'youtube.com', 'youtu.be', 'tiktok.com', 'vm.tiktok.com', 'twitter.com', 'x.com', 'linkedin.com', 'forms.gle', 'docs.google.com',
]);

export function estPlateforme(domaine: string | null): boolean {
  return !!domaine && PLATEFORMES.has(domaine);
}

/** La clé de boutique d'une pub, ou null si elle n'en a pas (page seule). */
export function boutiqueCle(destination: Destination, lien: string | null | undefined, texte?: string | null): string | null {
  if (destination === 'boutique') {
    const d = domaineDe(lien);
    return estPlateforme(d) ? null : d;
  }
  if (destination === 'message_whatsapp') {
    const n = numeroWhatsApp(lien, texte);
    return n ? `wa:${n}` : null;
  }
  return null;
}
