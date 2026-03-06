# DagzFlix Changelog

## V0,007.8 — SESSION RESURRECTION (Token Jellyfin stale)

### 🔴 CAUSE RACINE : Ancien compte = page vide / tout "En attente"
Le token Jellyfin (stocké dans la session MongoDB lors du login) peut expirer côté Jellyfin
(redémarrage serveur, révocation), mais la session MongoDB reste valide 7 jours.
Résultat : toutes les requêtes Jellyfin retournent 401, mais les handlers renvoyaient 200
avec des données **vides** — le frontend ne savait jamais qu'il fallait se re-connecter.

### Correctifs

**1. `getSession()` — Validation du token Jellyfin (cache 5 min)**
- Ping léger `GET /Users/{id}` au premier appel puis toutes les 5 minutes
- Si Jellyfin 401 → session MongoDB supprimée, `getSession()` retourne `null`
- Si réseau down → on laisse passer (dégradation gracieuse)
- Cache en mémoire `Map<cacheKey, {valid, ts}>` pour éviter le spam

**2. `mapJellyfinItem()` — mediaStatus 5 + champs manquants**
- Tout item provenant de Jellyfin reçoit `mediaStatus: 5` (local par définition)
- Ajout `tmdbId` (via `extractTmdbId`), `localId: item.Id`, `providerIds`
- Corrige : badge "Disponible" (MediaCard), bouton "LECTURE" (MediaDetailView),
  chargement sous-titres/audio (stream gate)

**3. Handlers — Propagation du 401 Jellyfin**
- `handleMediaLibrary` : retourne HTTP 401 si Jellyfin 401 (au lieu de 200 vide)
- `handleMediaResume` : idem

**4. Frontend — Auto-logout sur token expiré**
- `api.js` : détecte HTTP 401 sur endpoints non-auth → dispatch `dagzflix:session-expired`
- `auth-context.js` : écoute l'événement → `clearCache()` + redirect `/login`
- L'utilisateur se re-connecte → nouveau token frais → tout fonctionne

### Fichiers modifiés
- `app/api/[[...path]]/route.js` — getSession, mapJellyfinItem, handleMediaLibrary, handleMediaResume
- `lib/api.js` — dispatch session-expired event sur 401
- `lib/auth-context.js` — listener auto-logout

## V0,007.7 — RÉSURRECTION DES DONNÉES (Bugs logiques V0,007.6)

### 🔴 BUG 1 : Aucun média disponible / Tout "En attente"
- **getLocalTmdbIds** — Ajout `Limit=10000` à la requête Jellyfin (défaut ne renvoyait qu'un sous-ensemble).
- Log diagnostique : `Mapped X local items (scanned Y)`.
- Vérification : 6 call-sites utilisent déjà `String()` — pas de type mismatch.

### 🔵 BUG 2 : Disparition des listes (catch destructeur)
- **handleMediaLibrary** — `applyParentalFilter` et `injectFavoriteStatus` isolés en try/catch individuels. Items Jellyfin jamais vidés.
- **handleDiscover** — Cross-ref locale, filtre parental, favoris chacun isolés.
- **handleRecommendations** — Sous-fonctions isolées, items merged/scored protégés.
- **handleSearch** — `scoreResults` interne : filtre parental isolé. `loadTelemetryData`/`getUserProfile` protégés.
- Tous les catch logguent `console.error` au lieu de swallow silencieux.

### Fichiers modifiés
- `app/api/[[...path]]/route.js` (~2927 lignes)

## V0,007.6 — EMERGENCY HOTFIX (Régressions V0,007.5)

### Round 1 : Hardening backend (500 errors)
- **6 handlers** enveloppés en try/catch avec dégradation gracieuse : `handleMediaLibrary`, `handleMediaResume`, `handleDiscover`, `handleRecommendations`, `handleSearch`, `handleWizardDiscover`.
- **applyParentalFilter** : null-guard + try/catch.
- Sous-appels (`getUserProfile`, `loadTelemetryData`, `prefs`) protégés par `.catch()`.
- **calculateDagzRank** : base score 0→25 pts, sections neutres à 5 pts, pénalités allégées.
- **handleRecommendations** : filtre `dagzRank > 20` SUPPRIMÉ. Retourne toujours le top 25.
- Audit Map vs Set : 12 usages vérifiés, tous corrects.

### Round 2 : Analyse logs live (3 bugs supplémentaires)
- **handleMediaGenres** — try/catch, retourne `{genres:[]}` (500→200).
- **handleMediaDetail** — strip préfixe `tmdb-` avant lookup Jellyseerr (404→200).
- **handleStream** — try/catch, retourne 404 `{notLocal: true}` au lieu de 500.

### Round 3 : Élimination des 404 stream sur items TMDB
- **handleStream** — Résolution TMDB ID→Jellyfin UUID via `getLocalTmdbIds()`. Si non-local → 404 propre.
- **MediaDetailView.jsx** — Remplacement heuristique `isTmdbOnly` par check `mediaStatus === 5`. Nouveau `streamId = localId || id`.
- **VideoPlayer.jsx** — Utilise `item.localId || item.id` pour les appels stream.
- **mapTmdbItem()** — `mediaStatus` cappé à 4 max (seul `isLocal` peut assigner 5).
- **handleMediaDetail** TMDB fallback — `Math.min(status, 4)` pour items non-locaux.

### Résultat final
- Monitoring 90s en live : **zéro 500**, **zéro 404 non-intentionnel**. Tous les endpoints → 200.
- Fichiers modifiés : `route.js`, `MediaDetailView.jsx`, `VideoPlayer.jsx`.

## V0,007.5 — TMDB Source de Vérité + Favoris Persistants + Smart Play

### 🔴 Mission 1 : Fiche Acteur 100% TMDB
- **handlePersonDetail** (UUID path) — Filmographie complète via Jellyseerr `/api/v1/person/{tmdbId}` (combinedCredits). Plus de fetch filmographie Jellyfin. Bio, birthday enrichis depuis TMDB. Cross-check local via `getLocalTmdbIds()` (Map).

### 🔵 Mission 2 : Casting 100% TMDB
- **handleMediaDetail** (Jellyfin path) — Fetch systématique des credits TMDB pour items locaux. People Jellyfin remplacés par cast TMDB (15 acteurs + 6 crew) avec `photoUrl` proxy. Fallback Jellyfin si Jellyseerr échoue.

### 🟢 Mission 3 : Persistance visuelle des favoris
- **injectFavoriteStatus()** — Nouvelle fonction utilitaire. Query MongoDB `favorites`, injecte `isFavorite: true` sur items correspondants.
- Injection dans : `handleMediaLibrary`, `handleSearch` (×2), `handleDiscover`, `handleRecommendations`, `handleMediaDetail` (×2 paths).
- Le cœur MediaCard / FavoriteButton est pré-rempli dès le chargement initial.

### 🟡 Mission 4 : Recherche par tags globale TMDB
- **TMDB_GENRE_NAME_TO_ID** — Map inversé automatique (nom→ID TMDB).
- **handleDiscover** — Support paramètre `genre` (nom texte, résolution auto) + `studio`.
- **SearchView.jsx** — Genre filter route vers `/api/discover?genre=...` (TMDB global) au lieu de Jellyfin local.

### 🟠 Mission 5 : Correction faux "En Attente"
- **getLocalTmdbIds()** — Retourne `Map<tmdbId, jellyfinId>` (au lieu de `Set`).
- **handleMediaStatus** — Cross-référence TMDB ID ↔ bibliothèque locale. Retourne `localId`.
- **handleMediaDetail** (TMDB) — `id` = jellyfinId local quand dispo. `mediaStatus: 5` forcé.
- **handleSearch/handleDiscover/handlePersonDetail** — Injection `localId` partout.

### 🔴 Mission 6 : Smart Play séries
- **GET /api/media/next-episode** — Nouvel endpoint. Logique 3 étapes : resume → unplayed → S01E01.
- **SmartButton.jsx** — Pré-fetch next-episode. Bouton affiche `S01E02` au lieu de "LECTURE".
- **MediaDetailView.jsx** — onPlay transmet episodeId au player.

### Fichiers modifiés
- `app/api/[[...path]]/route.js` — ~2835 lignes (+227 vs V0,007)
- `components/dagzflix/SmartButton.jsx` — Smart Play séries
- `components/dagzflix/MediaDetailView.jsx` — Credits TMDB + onPlay episodeId
- `components/dagzflix/SearchView.jsx` — Genre filter TMDB global

### Nouvelles fonctions
- `injectFavoriteStatus(items, userId)` — Injection statut favoris
- `handleNextEpisode(req)` — Smart Play séries
- `TMDB_GENRE_NAME_TO_ID` — Reverse genre map

### Fonctions réécrites
- `getLocalTmdbIds()` : Set → Map
- `handlePersonDetail()` : UUID path 100% TMDB
- `handleMediaDetail()` : credits TMDB systématiques
- `handleMediaStatus()` : cross-réf TMDB → local
- `handleDiscover()` : genre/studio filtering

---

## V0,007 — Système de Favoris

### ❤️ Favoris utilisateur (full-stack)
- **POST /api/media/favorite** — Toggle favori (ajout/suppression), collection MongoDB `favorites`
- **GET /api/media/favorites** — Liste des favoris utilisateur triés par date
- **app/favorites/page.js** — NOUVELLE PAGE : grille "Mes Favoris", état vide animé, compteur
- **MediaCard.jsx** — Bouton cœur overlay (coin haut droit), optimistic UI, animation spring
- **MediaDetailView.jsx** — Composant `FavoriteButton` à côté de SmartButton/TrailerButton
- **Navbar.jsx** — Lien "Favoris" (icône Heart) dans la navigation principale

### Fichiers modifiés
- `app/api/[[...path]]/route.js` — ~2608 lignes (+2 handlers, +2 routes)
- `components/dagzflix/MediaCard.jsx` — Bouton cœur + toggleFavorite
- `components/dagzflix/MediaDetailView.jsx` — FavoriteButton
- `components/dagzflix/Navbar.jsx` — Lien Favoris
- `app/favorites/page.js` — NOUVEAU

### Nouvelle collection MongoDB
- `favorites` : `{userId, itemId, itemData, createdAt}`

---

## V0,006 — Admin, Télémétrie & UX Premium

### 🔴 Mission 1 : Télémétrie + DagzRank V3
- **POST /api/telemetry/click** — Enregistre les clics utilisateur (fire & forget)
- **POST /api/media/rate** — Notation 1-5 étoiles par utilisateur (upsert)
- **GET /api/media/rating** — Récupère la note utilisateur + moyenne globale
- **handleMediaProgress** — Enrichi avec télémétrie watch (cumul temps regardé)
- **DagzRank V3** — Algorithme réécrut : 7 couches de scoring
  - Genres favoris (30 pts), affinité historique (15 pts), note communautaire (15 pts)
  - Fraîcheur (10 pts), bonus télémétrie personnelle (15 pts), bonus collaboratif (15 pts)
  - Pénalités : déjà vu, rejeté, genres détestés
- **loadTelemetryData()** — Agrège les events watch/rate + notes globales depuis MongoDB

### 🔵 Mission 2 : Contrôle Parental + Sécurité
- **Collection MongoDB `users`** — Rôles (admin/adult/child), maxRating, timestamps
- **getUserProfile()** — Récupère le profil utilisateur depuis `users`
- **applyParentalFilter()** — Filtre les contenus selon le rôle enfant
  - Bloque genres Horror/Erotic/Thriller, contenu adulte, certifications R/NC-17/18+
- **handleAuthLogin** — Upsert user profile à la connexion (rôle admin/adult/child)
- **handleAuthSession** — Expose le rôle dans la réponse session
- Filtrage intégré dans : handleSearch, handleDiscover, handleMediaLibrary, handleRecommendations
- **GET /api/admin/users** — Liste tous les utilisateurs (admin-only)
- **POST /api/admin/users/update** — Modifie le rôle d'un utilisateur (admin-only)

### 🟢 Mission 3 : Panneau Admin
- **app/admin/page.js** — Page d'administration complète
  - Table des utilisateurs avec avatar, nom, ID Jellyfin, dernière connexion
  - Sélecteur de rôle (Administrateur/Adulte/Enfant) avec icônes Crown/User/Baby
  - Sauvegarde individuelle avec bouton Save + loader
  - Toast animé (succès/erreur) avec AnimatePresence
  - Stagger animation sur les lignes du tableau
  - Design dark épuré, responsive, cohérent avec DagzFlix
- **auth-context.js** — Route /admin autorisée dans le guard

### 🟡 Mission 4 : UI/UX Premium + Micro-animations
- **MediaCard** — Télémétrie de clic fire & forget, stagger variants (cardVariants)
  - whileTap scale 0.98, animation d'entrée par index
- **MediaDetailView** — Composant StarRating interactif (5 étoiles)
  - Hover preview, clic pour noter, affiche note perso + moyenne globale
  - Stagger animation sur le casting (PersonCards)
- **api.js** — TTLs cache ajoutés : media/rating (30s), admin/users (15s), telemetry (0)

### Fichiers modifiés
- `app/api/[[...path]]/route.js` — ~2500 lignes (nouvelles fonctions + intégrations)
- `components/dagzflix/MediaCard.jsx` — Télémétrie + stagger
- `components/dagzflix/MediaDetailView.jsx` — StarRating + stagger casting
- `app/admin/page.js` — NOUVEAU
- `lib/auth-context.js` — Route admin
- `lib/api.js` — Cache TTLs

---

## Feb 27, 2026 - Major Refactor + Feature Completion

### Completed
- **Codebase Refactoring**: Split monolithic `page.js` (726 lines) into 16 modular files:
  - `lib/api.js` - Cache system + API helpers
  - `lib/constants.js` - Genres, moods, eras, durations
  - 14 component files in `components/dagzflix/`
  - Slim orchestrator `page.js` (~100 lines)

- **Bug Fixes**:
  - Fixed DB_NAME in `.env` (was `your_database_name`, now `dagzflix`)
  - Fixed French character rendering (Unicode escapes → UTF-8)
  - Fixed saga/collection state persistence between navigations (proper state reset)
  - Fixed back button (now uses navigation history stack instead of always returning to dashboard)

- **New Features**:
  - "Continue Watching" row on dashboard (`/api/media/resume` endpoint)
  - Navigation history tracking for smart back button
  - Added `data-testid` attributes to all interactive elements

- **Backend**:
  - Added `/api/media/resume` endpoint for Jellyfin resume items
  - Streaming uses Direct Play URLs (no proxy, no timeout)
  - All 14 backend tests passing

- **Frontend**:
  - Login flow, UI rendering, French text, glassmorphism all verified
  - Responsive design tested on desktop/tablet/mobile

### Previous Work (before refactor)
- Initial MVP with setup wizard, login, dashboard
- All backend API endpoints for Jellyfin/Jellyseerr proxy
- DagzRank recommendation algorithm
- Le Magicien (Wizard) discovery feature
- Smart Button for Play/Request/Pending
- Video Player with Direct Play
- Collection/Saga display
- Client-side caching
