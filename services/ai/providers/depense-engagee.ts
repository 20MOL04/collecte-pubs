/**
 * UNE DEPENSE ENGAGEE CHEZ LE FOURNISSEUR SURVIT A L ECHEC QUI LA SUIT.
 *
 * Le moteur savait chiffrer une image LIVREE. Il ne savait rien dire d une
 * image PAYEE puis perdue, et c est par la que l argent sortait sans trace.
 *
 * Trois fuites mesurees le 10/09/2026, toutes de la meme forme :
 *
 *   image-gemini.ts   trois tentatives facturees, une seule comptee    0,268 $ / frame
 *   run-creative.ts   le peintre perdant efface avec son erreur        0,165 $ / affiche
 *   video-veo.ts      Veo lance, poll en echec, zero dollar ecrit      0,180 $ / scene
 *
 * Le vendeur est rembourse a chaque fois, ce qui est juste. Mais la facture
 * fournisseur, elle, a bien eu lieu : le remboursement d un credit ne rembourse
 * pas Google. Sans cette classe, `usage_events` ecrivait 0 $ et le tableau de
 * bord additionnait des zeros, exactement l incident des 20 $ evapores du
 * 24/08/2026, rejoue sur le chemin des ECHECS au lieu de celui des reussites.
 *
 * La regle est donc : ce qui a ete facture remonte avec l erreur, jusqu a la
 * route, qui l ecrit avec `status: 'failed'` et `creditsCharged: 0`. Une erreur
 * qui perd son montant est une depense qui disparait.
 */

export class ErreurFournisseurFacturee extends Error {
  /** Ce que le fournisseur a DEJA facture quand cette erreur est levee. */
  readonly costUsd: number;
  /** Ce qui a reellement echoue, pour le journal. Le vendeur ne le lit jamais. */
  readonly causeReelle: unknown;

  constructor(message: string, costUsd: number, causeReelle?: unknown) {
    super(message);
    this.name = 'ErreurFournisseurFacturee';
    this.costUsd = Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0;
    this.causeReelle = causeReelle;
  }
}

/**
 * Le montant deja facture porte par une erreur, zero si elle n en porte pas.
 *
 * Les appelants ne testent JAMAIS `instanceof` eux-memes : une erreur qui
 * traverse deux modules compiles separement peut perdre sa chaine de
 * prototypes, et le montant redeviendrait zero en silence. Un seul point de
 * lecture, et il retombe sur le champ.
 */
export function coutEngage(err: unknown): number {
  if (err instanceof ErreurFournisseurFacturee) return err.costUsd;
  if (err && typeof err === 'object' && 'costUsd' in err) {
    const brut = (err as { costUsd: unknown }).costUsd;
    if (typeof brut === 'number' && Number.isFinite(brut) && brut > 0) return brut;
  }
  return 0;
}
