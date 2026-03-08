/**
 * controllers/user.controller.js — Favoris, préférences, télémétrie, notes, wizard feedback.
 *
 * handleMediaFavoriteToggle, handleMediaFavoritesGet,
 * handlePreferencesGet, handlePreferencesSave,
 * handleTelemetryClick, handleMediaRate, handleMediaRatingGet,
 * handleWizardFeedback.
 */
import { getDb, FavoriteToggleSchema, WizardFeedbackSchema, MediaRateSchema } from '@/lib/db';
import { jsonResponse } from '@/lib/api-utils';
import { getSession } from '@/lib/auth-helpers';
import { normalizeContentId } from '@/lib/media-mappers';

/**
 * POST /api/media/favorite
 */
export async function handleMediaFavoriteToggle(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  let rawBody;
  try { rawBody = await req.json(); } catch (_) { return jsonResponse({ error: 'Body JSON invalide' }, 400); }
  const parsed = FavoriteToggleSchema.safeParse(rawBody);
  if (!parsed.success) return jsonResponse({ error: 'Données invalides', details: parsed.error.flatten() }, 400);
  const { itemId, itemData } = parsed.data;

  const db = await getDb();
  const filter = { userId: session.userId, itemId: String(itemId) };

  // Check if it already exists
  const existing = await db.collection('favorites').findOne(filter);

  if (existing) {
    // Remove if exists (toggle off)
    await db.collection('favorites').deleteOne(filter);
    return jsonResponse({ success: true, isFavorite: false });
  } else {
    // Add if it doesn't exist (toggle on)
    await db.collection('favorites').insertOne({
      ...filter,
      itemData,
      createdAt: new Date()
    });
    return jsonResponse({ success: true, isFavorite: true });
  }
}

/**
 * GET /api/media/favorites
 */
export async function handleMediaFavoritesGet(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const db = await getDb();
  const favorites = await db.collection('favorites')
    .find({ userId: session.userId })
    .sort({ createdAt: -1 })
    .toArray();

  // Robuste : inclure les docs avec itemData OU construire un minimum depuis itemId
  const items = favorites
    .map(f => {
      if (f.itemData && typeof f.itemData === 'object' && (f.itemData.id || f.itemData.tmdbId || f.itemData.name)) {
        return f.itemData;
      }
      // Fallback pour les anciens docs sans itemData complète
      if (f.itemId) {
        return { id: f.itemId, name: `Media #${f.itemId}`, type: 'unknown', isFavorite: true };
      }
      return null;
    })
    .filter(Boolean);

  return jsonResponse({ items });
}

/**
 * GET /api/preferences
 */
export async function handlePreferencesGet(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const db = await getDb();
  const prefs = await db.collection('preferences').findOne({ userId: session.userId });
  return jsonResponse({ preferences: prefs || {} });
}

/**
 * POST /api/preferences
 */
export async function handlePreferencesSave(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const { favoriteGenres, dislikedGenres } = await req.json();
  const db = await getDb();
  await db.collection('preferences').updateOne(
    { userId: session.userId },
    {
      $set: {
        userId: session.userId,
        favoriteGenres: favoriteGenres || [],
        dislikedGenres: dislikedGenres || [],
        onboardingComplete: true,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  return jsonResponse({ success: true });
}

/**
 * POST /api/telemetry/click
 */
export async function handleTelemetryClick(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const { itemId, title, posterUrl, type, genres } = await req.json();
  if (!itemId) return jsonResponse({ error: 'itemId requis' }, 400);

  const db = await getDb();
  await db.collection('telemetry').insertOne({
    userId: session.userId,
    itemId: String(itemId),
    action: 'click',
    value: 1,
    title: title || '',
    posterUrl: posterUrl || '',
    mediaType: type || '',
    genres: genres || [],
    timestamp: new Date(),
  });

  return jsonResponse({ success: true });
}

/**
 * POST /api/media/rate
 */
export async function handleMediaRate(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  let rawBody;
  try { rawBody = await req.json(); } catch (_) { return jsonResponse({ error: 'Body JSON invalide' }, 400); }
  const parsed = MediaRateSchema.safeParse(rawBody);
  if (!parsed.success) return jsonResponse({ error: 'Données invalides', details: parsed.error.flatten() }, 400);
  const { itemId, value, genres } = parsed.data;
  const rating = Math.max(1, Math.min(5, parseInt(value, 10) || 0));
  if (!rating) return jsonResponse({ error: 'Note entre 1 et 5 requise' }, 400);

  const db = await getDb();
  await db.collection('telemetry').updateOne(
    { userId: session.userId, itemId: String(itemId), action: 'rate' },
    { $set: { value: rating, genres: genres || [], timestamp: new Date() } },
    { upsert: true }
  );

  return jsonResponse({ success: true, value: rating });
}

/**
 * GET /api/media/rating?id={itemId}
 */
export async function handleMediaRatingGet(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const itemId = new URL(req.url).searchParams.get('id');
  if (!itemId) return jsonResponse({ error: 'id requis' }, 400);

  const db = await getDb();
  const userRating = await db.collection('telemetry').findOne({
    userId: session.userId,
    itemId: String(itemId),
    action: 'rate',
  });

  const globalAgg = await db.collection('telemetry').aggregate([
    { $match: { itemId: String(itemId), action: 'rate' } },
    { $group: { _id: null, avg: { $avg: '$value' }, count: { $sum: 1 } } },
  ]).toArray();

  return jsonResponse({
    rating: userRating?.value || null,
    globalAverage: globalAgg[0]?.avg ? Math.round(globalAgg[0].avg * 10) / 10 : null,
    totalRatings: globalAgg[0]?.count || 0,
  });
}

/**
 * POST /api/wizard/feedback
 */
export async function handleWizardFeedback(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  let rawBody;
  try { rawBody = await req.json(); } catch (_) { return jsonResponse({ error: 'Body JSON invalide' }, 400); }
  const parsed = WizardFeedbackSchema.safeParse(rawBody);
  if (!parsed.success) return jsonResponse({ error: 'Données invalides', details: parsed.error.flatten() }, 400);
  const { action, itemId, tmdbId, genres = [] } = parsed.data;
  if (!action || action !== 'reject') return jsonResponse({ success: true });

  const contentId = normalizeContentId(tmdbId || itemId);
  if (!contentId) return jsonResponse({ success: false, error: 'ID contenu requis' }, 400);

  const cleanGenres = (genres || []).filter(Boolean).slice(0, 10);
  const db = await getDb();
  await db.collection('preferences').updateOne(
    { userId: session.userId },
    {
      $setOnInsert: { userId: session.userId, onboardingComplete: false },
      $addToSet: {
        rejectedContentIds: contentId,
        rejectedGenres: { $each: cleanGenres },
      },
      $set: { updatedAt: new Date() },
    },
    { upsert: true }
  );

  return jsonResponse({ success: true });
}
