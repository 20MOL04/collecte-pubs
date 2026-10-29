# collecte-pubs

Collecte de nuit des publicites publiques de la bibliotheque Meta, par pays. Tourne sur GitHub Actions.

## Pub Track v2 (29/10/2026)

L'audit et le plan de reconstruction du robot vivent dans le depot de l'application :
`20MOL04/creafrik`, fichier `docs/PLAN-PUB-TRACK-V2.md` (avec `docs/CAHIER-PUB-TRACK.md`). A lire avant
toute modification. Priorite : lot 1 (ne plus se faire bloquer par Meta) puis lot 2 (passe de verification).

Regle : une seule collecte Meta a la fois. Ne jamais lancer plusieurs `workflow_dispatch` en parallele.
