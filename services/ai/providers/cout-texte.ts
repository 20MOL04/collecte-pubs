/**
 * LA DEPENSE DU DIRECTEUR, JUMEAU TEXTE DE `cout-image.ts`.
 *
 * `CLAUDE.md` pose la regle sans ambiguite : toute route qui appelle un
 * fournisseur payant ecrit dans `usage_events`, meme quand elle ne debite aucun
 * credit. Elle est nee d'un solde de 20 $ evapore pendant que la base ne
 * comptait presque rien, parce que la depense passait par des portes qui ne
 * comptaient pas.
 *
 * `app/api/campaign/brief/route.ts` etait exactement une de ces portes. Elle
 * appelle `gpt-4o` a chaque campagne, avec la photo du produit et un prompt de
 * quinze mille caracteres, et elle n'ecrivait RIEN. La marge de l'application
 * ignorait donc le cout du plan, c'est-a-dire la moitie des appels du parcours.
 *
 * DEUX REGLES, LES MEMES QUE POUR L'IMAGE
 *
 * 1. Le RELEVE prime sur la table. Ici le releve, ce sont les jetons rendus par
 *    le fournisseur : on ne les estime jamais depuis la longueur du prompt, qui
 *    ne dit rien du decoupage reel ni des jetons d'image.
 * 2. Un modele inconnu ne coute JAMAIS zero. Zero ferait disparaitre la depense
 *    du tableau de bord, c'est-a-dire exactement le bug a eviter. Un modele
 *    absent de la table est facture au tarif du plus cher qu'on connaisse :
 *    mieux vaut une marge sous-estimee qu'une depense invisible.
 *
 * Les tarifs sont ceux publies par OpenAI, en dollars par MILLION de jetons,
 * releves le 25/08/2026. Ils sont figes par `scripts/verify-cout-texte.ts` :
 * une modification silencieuse casserait le test, comme pour l'image.
 */

export interface UsageTexte {
  jetonsEntree: number;
  jetonsSortie: number;
  /** Jetons d'entree servis depuis le cache du fournisseur, factures moins cher. */
  jetonsCache?: number;
  /**
   * Jetons ECRITS dans le cache. Anthropic seulement, et plus chers que
   * l'entree pleine : `cache_creation_input_tokens` etait declare dans
   * `flux-claude.ts` et lu par personne, donc la mise en cache paraissait
   * gratuite alors qu'elle coute 1,25 fois le tarif d'entree.
   */
  jetonsCreationCache?: number;
}

interface TarifTexte {
  entree: number;
  sortie: number;
  /** Absent quand le fournisseur ne remise pas le cache sur ce modele. */
  cache?: number;
  /** Ecriture du cache. Absent chez OpenAI, qui ne la facture pas a part. */
  creationCache?: number;
}

/**
 * LES DEUX FOURNISSEURS NE COMPTENT PAS LE CACHE DE LA MEME FACON.
 *
 * OpenAI INCLUT les jetons caches dans `prompt_tokens` : il faut donc les
 * SOUSTRAIRE avant de leur appliquer le tarif remise, sinon on les facture
 * deux fois.
 *
 * Anthropic les EXCLUT de `input_tokens` : ils s'AJOUTENT. Le code appliquait
 * la regle OpenAI aux deux, avec un `Math.min(jetonsCache, entree)` qui rabotait
 * la lecture de cache a la taille de l'entree non cachee. Sur un tour Molia
 * reel (socle mis en cache, contexte vendeur court), 12 000 jetons relus
 * tombaient a 400 : la depense etait sous-estimee d'environ 21 %, dans le sens
 * qui flatte la marge.
 *
 * La semantique se DEDUIT du modele et ne se passe pas en argument : un
 * parametre de plus, c'est un appelant qui l'oubliera, et l'erreur serait de
 * nouveau silencieuse.
 */
function estAnthropic(modele: string): boolean {
  return modele.trim().toLowerCase().startsWith('claude-');
}

/** Dollars par million de jetons. */
export const TARIF_TEXTE: Record<string, TarifTexte> = {
  'gpt-4o': { entree: 2.5, sortie: 10, cache: 1.25 },
  'gpt-4o-mini': { entree: 0.15, sortie: 0.6, cache: 0.075 },
  'gpt-4.1': { entree: 2, sortie: 8, cache: 0.5 },
  'gpt-4.1-mini': { entree: 0.4, sortie: 1.6, cache: 0.1 },
  'gpt-4.1-nano': { entree: 0.1, sortie: 0.4, cache: 0.025 },
  /*
   * Tarifs Anthropic, dollars par million de jetons.
   *
   * LES LIGNES CLAUDE N'AVAIENT NI `cache` NI `creationCache`, et le
   * commentaire s'en justifiait ainsi : « elle ne s'applique qu'a un prefixe
   * stable : le prompt du directeur change a chaque produit, donc on ne la
   * compte pas ». C'etait vrai du directeur de campagne, et faux de Molia, qui
   * envoie `cache_control: ephemeral` sur un socle fige a chaque tour.
   *
   * Sans ligne `cache`, une lecture de cache retombait sur `tarif.entree`,
   * c'est-a-dire le PLEIN tarif pour un jeton facture au dixieme. Une regle
   * ecrite pour un appelant, appliquee a un autre qui fait l'inverse.
   *
   * Lecture 0,1x l'entree, ecriture 1,25x (cache ephemere de cinq minutes).
   */
  // Opus 5.5 : moins cher qu'Opus 5 (tarif Anthropic relevé le 04/10/2026). Le moteur motion l'appelle pour écrire les films.
  'claude-opus-5-5': { entree: 4, sortie: 20, cache: 0.2, creationCache: 5 },
  'claude-opus-5': { entree: 5, sortie: 25, cache: 0.5, creationCache: 6.25 },
  'claude-sonnet-5': { entree: 2, sortie: 10, cache: 0.2, creationCache: 2.5 },
  'claude-sonnet-4-6': { entree: 3, sortie: 15, cache: 0.3, creationCache: 3.75 },
  'claude-haiku-4-5': { entree: 1, sortie: 5, cache: 0.1, creationCache: 1.25 },
};

/**
 * Le plus cher de la table, applique a tout modele inconnu.
 *
 * Calcule, jamais recopie : une constante ecrite a la main resterait a
 * l'ancienne valeur le jour ou un modele plus cher entre dans la table, et le
 * repli deviendrait moins cher que la realite sans que personne le voie.
 */
function tarifLePlusCher(): TarifTexte {
  const lignes = Object.values(TARIF_TEXTE);
  return {
    entree: Math.max(...lignes.map((l) => l.entree)),
    sortie: Math.max(...lignes.map((l) => l.sortie)),
  };
}

const PAR_MILLION = 1_000_000;

/**
 * Cout reel d'un appel de texte, en dollars.
 *
 * Un usage absent ou vide renvoie zero, et c'est exact : un appel qui n'a
 * consomme aucun jeton n'a rien coute. C'est different d'un modele inconnu,
 * qui a bien consomme et dont on ignore seulement le tarif.
 */
export function coutTexteUsd(modele: string, usage: UsageTexte | null | undefined): number {
  if (!usage) return 0;
  const entree = Math.max(0, usage.jetonsEntree || 0);
  const sortie = Math.max(0, usage.jetonsSortie || 0);
  const anthropic = estAnthropic(modele);
  const cacheBrut = Math.max(0, usage.jetonsCache || 0);
  /*
   * LE PLAFOND NE VAUT QUE POUR OPENAI.
   *
   * Chez OpenAI, un cache annonce plus grand que l'entree est une reponse
   * incoherente, et le rabot protege. Chez Anthropic, c'est le cas NORMAL :
   * `input_tokens` exclut le cache, donc la lecture le depasse presque toujours.
   * Le meme rabot y devenait une perte seche.
   */
  const cache = anthropic ? cacheBrut : Math.min(cacheBrut, entree);
  const creationCache = anthropic ? Math.max(0, usage.jetonsCreationCache || 0) : 0;
  if (entree + sortie + cache + creationCache === 0) return 0;

  const connu = TARIF_TEXTE[modele];
  if (!connu) {
    console.warn(
      `[ai/cout-texte] modele inconnu "${modele}" : cout estime au tarif le plus cher connu. ` +
        `Ajouter sa ligne dans TARIF_TEXTE pour que la depense cesse d etre approximative.`,
    );
  }
  const tarif = connu ?? tarifLePlusCher();

  /*
   * Chez OpenAI les jetons du cache sont deja comptes dans `jetonsEntree` : on
   * retire leur part pleine avant d'ajouter leur part remisee, sinon on les
   * facture deux fois. Chez Anthropic ils n'y sont pas : l'entree reste
   * entiere et le cache s'ajoute.
   */
  const pleins = anthropic ? entree : entree - cache;
  const prixCache = tarif.cache ?? tarif.entree;
  const prixCreation = tarif.creationCache ?? tarif.entree;

  return (
    (pleins * tarif.entree +
      cache * prixCache +
      creationCache * prixCreation +
      sortie * tarif.sortie) /
    PAR_MILLION
  );
}
