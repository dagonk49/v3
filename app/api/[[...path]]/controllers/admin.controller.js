/**
 * controllers/admin.controller.js — Admin & Télémétrie Admin
 *
 * handleAdminUsers, handleAdminUsersUpdate, handleAdminTelemetry, handleAdminUserStats.
 */
import { getDb } from '@/lib/db';
import { jsonResponse } from '@/lib/api-utils';
import { requireAdmin } from '@/lib/auth-helpers';

/**
 * GET /api/admin/users
 * Retourne la liste de tous les utilisateurs (admin uniquement).
 * Inclut le rôle, le nom, la dernière connexion.
 * @param {Request} req - Session requise, rôle admin requis
 * @returns {Object} {users: [{userId, username, role, maxRating, lastLogin, createdAt}]}
 */
export async function handleAdminUsers(req) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;
  const { session } = auth;

  const db = await getDb();
  const users = await db.collection('users').find({}).sort({ lastLogin: -1 }).toArray();

  return jsonResponse({
    users: users.map(u => ({
      userId: u.userId,
      username: u.username || 'Inconnu',
      role: u.role || 'adult',
      maxRating: u.maxRating || '',
      lastLogin: u.lastLogin || u.createdAt,
      createdAt: u.createdAt,
    })),
  });
}

/**
 * POST /api/admin/users/update
 * Met à jour le rôle d'un utilisateur (admin uniquement).
 * @param {Request} req - Body JSON {userId, role: 'admin'|'adult'|'child', maxRating?: string}
 * @returns {Object} {success: true, updated: {userId, role}}
 */
export async function handleAdminUsersUpdate(req) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { userId, role, maxRating } = await req.json();
  if (!userId || !role) return jsonResponse({ error: 'userId et role requis' }, 400);

  const validRoles = ['admin', 'adult', 'child'];
  if (!validRoles.includes(role)) {
    return jsonResponse({ error: `Rôle invalide. Valeurs autorisées : ${validRoles.join(', ')}` }, 400);
  }

  const db = await getDb();
  const result = await db.collection('users').updateOne(
    { userId },
    { $set: { role, maxRating: maxRating || '', updatedAt: new Date() } }
  );

  if (result.matchedCount === 0) {
    return jsonResponse({ error: 'Utilisateur non trouvé' }, 404);
  }

  return jsonResponse({ success: true, updated: { userId, role } });
}

/**
 * GET /api/admin/telemetry
 * Retourne les statistiques agrégées de télémétrie (admin uniquement).
 * Inclut la ventilation par action et les 50 événements les plus récents.
 * @param {Request} req - Session requise, rôle admin requis
 * @returns {Object} {totalEvents, actionBreakdown, recentEvents}
 */
export async function handleAdminTelemetry(req) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    const db = await getDb();
    const totalEvents = await db.collection('telemetry').countDocuments();
    const actionCounts = await db.collection('telemetry').aggregate([
      { $group: { _id: '$action', count: { $sum: 1 } } },
    ]).toArray();
    const recentEvents = await db.collection('telemetry')
      .find({})
      .sort({ timestamp: -1 })
      .limit(50)
      .project({ userId: 1, action: 1, itemId: 1, value: 1, timestamp: 1 })
      .toArray();

    // ── Top 10 médias les plus consultés (clics agrégés) ──
    const topClicked = await db.collection('telemetry').aggregate([
      { $match: { action: 'click' } },
      {
        $group: {
          _id: '$itemId',
          clicks: { $sum: 1 },
          title: { $last: '$title' },
          posterUrl: { $last: '$posterUrl' },
          mediaType: { $last: '$mediaType' },
          lastClick: { $max: '$timestamp' },
        },
      },
      { $sort: { clicks: -1 } },
      { $limit: 10 },
      {
        $project: {
          _id: 0,
          itemId: '$_id',
          clicks: 1,
          title: 1,
          posterUrl: 1,
          mediaType: 1,
          lastClick: 1,
        },
      },
    ]).toArray();

    return jsonResponse({
      totalEvents,
      actionBreakdown: Object.fromEntries(actionCounts.map(a => [a._id, a.count])),
      recentEvents,
      topClicked,
    });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

/**
 * GET /api/admin/user-stats?userId={userId}
 * V0.010 Mission 4 — Renvoie les statistiques détaillées d'un utilisateur :
 * temps de visionnage total, genres favoris, activité récente, nombre de favoris.
 * @param {Request} req
 * @returns {Object} {totalWatchSeconds, favoriteGenres[], recentActivity[], favoritesCount}
 */
export async function handleAdminUserStats(req) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const userId = new URL(req.url).searchParams.get('userId');
  if (!userId) return jsonResponse({ error: 'userId requis' }, 400);

  try {
    const db = await getDb();

    // Total watch time (seconds) from telemetry
    const watchDocs = await db.collection('telemetry')
      .find({ userId, action: 'watch' })
      .project({ value: 1 })
      .toArray();
    const totalWatchSeconds = watchDocs.reduce((sum, d) => sum + (d.value || 0), 0);

    // Favorite genres from preferences
    const prefs = await db.collection('preferences').findOne({ userId });
    const favoriteGenres = prefs?.genres || [];

    // Recent activity (last 30 events for this user)
    const recentActivity = await db.collection('telemetry')
      .find({ userId })
      .sort({ timestamp: -1 })
      .limit(30)
      .project({ action: 1, itemId: 1, value: 1, timestamp: 1 })
      .toArray();

    // Favorites count
    const favoritesCount = await db.collection('favorites').countDocuments({ userId });

    return jsonResponse({
      totalWatchSeconds,
      favoriteGenres,
      recentActivity,
      favoritesCount,
    });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
