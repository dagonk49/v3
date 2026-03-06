# DagzFlix (Next.js 14 + Jellyfin + Jellyseerr)

DagzFlix est une interface unifiée de streaming et découverte, avec un **BFF API** Next.js (`/api/*`) qui centralise:
- authentification Jellyfin,
- recommandations et recherche,
- demandes Jellyseerr,
- lecture vidéo et suivi de progression.

---

## Version du projet

- **Version courante**: **V0,007.7**
- **Format**: `V0,001`, `V0,002`, `V0,003`, etc.
- **Règle de suivi (obligatoire)**:
	- À chaque requête utilisateur impliquant une action/changement, la version est incrémentée.
	- La mise à jour est documentée **dans ce README** et dans `WORKLOG_DETAILED.txt`.
	- Chaque entrée contient au minimum: date, demande, modifications, fichiers touchés, validation.

### Journal des versions

- **V0,001** (2026-02-28)
	- Mise en place du protocole de versioning demandé.
	- Ajout du suivi de version obligatoire dans `README.md` et `WORKLOG_DETAILED.txt`.
	- Point de départ officiel pour les prochaines requêtes.

- **V0,002** (2026-02-28)
	- **Objectif 1**: Correction Smart Button séries — `handleMediaStatus` détecte maintenant les séries (ChildCount/RecursiveItemCount) au lieu de MediaSources.
	- **Objectif 2**: Enrichissement MediaDetailView:
		- Section Casting visuel avec photos acteurs (proxy Jellyfin), rôles, scroll horizontal.
		- Réalisateurs / Scénaristes avec badges colorés.
		- Affichage Studios/Networks sous le titre.
		- Genres cliquables → redirection recherche.
	- Fichiers modifiés: `route.js`, `MediaDetailView.jsx`, `page.js`.

- **V0,003** (2026-03-01)
	- **Refactoring majeur Phase 1** — Migration SPA → routage natif App Router Next.js.
	- **Mission 1** — Routage natif:
		- `app/page.js` réécrit : page Accueil uniquement (DashboardView).
		- Nouvelles pages : `app/movies/page.js`, `app/series/page.js`, `app/media/[id]/page.js`, `app/search/page.js`.
		- Pages auth : `app/login/page.js`, `app/setup/page.js`, `app/onboarding/page.js`.
		- Bouton retour navigateur natif fonctionnel (plus de pushState maison).
		- Contextes globaux : `lib/auth-context.js` (AuthProvider), `lib/player-context.js` (PlayerProvider).
		- `lib/item-store.js` : cache de navigation pour transitions instantanées.
		- `components/dagzflix/AppShell.jsx` : shell global (auth guard, navbar, player overlay).
		- `layout.js` : intègre AuthProvider + PlayerProvider + AppShell.
		- `Navbar.jsx` : réécrit avec `useRouter`/`usePathname` — plus de props `onSearch`/`onNavigate`.
	- **Mission 2** — Corrections MediaDetailView:
		- Scroll casting réparé : cartes acteurs `min-w-[120px]` + `overflow-x-auto hide-scrollbar`.
		- Acteurs cliquables : `<Link href="/person/[id]">` (page préparée).
		- Genres cliquables : `<Link href="/search?genre=...">` natif (plus de `onItemClick`).
		- Studios visibles sous le titre (déjà en V0,002, consolidé).
	- **Mission 3** — Moteur de recherche amélioré:
		- Debounce 800ms : la recherche se déclenche automatiquement après saisie.
		- Filtres type : Films | Séries | Tous (barre cliquable).
		- Filtre genre : sélection dynamique parmi la liste de genres, filtrage côté client.
		- URL synchronisée : `/search?q=...&type=...&genre=...`.
		- Composant `SearchView` autonome (utilise `useSearchParams`).
	- Fichiers créés: `auth-context.js`, `player-context.js`, `item-store.js`, `AppShell.jsx`, 7 pages.
	- Fichiers modifiés: `layout.js`, `page.js`, `Navbar.jsx`, `MediaDetailView.jsx`, `SearchView.jsx`.

- **V0,004** (2026-03-01)
	- **Phase 1.5 — Corrections et Polissage QA** (4 bugs post-migration).
	- **BUG 1** — Pages acteurs (404):
		- Nouvel endpoint API `person/detail` (`handlePersonDetail` dans route.js): récupère fiche personne + filmographie depuis Jellyfin.
		- Nouvelle page `app/person/[id]/page.js`: photo, biographie, date de naissance, filmographie grille (Films / Séries séparés).
	- **BUG 2** — Studios invisibles dans les listes:
		- `mapJellyfinItem()` enrichi: ajout du champ `studios` (manquant, les données étaient récupérées mais ignorées au mapping).
		- `MediaCard.jsx`: affichage discret du premier studio (icône Building2) dans le gradient hover.
	- **BUG 3** — Recherche genre seul retourne "Aucun résultat":
		- `SearchView.jsx`: quand genre seul (pas de texte), utilise `media/library?genres=...&type=...` au lieu de `search?q=GenreName`.
		- `handleMediaLibrary` enrichi: support du paramètre `genres` (nom) en plus de `genreIds` (ID).
	- **BUG 4** — Filtres type ne fonctionnent pas:
		- `handleSearch` enrichi: support du paramètre `mediaType` → `IncludeItemTypes` (Jellyfin) + filtrage post-map (Jellyseerr).
		- `SearchView.jsx`: type filter correctement transmis via `mediaType` param.
	- Fichiers créés: `app/person/[id]/page.js`.
	- Fichiers modifiés: `route.js`, `MediaCard.jsx`, `SearchView.jsx`, `README.md`, `WORKLOG_DETAILED.txt`.

- **V0,005** (2026-03-01)
	- **Phase 1.9 — Corrections finales QA** (3 bugs restants).
	- **BUG 1** — Page acteur limitée aux médias locaux:
		- `handlePersonDetail` réécrit: récupère la filmographie complète via Jellyseerr `/api/v1/person/{tmdbId}` (combinedCredits), fusionnée avec les items locaux Jellyfin.
		- Items locaux marqués `mediaStatus: 5` (disponible), items distants avec leur statut TMDB/Jellyseerr.
		- Dédoublonnage par TMDB ID entre local et distant.
		- `app/person/[id]/page.js` réécrit: filtre Disponible / À demander / Tout, compteurs locaux/distants.
	- **BUG 2** — Studios non cliquables:
		- `MediaDetailView.jsx`: studios enveloppés dans `<Link href="/search?studio=...">` (cliquables).
		- `MediaCard.jsx`: idem, studio cliquable avec `stopPropagation` pour éviter le double-clic.
		- `handleMediaLibrary` (route.js): support du paramètre `studios` (nom) envoyé à Jellyfin via `Studios={name}`.
		- `SearchView.jsx`: lecture et affichage du paramètre URL `studio`, tag violet effaçable.
	- **BUG 3** — Nettoyage des tags casse la recherche:
		- `SearchView.jsx`: `doSearch` réécrit — quand tous les filtres sont vides, reset propre (`hasSearched = false`, results vidés) au lieu de fetch vide.
		- Le `useEffect` déclenche `doSearch` à chaque changement de filtre (plus de condition `if (q || genre)`).
		- URL nettoyée via `router.replace` à chaque changement de paramètre.
	- Fichiers modifiés: `route.js`, `MediaCard.jsx`, `MediaDetailView.jsx`, `SearchView.jsx`, `app/person/[id]/page.js`, `README.md`, `WORKLOG_DETAILED.txt`.

- **V0,005.1** (2026-03-01)
	- **Hotfix critique** — Régressions Jellyseerr + filtres recherche.
	- **BUG 1** — Échec silencieux de Jellyseerr (Acteurs & Recherche uniquement locaux):
		- `handleSearch` (route.js): filtre type comparait `'movie'`/`'tv'` vs PascalCase `'Movie'`/`'Series'` de `mapTmdbItem` — fixé.
		- `handlePersonDetail` (route.js): ajout fallback recherche par nom sur Jellyseerr (`/api/v1/search`) si ProviderIds.Tmdb absent de Jellyfin.
		- Blocs `catch` silencieux remplacés par `console.error` avec messages explicites.
	- **BUG 2** — Filtres de recherche et debounce inactifs:
		- `SearchView.jsx` réécrit: architecture URL-driven (single source of truth).
		- États locaux dupliqués (`typeFilter`, `genreFilter`, `studioFilter`) éliminés, lus depuis `searchParams`.
		- Boutons filtres mettent à jour l'URL via `router.replace` → le changement d'URL déclenche le `useEffect` de fetch.
		- Type-only (sans texte ni genre/studio) : utilise `/api/discover` (Jellyseerr) pour résultats globaux.
		- Debounce 800ms écrit le param `q` dans l'URL, URL drive le fetch.
		- Ref `paramsRef` pour éviter closures périmées dans le debounce.
	- Fichiers modifiés: `route.js`, `SearchView.jsx`, `README.md`, `WORKLOG_DETAILED.txt`.

- **V0,005.2** (2026-03-01)
	- **Hotfix Data Sync & UI** — Synchronisation Jellyfin/Jellyseerr + unification genres.
	- **BUG 1** — Médias distants invisibles (Acteurs & Recherche):
		- `handlePersonDetail` (route.js): recherche Jellyseerr par nom **systématique** (plus de dépendance à ProviderIds.Tmdb). ProviderIds devient fallback uniquement si la recherche par nom échoue.
		- `mapTmdbItem` (route.js): résolution des `genreIds` → `genres` (string[]) via `TMDB_GENRE_ID_TO_NAME` pour que les items distants possèdent le champ `genres`.
		- `app/person/[id]/page.js`: `remoteCount` robustifié (`items.length - localCount` au lieu de `!== 5`). Filtre par défaut confirme "Tout".
	- **BUG 2** — Désynchronisation des tags (genres) entre Média et Recherche:
		- `SearchView.jsx`: suppression de `GENRE_LIST` hardcodée (anglais), remplacée par fetch dynamique `/api/media/genres` au montage (genres réels du serveur Jellyfin de l'utilisateur).
		- Genre filter avec texte: routé vers `/api/media/library?genres={genreTexte}&searchTerm={q}` (filtrage natif Jellyfin, aucune conversion de langue).
		- Suppression du filtre client-side `filteredResults` (doublon désormais inutile).
		- `GENRE_ICONS` avec fallback `'🎬'` pour genres non mappés.
		- TTL cache `media/genres`: 600s ajouté dans `lib/api.js`.
	- Fichiers modifiés: `route.js`, `SearchView.jsx`, `app/person/[id]/page.js`, `lib/api.js`, `README.md`, `WORKLOG_DETAILED.txt`.

- **V0,005.3** (2026-03-01)
	- **Unification totale Jellyfin/TMDB** — 4 corrections majeures data sync.
	- **BUG 1** — Limite d'affichage bibliothèque:
		- `handleMediaLibrary` (route.js): limite par défaut passée de `20` à `1000` pour remonter la totalité de la bibliothèque.
		- `MediaTypePage.jsx`: appel frontend mis à jour de `limit=60` à `limit=1000`.
	- **BUG 2** — DagzRank sur médias non-disponibles:
		- `handleSearch` (route.js): chargement des préférences utilisateur + historique de visionnage, application de `calculateDagzRank` sur tous les résultats (locaux et TMDB). Chaque item de recherche reçoit un `dagzRank`.
	- **BUG 3** — Casting manquant sur fiches distantes:
		- `handleMediaDetail` (route.js): réécrit avec fallback Jellyseerr. Si Jellyfin ne connaît pas l'ID (TMDB), tente `/api/v1/movie/{id}` puis `/api/v1/tv/{id}` avec extraction des `credits.cast` (15 premiers acteurs) et `credits.crew` (réalisateurs/scénaristes).
		- `PersonCard` (MediaDetailView.jsx): supporte désormais `person.photoUrl` (TMDB proxy) en plus de `person.Id` (Jellyfin proxy).
		- `fetchAll` (MediaDetailView.jsx): appelle systématiquement `media/detail` pour tous les items (TMDB inclus), avec fallback sur les données de la carte si l'API échoue.
	- **BUG 4** — Filmographie acteur incomplète:
		- `mapTmdbItem` (route.js): supporte les champs snake_case (`poster_path`, `media_type`, `release_date`, `first_air_date`, `vote_average`, `backdrop_path`) en plus du camelCase Jellyseerr.
		- `handlePersonDetail` (route.js): détection `media_type` en snake_case pour la déduplication correcte des crédits. Nettoyage du champ interne `_tmdbId` avant envoi au frontend.
	- Fichiers modifiés: `route.js`, `MediaDetailView.jsx`, `MediaTypePage.jsx`, `README.md`, `WORKLOG_DETAILED.txt`.

- **V0,005.4** (2026-03-01)
	- **Documentation massive + 2 corrections TMDB actor IDs.**
	- **BUG 1** — PersonCard non-cliquable pour acteurs TMDB:
		- `PersonCard` (MediaDetailView.jsx): le `<Link href>` utilisait `person.Id` qui est null pour les acteurs TMDB. Corrigé en `person.Id || person.tmdbId`. Les acteurs TMDB redirigent maintenant vers `/person/{tmdbId}`.
	- **BUG 2** — Page acteur 500 sur ID TMDB numérique:
		- `handlePersonDetail` (route.js): ajout détection `/^\d+$/.test(personId)`. Si l'ID est numérique (TMDB), skip Jellyfin (qui 404 sur un ID numérique), interroge directement Jellyseerr `/api/v1/person/{id}` pour bio + combinedCredits. Vérifie ensuite la disponibilité locale en cherchant par nom dans Jellyfin.
	- **MISSION 3** — Documentation JSDoc massive:
		- `route.js`: JSDoc ajouté sur toutes les fonctions (37 fonctions documentées): utilitaires (`getDb`, `jsonResponse`, `jellyfinAuthHeader`, `getConfig`, `getSession`, `resolveGenres`, `mapTmdbItem`, `mapJellyfinItem`, `extractTmdbId`, `fetchJellyfinItemById`, `resolveTmdbId`, `normalizeContentId`, `contentIdFromItem`, `calculateDagzRank`, `matchesRuntimeLoose`), handlers (`handleSetupCheck/Test/Save`, `handleAuthLogin/Logout/Session`, `handlePreferencesGet/Save`, `handleMediaLibrary/Genres/Detail/Resume/Seasons/Episodes/Trailer/Collection/Status/Request/Progress`, `handleStream`, `handleSearch`, `handleDiscover`, `handleRecommendations`, `handleWizardDiscover/Feedback`, `handleProxyImage/Tmdb`, `handlePersonDetail`), et routeurs (`getPathParts`, `routeGet`, `routePost`, `GET`, `POST`, `OPTIONS`).
		- `MediaDetailView.jsx`: JSDoc sur `PersonCard`, `EpisodeCard`, `MediaDetailView`.
		- `app/person/[id]/page.js`: JSDoc sur `PersonPage`, commentaire sur `SECTION_FILTERS`.
	- Fichiers modifiés: `route.js`, `MediaDetailView.jsx`, `app/person/[id]/page.js`, `README.md`, `WORKLOG_DETAILED.txt`.

- **V0,006** (2026-03-01)
	- **GRANDE MISE À JOUR : Admin, Télémétrie & UX Premium** — 4 missions.
	- **🔴 MISSION 1** — Télémétrie + DagzRank V3 (Backend):
		- Nouveau endpoint `POST /api/telemetry/click` : enregistre les clics utilisateur sur les médias (fire & forget).
		- Nouveau endpoint `POST /api/media/rate` : notation 1-5 étoiles par utilisateur (upsert dans collection `telemetry`).
		- Nouveau endpoint `GET /api/media/rating` : récupère la note utilisateur + moyenne globale + nombre de votes.
		- `handleMediaProgress` enrichi : cumul automatique du temps de visionnage dans `telemetry` (action 'watch').
		- `calculateDagzRank` **réécrit en V3** : scoring 7 couches (max 100 pts) :
			- Genres favoris (30 pts), affinité historique (15 pts), note communautaire (15 pts),
			  fraîcheur (10 pts), bonus télémétrie personnelle (15 pts), bonus collaboratif (15 pts),
			  pénalités (déjà vu, rejeté, genres détestés).
		- Nouvelle fonction `loadTelemetryData(userId)` : agrège les events watch/rate personnels + notes globales depuis MongoDB.
	- **🔵 MISSION 2** — Contrôle Parental + Sécurité (Backend):
		- Nouvelle collection MongoDB `users` : rôles (`admin`/`adult`/`child`), `maxRating`, timestamps.
		- Nouvelles fonctions `getUserProfile()` et `applyParentalFilter()` :
			- Bloque genres Horror/Erotic/Thriller pour les enfants.
			- Bloque contenus adultes (flag `isAdult`).
			- Bloque certifications R, NC-17, 18+, TV-MA etc.
		- `handleAuthLogin` : upsert du profil utilisateur dans `users` à la connexion (rôle par défaut : `adult`).
		- `handleAuthSession` : expose le rôle (`role`) dans la réponse session.
		- Filtre parental intégré dans : `handleSearch`, `handleDiscover`, `handleMediaLibrary`, `handleRecommendations`.
		- Nouveaux endpoints admin-only :
			- `GET /api/admin/users` : liste tous les utilisateurs (vérification rôle admin).
			- `POST /api/admin/users/update` : modifie le rôle d'un utilisateur (vérification rôle admin).
	- **🟢 MISSION 3** — Panneau d'Administration (Frontend):
		- Nouvelle page `app/admin/page.js` :
			- Table d'utilisateurs (avatar, nom, ID Jellyfin tronqué, dernière connexion).
			- Sélecteur de rôle (Administrateur/Adulte/Enfant) avec icônes Crown/User/Baby.
			- Bouton de sauvegarde individuel + état de chargement (Loader2).
			- Toast animé (succès/erreur) avec AnimatePresence Framer Motion.
			- Stagger animation sur les lignes du tableau.
			- Design dark épuré, responsive, cohérent DagzFlix.
		- `auth-context.js` : route `/admin` autorisée dans le guard de redirection.
	- **🟡 MISSION 4** — UI/UX Premium + Micro-animations (Frontend):
		- `MediaCard.jsx` : télémétrie de clic fire & forget (`sendClickTelemetry`), stagger variants (`cardVariants`), `whileTap={{ scale: 0.98 }}`, animation d'entrée par index.
		- `MediaDetailView.jsx` : composant `StarRating` interactif (5 étoiles) — hover preview, clic pour noter, affiche note perso + moyenne globale. Stagger animation sur le casting (PersonCards).
		- `lib/api.js` : nouveaux TTLs cache — `media/rating` (30s), `admin/users` (15s), `telemetry` (0 = pas de cache).
	- **Nouvelles routes API** :
		- GET : `admin/users`, `media/rating`
		- POST : `telemetry/click`, `media/rate`, `admin/users/update`
	- **Nouvelles collections MongoDB** : `users`, `telemetry`
	- Fichiers créés : `app/admin/page.js`.
	- Fichiers modifiés : `route.js`, `MediaCard.jsx`, `MediaDetailView.jsx`, `auth-context.js`, `api.js`, `CHANGELOG.md`, `README.md`, `WORKLOG_DETAILED.txt`.

- **V0,007** (2026-03-03)
	- **Système de Favoris complet** (full-stack).
	- **Backend** (route.js):
		- Nouveau endpoint `POST /api/media/favorite` (`handleMediaFavoriteToggle`): toggle favori utilisateur (ajout/suppression) dans collection MongoDB `favorites`. Stocke `{userId, itemId, itemData, createdAt}`.
		- Nouveau endpoint `GET /api/media/favorites` (`handleMediaFavoritesGet`): retourne tous les favoris de l'utilisateur triés par date décroissante.
		- Routes enregistrées dans `routeGet` et `routePost`.
	- **Frontend — Page dédiée**:
		- Nouvelle page `app/favorites/page.js` (130 lignes): page "Mes Favoris" avec grille de `MediaCard`, état vide animé (cœur + CTA "Découvrir le catalogue"), loader, animation `pageVariants`.
	- **Frontend — MediaCard.jsx**:
		- Bouton cœur en overlay (coin haut droit) visible au hover ou quand favori actif.
		- `toggleFavorite()` avec optimistic UI + revert on error.
		- État `isFavorite` initialisé depuis `item.isFavorite`.
		- Import `Heart` + `AnimatePresence` pour animation spring.
	- **Frontend — MediaDetailView.jsx**:
		- Nouveau composant `FavoriteButton`: bouton "Ajouter"/"Favori" avec cœur animé, optimistic toggle, intégré à côté de SmartButton et TrailerButton.
	- **Frontend — Navbar.jsx**:
		- Nouveau lien de navigation "Favoris" (icône `Heart`) pointant vers `/favorites`.
	- **Nouvelle collection MongoDB**: `favorites` (`{userId, itemId, itemData, createdAt}`).
	- **Nouvelles routes API**:
		- GET : `media/favorites`
		- POST : `media/favorite`
	- Fichiers créés : `app/favorites/page.js`.
	- Fichiers modifiés : `route.js`, `MediaCard.jsx`, `MediaDetailView.jsx`, `Navbar.jsx`.

- **V0,007.5** (2026-03-03)
	- **MEGA-UPDATE : TMDB Source de Vérité + Favoris Persistants + Smart Play** — 6 missions.
	- **Règle architecturale** : Jellyseerr/TMDB est la **source de vérité absolue** pour les métadonnées. Jellyfin ne sert QUE pour la disponibilité locale et le flux vidéo.
	- **🔴 MISSION 1** — Fiche Acteur 100% TMDB:
		- `handlePersonDetail` (route.js) — chemin UUID réécrit : ne fetch plus la filmographie locale depuis Jellyfin. Récupère 100% de la bio + filmographie via Jellyseerr `/api/v1/person/{tmdbId}` (combinedCredits). Jellyfin sert uniquement au cross-check de disponibilité via `getLocalTmdbIds()`. Enrichissement de la fiche personne (biography, birthday, profilePath) depuis TMDB.
	- **🔵 MISSION 2** — Casting 100% TMDB:
		- `handleMediaDetail` (route.js) — chemin Jellyfin local : les `People` Jellyfin (souvent incomplets, sans photos) sont désormais **systématiquement remplacés** par les credits TMDB via Jellyseerr. Fallback sur les People Jellyfin uniquement si Jellyseerr échoue. Cast 15 acteurs + crew 6 (directeurs/scénaristes) avec `photoUrl` TMDB proxy. Ajout `tmdbId` sur l'item local.
	- **🟢 MISSION 3** — Persistance visuelle des favoris:
		- Nouvelle fonction utilitaire `injectFavoriteStatus(items, userId)` : interroge MongoDB `favorites` pour l'utilisateur, construit un Set d'IDs, injecte `isFavorite: true` sur les items correspondants.
		- Injection systématique dans : `handleMediaLibrary`, `handleSearch` (Jellyseerr + Jellyfin fallback), `handleDiscover`, `handleRecommendations`, `handleMediaDetail` (local + TMDB fallback).
		- Le cœur favori dans `MediaCard` et la page `FavoriteButton` dans `MediaDetailView` sont maintenant pré-remplis dès le chargement initial.
	- **🟡 MISSION 4** — Recherche par tags globale TMDB:
		- `handleDiscover` (route.js) : nouveau support paramètre `genre` (nom texte). Résolution automatique nom→ID TMDB via reverse map `TMDB_GENRE_NAME_TO_ID` (construit dynamiquement). Support match partiel. Paramètre `studio` forwarded.
		- `SearchView.jsx` : quand un genre est sélectionné, route désormais vers `/api/discover?type=...&genre=...` (TMDB global) au lieu de `/api/media/library?genres=...` (Jellyfin local seulement). Si texte + genre, combo search + client-side genre filter.
		- Nouvelle constante `TMDB_GENRE_NAME_TO_ID` dans route.js.
	- **🟠 MISSION 5** — Correction faux "En Attente":
		- `getLocalTmdbIds` réécrit : retourne un `Map<tmdbId, jellyfinId>` (au lieu d'un `Set`) pour résoudre l'ID local Jellyfin à partir du TMDB ID.
		- `handleMediaStatus` : si Jellyfin ne trouve pas l'item par ID direct, cross-réfère le TMDB ID avec `getLocalTmdbIds()`. Retourne `localId` dans la réponse.
		- `handleMediaDetail` (TMDB fallback) : utilise `localTmdbIds.get()` pour assigner `localId` et forcer `mediaStatus: 5`. Le champ `id` de la réponse est remplacé par le Jellyfin ID local quand disponible.
		- `handleSearch` / `handleDiscover` / `handlePersonDetail` : injection systématique de `localId` quand cross-réf positive.
	- **🔴 MISSION 6** — Smart Play séries:
		- Nouveau endpoint `GET /api/media/next-episode?seriesId={id}` (`handleNextEpisode`): logique 3 étapes — (1) épisode en cours de reprise (Resume), (2) premier épisode non-vu (IsPlayed=false), (3) fallback S01E01. Retourne `{episodeId, seasonNumber, episodeNumber, name, found}`.
		- Route enregistrée dans `routeGet`.
		- `SmartButton.jsx` : après check status "available" pour une série, pré-fetch `media/next-episode`. Le bouton affiche `S01E02` (ou l'épisode résolu) au lieu de "LECTURE". `handlePlay` transmet `episodeId` au callback `onPlay`.
		- `MediaDetailView.jsx` : callback `onPlay` du SmartButton gère le `episodeId` — set `playEpId` avant d'ouvrir le player.
	- **Nouvelles routes API** :
		- GET : `media/next-episode`
	- **Nouvelles fonctions** : `injectFavoriteStatus`, `handleNextEpisode`, `TMDB_GENRE_NAME_TO_ID`
	- **Fonctions réécrites** : `getLocalTmdbIds` (Set→Map), `handlePersonDetail` (UUID path 100% TMDB), `handleMediaDetail` (credits TMDB), `handleMediaStatus` (cross-réf TMDB→local), `handleDiscover` (genre filter)
	- Fichiers modifiés : `route.js`, `SmartButton.jsx`, `MediaDetailView.jsx`, `SearchView.jsx`.

- **V0,007.6** (2026-03-03)
	- **EMERGENCY HOTFIX** — Correction des régressions V0,007.5. Zéro feature, que de la réparation.
	- **ROUND 1** — Éradication des erreurs 500:
		- 6 handlers (`handleMediaLibrary`, `handleMediaResume`, `handleDiscover`, `handleRecommendations`, `handleSearch`, `handleWizardDiscover`) enveloppés en try/catch avec dégradation gracieuse (retour vide au lieu de 500).
		- `applyParentalFilter` : null-guard + try/catch.
		- Sous-appels (`getUserProfile`, `loadTelemetryData`, `prefs`) protégés par `.catch()`.
		- DagzRank assoupli : base score 0→25 pts, télémétrie/collab neutres à 5 pts, pénalités réduites.
		- `handleRecommendations` : filtre `dagzRank > 20` supprimé. Retourne toujours le top 25.
		- Audit Map vs Set : 12 usages vérifiés, tous corrects.
	- **ROUND 2** — Analyse logs live (3 nouveaux bugs trouvés):
		- `handleMediaGenres` : try/catch ajouté, retourne `{genres:[]}` en cas d'erreur (500→200).
		- `handleMediaDetail` : strip du préfixe `tmdb-` avant lookup Jellyseerr (404→200).
		- `handleStream` : try/catch ajouté, retourne 404 propre avec `{notLocal: true}` au lieu de 500.
	- **ROUND 3** — Élimination des 404 stream sur items TMDB:
		- `handleStream` (route.js) : détection des IDs numériques TMDB, résolution via `getLocalTmdbIds()` avant appel Jellyfin. Si non-local → 404 `{notLocal: true}`.
		- `MediaDetailView.jsx` : remplacement de l'heuristique `isTmdbOnly` (cassée pour IDs numériques) par un check `mediaStatus === 5`. Nouveau `streamId = localId || id`. Sous-titres/pistes audio chargés uniquement si `canStreamFromJellyfin`.
		- `VideoPlayer.jsx` : utilise `item.localId || item.id` pour les appels stream.
		- `mapTmdbItem()` (route.js) : `mediaStatus` cappé à 4 max — seul le code de cross-référence (`isLocal`) peut assigner 5.
		- `handleMediaDetail` fallback TMDB : même cap `Math.min(..., 4)` pour items non-locaux.
	- **Résultat final** : monitoring 90 secondes → **zéro 500**, **zéro 404 non-intentionnel**. Tous les endpoints retournent 200.
	- Fichiers modifiés : `route.js`, `MediaDetailView.jsx`, `VideoPlayer.jsx`.

- **V0,007.7** (2026-03-03)
	- **RÉSURRECTION DES DONNÉES** — Correction de 2 bugs logiques critiques causés par le hotfix V0,007.6.
	- **🔴 BUG 1** — Aucun média disponible / Tout est “En attente”:
		- `getLocalTmdbIds` : ajout `Limit=10000` à la requête Jellyfin (le défaut ne renvoyait qu'un sous-ensemble de la bibliothèque).
		- Ajout log diagnostic : `[getLocalTmdbIds] Mapped X local items (scanned Y)` pour tracer la couverture.
		- Vérification : toutes les 6 call-sites utilisent déjà `String()` pour les clés du Map — pas de type mismatch.
	- **🔵 BUG 2** — Disparition des listes (Découverte, Tendances, Librairie):
		- `handleMediaLibrary` : restructuré — les items Jellyfin sont acquis, puis `applyParentalFilter` et `injectFavoriteStatus` sont chacun isolés dans leur propre try/catch. Un échec de sous-fonction ne vide plus les résultats.
		- `handleDiscover` : même restructuration — mapping TMDB, cross-ref locale, filtre parental, et favoris chacun isolés.
		- `handleRecommendations` : `applyParentalFilter` et `injectFavoriteStatus` isolés en try/catch individuels.
		- `handleSearch` : `scoreResults` interne ne vide plus les items si `applyParentalFilter` échoue.
		- Tous les catch logguent `console.error` avec préfixe descriptif au lieu de swallow silencieux.
	- Fichiers modifiés : `route.js`.

---

## 1) Stack technique

- **Frontend**: Next.js 14 (App Router), React 18, Framer Motion, Tailwind
- **Backend (BFF)**: route API centralisée dans `app/api/[[...path]]/route.js`
- **DB**: MongoDB (config, sessions, préférences, users, telemetry, favorites)
- **Médias**: Jellyfin (lecture locale)
- **Discovery/Request**: Jellyseerr / TMDB

---

## 2) Arborescence utile

### Pages (App Router)
- `app/page.js` : Accueil (Hero + Tendances + DashboardView)
- `app/movies/page.js` : Page Films (bibliothèque, recherche, wizard, DagzRank)
- `app/series/page.js` : Page Séries (idem)
- `app/media/[id]/page.js` : Détail d'un média (MediaDetailView)
- `app/person/[id]/page.js` : Fiche acteur (photo, bio, filmographie)
- `app/search/page.js` : Recherche avec debounce + filtres
- `app/favorites/page.js` : Page Mes Favoris (grille, toggle cœur, état vide)
- `app/admin/page.js` : Panneau d'administration (gestion utilisateurs/rôles)
- `app/login/page.js` : Connexion Jellyfin
- `app/setup/page.js` : Configuration serveurs
- `app/onboarding/page.js` : Préférences genres

### API BFF
- `app/api/[[...path]]/route.js` : route API centralisée (~2850 lignes)

### Composants
- `components/dagzflix/*` : UI métier (dashboard, wizard, player, smart actions)
- `components/dagzflix/AppShell.jsx` : shell global (auth guard, navbar, player)

### Librairies
- `lib/api.js` : client API + cache
- `lib/auth-context.js` : AuthProvider (session, redirections, login/logout)
- `lib/player-context.js` : PlayerProvider (lecture vidéo globale)
- `lib/item-store.js` : cache de navigation (transitions instantanées)
- `lib/constants.js` : constantes UI/domaine

### Configuration
- `.env.local` : variables d’environnement locales
- `WORKLOG_DETAILED.txt` : journal détaillé des interventions réalisées

---

## 3) Prérequis

- Node.js 18+ (recommandé: 20+)
- npm / yarn
- MongoDB accessible
- Une instance Jellyfin
- (Optionnel mais recommandé) Jellyseerr

---

## 4) Installation

```bash
npm install
```

ou

```bash
yarn install
```

---

## 5) Configuration environnement

Créer un fichier `.env.local` à la racine:

```env
MONGO_URL=mongodb://localhost:27017
DB_NAME=dagzflix
CORS_ORIGINS=*
```

> Les URLs/API Keys Jellyfin/Jellyseerr sont ensuite sauvegardées via l’écran Setup (`/api/setup/save`).

---

## 6) Lancement

### Développement

```bash
npx next dev --hostname 0.0.0.0 --port 3001
```

Puis ouvrir:
- `http://localhost:3001`

### Build production

```bash
npm run build
npm run start
```

---

## 7) Flux applicatif

1. **Loading**
2. **Setup check** (`/api/setup/check`)
3. Si non configuré: **SetupView**
4. Sinon: **Login Jellyfin**
5. Si onboarding incomplet: **OnboardingView**
6. Sinon: **Dashboard** + sections Films/Séries

---

## 8) API BFF (routes principales)

### Setup / Auth
- `GET /api/setup/check`
- `POST /api/setup/test`
- `POST /api/setup/save`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`

### Préférences
- `GET /api/preferences`
- `POST /api/preferences`

### Média
- `GET /api/media/library`
- `GET /api/media/detail`
- `GET /api/media/resume`
- `GET /api/media/seasons`
- `GET /api/media/episodes`
- `GET /api/media/trailer`
- `GET /api/media/collection`
- `GET /api/media/status`
- `GET /api/media/stream`
- `GET /api/media/favorites`
- `GET /api/media/next-episode`
- `POST /api/media/favorite`
- `POST /api/media/request`
- `POST /api/media/progress`

### Reco / Recherche
- `GET /api/search`
- `GET /api/discover`
- `GET /api/recommendations`
- `POST /api/wizard/discover`
- `POST /api/wizard/feedback`

### Proxies
- `GET /api/proxy/image`
- `GET /api/proxy/tmdb`

---

## 9) Comportements implémentés importants

### 9.1 Lecture / disponibilité
- Le statut “play” est strictement conditionné à la dispo locale Jellyfin.
- Évite les tentatives de lecture sur des IDs TMDB non locaux.

### 9.2 Trailers
- Agrégation trailer depuis Jellyfin/Jellyseerr si dispo.
- Fallback vers recherche YouTube quand aucun trailer exploitable.

### 9.3 Wizard
- Bouton “Réessayer” côté UI.
- Envoi d’un feedback de rejet (`wizard/feedback`).
- Exclusion des IDs rejetés pour éviter répétitions immédiates.
- Pénalisation des contenus/genres rejetés dans le ranking.

### 9.4 Cache API client
- Le cache n’enregistre plus les réponses d’erreur.
- Le cache est vidé après login réussi pour éviter états obsolètes.

---

## 10) Débogage rapide

### Symptôme: écran figé sur “DAGZFLIX”
1. Vérifier qu’une seule instance Next est active.
2. Redémarrer le serveur dev.
3. Hard refresh navigateur (`Ctrl+F5`).
4. Vérifier les assets `_next` en 200.

### Symptôme: bibliothèque vide
1. Vérifier `/api/auth/session` (authentifié).
2. Vérifier `/api/media/library?...` avec cookie de session.
3. Vérifier que le token Jellyfin en session est valide.
4. Déconnexion/reconnexion pour régénérer la session.

### Symptôme: playback info failed
- Vérifier que l’item est bien local Jellyfin (pas TMDB-only).
- Vérifier endpoint `/api/media/status`.

### Symptôme: trailers non lisibles
- Vérifier `/api/media/trailer`.
- Si pas d’embed possible, fallback externe YouTube est utilisé.

---

## 11) Scripts

`package.json` inclut:
- `npm run dev`
- `npm run dev:no-reload`
- `npm run dev:webpack`
- `npm run build`
- `npm run start`

---

## 12) Notes d’exploitation

- Éviter plusieurs `next dev` en parallèle (conflits de ports/états incohérents).
- Garder MongoDB disponible avant lancement.
- Ne pas exposer publiquement les clés/API sensibles.

---

## 13) Historique de correction

Le détail complet des opérations et correctifs est disponible dans:
- `WORKLOG_DETAILED.txt`

---

## 14) Prochaines améliorations suggérées (optionnel)

- Ajouter observabilité explicite côté UI (message d’erreur API visible au lieu de catch silencieux).
- Ajouter tests d’intégration pour routes critiques `media/*`.
- Isoler la route monolithique en modules pour maintenance plus sûre.

---

## 15) Licence / usage

Aucune licence explicite n’est définie dans ce dépôt à date.
#   v 3  
 #   v 3  
 