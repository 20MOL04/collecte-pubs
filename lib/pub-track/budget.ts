/**
 * Le budget d'une nuit de collecte Pub Track : le SEUL endroit où il se règle.
 *
 * GitHub Actions donne 2 000 minutes par mois à un dépôt privé, et le équipe
 * ne veut RIEN payer (décision du 07/10/2026). Une nuit tient donc en moins
 * d'une heure : 44 minutes de collecte, ~6 de rangement (plateformes, classement,
 * scores) et ~4 d'installation, soit ~54 minutes et ~1 650 minutes par mois, avec de la marge pour les autres workflows du dépôt.
 * (Ce budget prévoyait 140 minutes par nuit, le DOUBLE du quota gratuit.)
 * Une recherche coûte ~25 s, pauses de politesse comprises : ~100 par nuit. La politesse envers Meta (une requête à la fois, des
 * pauses) n'est pas une option : un rythme de robot se fait bloquer.
 */
export const BUDGET_COLLECTE = {
  /** Couples (pays, mot-clé) lus par nuit. */
  requetesParNuit: 100,
  /** Défilements par requête (chaque défilement charge environ 30 pubs). */
  defilementsParRequete: 3,
  /**
   * Défilements EN PLUS quand la recherche est riche : chaque défilement a rempli la
   * page et la moitié au moins des pubs sont des produits (audit du 08/10/2026).
   * ~4 s chacun : la limite de durée de la nuit (`dureeMaxMinutes`) reste la garde.
   */
  defilementsBonus: 3,
  /** En dessous de ce nombre de pubs par défilement, la recherche est épuisée. */
  pubsParDefilement: 8,
  /** Pause entre deux défilements, en ms (tirée au hasard dans l'intervalle). */
  pauseDefilementMs: [2500, 5000] as const,
  /** Pause entre deux requêtes, en ms. */
  pauseRequeteMs: [4000, 9000] as const,
  /** Durée maximale du job, en minutes : au-delà, on recalcule et on s'arrête. */
  dureeMaxMinutes: 44,
  /** Miniatures recopiées par nuit au plus. */
  miniaturesParNuit: 1500,
  /** Lecture de la page d'accueil d'une boutique : une fois tous les N jours. */
  technoValableJours: 30,
  /** Pages d'accueil lues par nuit au plus. */
  technosParNuit: 300,
  /**
   * Une recherche sur DEUX ne demande à Meta que les pubs lancées depuis N jours :
   * les lancements du jour arrivent dès la nuit suivante (demande du équipe,
   * 07/10/2026 : « voir les publicités lancées aujourd'hui »). L'autre moitié
   * prend toutes les pubs actives, pour les gagnantes installées depuis longtemps.
   */
  fraicheurJours: 2,
  /**
   * Vidéos TikTok des vendeurs (ScrapeCreators, 1 crédit la recherche, 09/10/2026) : 60 recherches
   * par nuit au plus, 2 par pays, 6 minutes prises sur Meta. 5 000 crédits tiennent ~80 nuits. PAYANT : ne part
   * qu'avec `--tiktok-videos` et une clé posée (lot 7), jamais par défaut.
   */
  tiktokVideosParNuit: 60,
  tiktokVideosParPays: 2,
  tiktokVideosMinutes: 6,
  /**
   * Le nom du produit et le verdict « vend ou non » (modèle de vision, 09/10/2026) : les pubs
   * entrées dans la vitrine cette nuit, par lots de 10, 6 minutes prises sur Meta.
   */
  nommageParNuit: 400,
  nommageMinutes: 6,
  /**
   * Le rafraîchissement des vidéos Meta (09/10/2026) : leur adresse expire ~4 jours après lecture.
   * 5 minutes prises sur les recherches Meta, une page par annonceur, les plus touchés d abord.
   */
  rafraichirMinutes: 5,
  /**
   * « Tendance occidentale » (10/10/2026) : 12 recherches dans des pays occidentaux chaque nuit,
   * 6 minutes prises sur l'Afrique. Les paires (pays, mot) tournent : tout est relu en quatre nuits.
   */
  occidentRequetes: 12,
  occidentMinutes: 6,
  rafraichirAnnonceurs: 25,
} as const;
