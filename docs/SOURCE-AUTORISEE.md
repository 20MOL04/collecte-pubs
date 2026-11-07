# Pub Track : les vidéos dans R2 et la source autorisée (07/11/2026)

## 1. Le verrou des vidéos

Les vidéos de Pub Track vivent dans Cloudflare R2 :

- bucket : `creafrik-pub-track` ;
- adresse publique : `https://media.creafrik.com/videos/<id>.mp4`, où `<id>` est `pub_track_pubs.id`.

Le robot n'écrit `pub_track_pubs` que par un seul chemin, `ecrireRecherche` (`scripts/pub-track/ecriture.ts`). Ce chemin applique deux règles à chaque ligne, avec la logique de `lib/pub-track/video-chez-nous.ts` :

1. **Une `video_url` qui commence par `https://media.creafrik.com/` n'est jamais réécrite.** Elle ne peut être remplacée ni par un lien neuf, ni par NULL.
2. **Un lien externe n'est jamais écrit en `video_url`.** C'est le cas des liens fbcdn, TikTok ou fournisseur. Un vieux lien fbcdn déjà en base est remis à NULL quand la pub est réécrite. Le lien externe sert seulement de source au dépôt dans R2, en mémoire.

Tests : `tests/video-chez-nous.test.ts` et `tests/ecriture-verrou.test.ts`.

Le rafraîchissement des liens fbcdn (`rafraichirVideosMeta`) n'est plus appelé : il n'y a plus rien à renouveler.

## 2. Le dépôt dans R2

Le dépôt est le même que dans l'application (`20MOL04/creafrik`, `services/pub-track/videos.ts`) :

- clé `videos/<id>.mp4` ;
- réencodage 480p H.264 « faststart » ;
- plafond de 8 Go mesuré sur le bucket avant le téléchargement et juste avant le dépôt.

Côté robot, ce code vit dans `services/pub-track/videos.ts` et `services/stockage/r2.ts`. ffmpeg vient du système : le workflow l'installe s'il manque.

**L'ordre.** En fin de collecte, après le calcul des scores, la file part dans R2 : les gagnantes d'abord, puis les montantes, puis par score décroissant. La file prend 8 minutes au plus et s'arrête au premier `plafond_atteint`.

**Ce qui n'est pas téléchargé.** Le collecteur de la bibliothèque publique ne télécharge rien depuis un CDN de Meta. C'est la règle déjà écrite dans l'application : « elle ne doit être appelée sur aucune adresse de Meta ». En pratique, ses vidéos ne partent donc pas dans R2. Seules les vidéos livrées par une source autorisée y partent.

## 3. La source autorisée

Martin choisit la source. Il y a deux possibilités :

- **Un fournisseur de données sous contrat.** Son contrat doit couvrir les pubs Meta des pays de Pub Track et, s'il livre des vidéos, leur recopie chez nous.
- **L'accès officiel de Meta**, c'est-à-dire l'API de la bibliothèque publicitaire avec un compte vérifié. Hors de l'Union européenne, cette API ne rend que les pubs politiques ou sociales, pas les pubs commerciales. Elle ne livre pas non plus le fichier vidéo, seulement un lien vers la page de la pub. **Seule, elle ne suffit pas pour l'Afrique.**

### Le contrat de données

Le fournisseur expose une adresse https. Le robot l'appelle avec `?pays=CI,SN&depuis=AAAA-MM-JJ` et l'en-tête `Authorization: Bearer <SOURCE_PUBS_CLE>`. Elle rend :

```json
{
  "pubs": [
    {
      "id": "1234567890123",
      "page_id": "998877",
      "page_nom": "Belle Peau CI",
      "page_avatar": "https://...",
      "page_abonnes": 12000,
      "texte": "Savon naturel, livraison gratuite...",
      "titre": "Commandez sur WhatsApp",
      "appel_action": "Envoyer un message",
      "lien": "https://wa.me/225...",
      "pays": ["CI", "SN"],
      "plateformes": ["facebook", "instagram"],
      "date_debut": "2026-10-20",
      "date_fin": null,
      "active": true,
      "format": "video",
      "video_url": "https://... (lien encore valide vers le fichier)",
      "video_duree_s": 24,
      "image_url": "https://...",
      "variantes": 3
    }
  ],
  "suivant": "https://... (page suivante) ou null"
}
```

Le format est précisé ainsi :

- Seuls `id`, `page_id` et `pays` sont obligatoires.
- `id` est l'identifiant de la pub dans la bibliothèque Meta : c'est lui qui évite les doublons avec les pubs déjà en base.
- Chaque pub passe par le même traducteur que la bibliothèque (`versLigne`), donc avec la même catégorie, la même niche et les mêmes règles.

Si le fournisseur a un autre format, il suffit d'écrire une fonction qui le traduit en `PubFournie` (`lib/pub-track/source-autorisee.ts`).

### Lancer

1. Poser les secrets du dépôt `SOURCE_PUBS_URL` et `SOURCE_PUBS_CLE`.
2. Si le contrat couvre la recopie de vidéos hébergées chez Meta, poser aussi la variable du dépôt `SOURCE_PUBS_VIDEOS_META` = `oui`. C'est une variable, pas un secret.
3. Tester d'abord sur un échantillon du fournisseur, sans rien écrire :
   `npx tsx scripts/pub-track/collecter-source.ts --fichier echantillon.json --sec`
4. Lancer ensuite la tâche « Source autorisee » à la main dans GitHub Actions.

Si la source refuse (401, 403 ou 429), tout s'arrête et le refus est signalé. Il n'y a pas de nouvel essai et pas de contournement.

## 4. Les secrets du dépôt

| Secret | Valeur |
|---|---|
| `R2_ACCOUNT_ID` | l'identifiant du compte Cloudflare |
| `R2_ACCESS_KEY_ID` | la clé du jeton R2 `creafrik-pub-track-rw` |
| `R2_SECRET_ACCESS_KEY` | son secret |
| `R2_BUCKET_PUB_TRACK` | `creafrik-pub-track` |
| `R2_URL_PUBLIQUE_PUB_TRACK` | `https://media.creafrik.com` |
| `GEMINI_API_KEY` | la clé Google AI Studio d'un projet **sans facturation** (classeur gratuit) |

Pour poser les cinq secrets R2 depuis le `.env.local` de creafrik, sans jamais les afficher (PowerShell, `gh` connecté) :

```powershell
$noms = 'R2_ACCOUNT_ID|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_BUCKET_PUB_TRACK|R2_URL_PUBLIQUE_PUB_TRACK'
Get-Content C:\Creafrik\.env.local | Where-Object { $_ -match "^($noms)=" } | Set-Content -Encoding utf8 "$env:TEMP\r2.env"
gh secret set -f "$env:TEMP\r2.env" -R 20MOL04/collecte-pubs
Remove-Item "$env:TEMP\r2.env"
gh secret list -R 20MOL04/collecte-pubs
```

Après chaque nouveau jeton Cloudflare, relancer ces commandes.
