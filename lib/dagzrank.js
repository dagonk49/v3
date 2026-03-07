/**
 * lib/dagzrank.js — DagzRank V3 & Filtre Parental
 *
 * Algorithme de scoring personnalisé, chargement télémétrie,
 * filtre parental (RBAC enfants).
 */
import { getDb } from './db';
import { resolveGenres, contentIdFromItem } from './media-mappers';

/**
 * Liste des genres interdits aux profils "child".
 * Les items contenant l'un de ces genres seront filtrés.
 * @type {string[]}
 */
export const CHILD_BLOCKED_GENRES = ['Horror', 'Horreur', 'Erotic', 'Érotique', 'Thriller'];

/**
 * Ratings autorisés pour les profils "child" (PG-13 et en dessous).
 * Si un item a un officialRating non listé ici, il sera masqué pour les enfants.
 * Un item sans rating est autorisé par défaut.
 * @type {Set<string>}
 */
const CHILD_ALLOWED_RATINGS = new Set([
  '', 'G', 'PG', 'PG-13', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG',
  'Tout public', 'U', 'NR', 'Not Rated',
]);

/**
 * Filtre parental : exclut les contenus inadaptés aux enfants.
 * Vérifie les genres (Horreur, Érotique), le flag Adult, et l'OfficialRating.
 * @param {Object[]} items - Liste d'items DagzFlix
 * @param {Object} userProfile - Profil utilisateur {role, maxRating}
 * @returns {Object[]} Items filtrés (inchangés si rôle != 'child')
 */
export function applyParentalFilter(items, userProfile) {
  try {
    if (!items?.length) return items || [];
    if (!userProfile || userProfile.role !== 'child') return items;
    return items.filter(item => {
      // Exclure les contenus marqués Adult
      if (item.adult === true || item.Adult === true) return false;
      // Exclure les genres interdits
      const itemGenres = resolveGenres(item);
      const blockedLower = CHILD_BLOCKED_GENRES.map(g => g.toLowerCase());
      if (itemGenres.some(g => blockedLower.includes(g.toLowerCase()))) return false;
      // Exclure les ratings au-dessus de PG-13
      const rating = item.officialRating || item.OfficialRating || '';
      if (rating && !CHILD_ALLOWED_RATINGS.has(rating)) return false;
      return true;
    });
  } catch (_) {
    return items || [];
  }
}

/**
 * DagzRank V3 — Calcule le score d'un item (0-100) via télémétrie + préférences.
 *
 * Scoring multicouche :
 *  1. Genres favoris vs genres de l'item : jusqu'à 30 pts
 *  2. Affinité historique (genres des items vus) : jusqu'à 15 pts
 *  3. Note communautaire (communityRating/10) : jusqu'à 15 pts
 *  4. Fraîcheur (année de sortie) : jusqu'à 10 pts
 *  5. Bonus télémétrie personnelle (watch/rate du même genre/réalisateur) : jusqu'à 15 pts
 *  6. Bonus collaboratif (moyenne des notes de tous les utilisateurs) : jusqu'à 15 pts
 *  7. Pénalités : déjà vu (-50), rejeté (-60), genres détestés (-25)
 *
 * @param {Object} item - Item à scorer (genres, communityRating, year, isPlayed...)
 * @param {Object|null} preferences - Préférences utilisateur {favoriteGenres, dislikedGenres, rejectedGenres, rejectedContentIds}
 * @param {Array} watchHistory - Historique de visionnage [{id, genres}]
 * @param {Object} [telemetryData=null] - Données télémétrie {userEvents: [{action,itemId,value,genres}], globalRatings: {itemId: avgRating}}
 * @returns {number} Score DagzRank arrondi entre 0 et 100
 */
export function calculateDagzRank(item, preferences, watchHistory, telemetryData = null) {
  // V7.6 : Base score de 25 pts pour que tout item neutre démarre à ~50%
  let score = 25;
  const itemGenres = resolveGenres(item);
  const favGenres = preferences?.favoriteGenres || [];
  const dislikedGenres = preferences?.dislikedGenres || [];
  const rejectedGenres = preferences?.rejectedGenres || [];
  const rejectedContentIds = preferences?.rejectedContentIds || [];

  // ── 1) Genre preference match (max 25 pts) ──
  if (itemGenres.length > 0 && favGenres.length > 0) {
    const normalizedFav = favGenres.map(g => g.toLowerCase());
    const normalizedDislike = dislikedGenres.map(g => g.toLowerCase());
    const matchCount = itemGenres.filter(g => normalizedFav.includes(g.toLowerCase())).length;
    const dislikeCount = itemGenres.filter(g => normalizedDislike.includes(g.toLowerCase())).length;
    const genreScore = (matchCount / Math.max(itemGenres.length, 1)) * 25;
    const dislikePenalty = (dislikeCount / Math.max(itemGenres.length, 1)) * 10;
    score += Math.max(0, genreScore - dislikePenalty);
  } else {
    score += 8;
  }

  // ── 2) Watch history affinity (max 10 pts) ──
  if (watchHistory && watchHistory.length > 0) {
    const historyGenres = {};
    watchHistory.forEach(h => {
      (h.genres || []).forEach(g => {
        const key = g.toLowerCase();
        historyGenres[key] = (historyGenres[key] || 0) + 1;
      });
    });
    const maxCount = Math.max(...Object.values(historyGenres), 1);
    let affinityScore = 0;
    itemGenres.forEach(g => {
      const key = g.toLowerCase();
      if (historyGenres[key]) {
        affinityScore += (historyGenres[key] / maxCount) * 10;
      }
    });
    score += Math.min(10, affinityScore / Math.max(itemGenres.length, 1) * itemGenres.length);
  } else {
    score += 5;
  }

  // ── 3) Community rating (max 15 pts) ──
  const rating = item.communityRating || item.CommunityRating || item.voteAverage || 0;
  score += (rating / 10) * 15;

  // ── 4) Freshness / year bonus (max 10 pts) — V0.009 : pondéré par genre ──
  const year = item.year || item.ProductionYear || 0;
  const currentYear = new Date().getFullYear();
  if (year) {
    const age = currentYear - parseInt(year, 10);
    // V0.009 : Les genres « intemporels » (Documentaire, Classique, History, Western…)
    // ne sont PAS pénalisés par l'âge — l'ancienneté est même un atout.
    const timelessGenres = ['documentary', 'documentaire', 'history', 'histoire', 'classic', 'classique', 'war', 'guerre', 'western'];
    const itemGenresLower = itemGenres.map(g => g.toLowerCase());
    const isTimeless = itemGenresLower.some(g => timelessGenres.includes(g));
    const favGenresLower = (preferences?.favoriteGenres || []).map(g => g.toLowerCase());
    const userLikesTimeless = favGenresLower.some(g => timelessGenres.includes(g));

    if (isTimeless && (userLikesTimeless || age > 10)) {
      // Genre intemporel + utilisateur fan ou film ancien : score stable
      score += 7;
    } else if (isTimeless) {
      // Genre intemporel, utilisateur neutre : léger bonus décroissant
      score += Math.max(4, 10 - Math.floor(age / 5));
    } else {
      // Scoring classique pour les genres standard
      if (age <= 1) score += 10;
      else if (age <= 3) score += 7;
      else if (age <= 5) score += 4;
      else if (age <= 10) score += 2;
    }
  }

  // ── 5) Personal telemetry bonus (max 10 pts, 5 pts neutral si pas de data) ──
  if (telemetryData?.userEvents?.length > 0) {
    const userEvents = telemetryData.userEvents;
    const telGenres = {};
    for (const ev of userEvents) {
      const evGenres = ev.genres || [];
      if (ev.action === 'watch' && ev.value > 300) {
        evGenres.forEach(g => {
          const key = g.toLowerCase();
          telGenres[key] = (telGenres[key] || 0) + Math.min(ev.value / 3600, 3);
        });
      }
      if (ev.action === 'rate' && ev.value >= 4) {
        evGenres.forEach(g => {
          const key = g.toLowerCase();
          telGenres[key] = (telGenres[key] || 0) + ev.value;
        });
      }
    }
    if (Object.keys(telGenres).length > 0) {
      const maxTelGenre = Math.max(...Object.values(telGenres), 1);
      let telBonus = 0;
      itemGenres.forEach(g => {
        const key = g.toLowerCase();
        if (telGenres[key]) {
          telBonus += (telGenres[key] / maxTelGenre) * 10;
        }
      });
      score += Math.min(10, telBonus / Math.max(itemGenres.length, 1) * itemGenres.length);
    } else {
      score += 5; // V7.6 : pas de pénalité si pas de données pertinentes
    }
  } else {
    score += 5; // V7.6 : neutre si pas de télémétrie
  }

  // ── 6) Collaborative rating bonus (max 10 pts, 5 pts neutral si pas de data) ──
  if (telemetryData?.globalRatings) {
    const itemContentId = contentIdFromItem(item);
    const globalAvg = itemContentId ? telemetryData.globalRatings[itemContentId] : null;
    if (globalAvg && globalAvg > 0) {
      score += Math.min(10, (globalAvg / 5) * 10 * (globalAvg >= 4 ? 1.2 : 1));
    } else {
      score += 5; // V7.6 : neutre si pas de note globale
    }
  } else {
    score += 5; // V7.6 : neutre si pas de télémétrie
  }

  // ── 7) Penalties ──
  // V7.6 : pénalité déjà vu réduite (-30 au lieu de -50)
  if (item.isPlayed) {
    score = Math.max(0, score - 30);
  }

  const itemContentId = contentIdFromItem(item);
  if (itemContentId && rejectedContentIds.includes(itemContentId)) {
    score = Math.max(0, score - 60);
  }

  if (rejectedGenres.length > 0 && itemGenres.length > 0) {
    const normalizedRejected = rejectedGenres.map(g => g.toLowerCase());
    const rejectedOverlap = itemGenres.filter(g => normalizedRejected.includes(g.toLowerCase())).length;
    if (rejectedOverlap > 0) {
      score = Math.max(0, score - Math.min(20, rejectedOverlap * 6));
    }
  }

  return Math.min(100, Math.round(score));
}

/**
 * Charge les données de télémétrie pour le scoring DagzRank V3.
 * Récupère les événements de l'utilisateur (watch, rate) et les notes globales.
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<Object>} {userEvents: [...], globalRatings: {contentId: avgRating}}
 */
export async function loadTelemetryData(userId) {
  const db = await getDb();
  const telemetry = db.collection('telemetry');

  // User's personal events (watch + rate with genres) — last 200 for performance
  const userEvents = await telemetry
    .find({ userId, action: { $in: ['watch', 'rate'] } })
    .sort({ timestamp: -1 })
    .limit(200)
    .toArray();

  // Global average ratings aggregation — top rated items
  const globalAgg = await telemetry
    .aggregate([
      { $match: { action: 'rate' } },
      { $group: { _id: '$itemId', avgRating: { $avg: '$value' }, count: { $sum: 1 } } },
      { $match: { count: { $gte: 2 } } }, // Only items with 2+ ratings
      { $sort: { avgRating: -1 } },
      { $limit: 500 },
    ])
    .toArray();

  const globalRatings = {};
  for (const g of globalAgg) {
    globalRatings[g._id] = g.avgRating;
  }

  return { userEvents, globalRatings };
}
