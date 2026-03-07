/**
 * lib/db.js — MongoDB Connection Pool & Zod Schemas
 *
 * Gère la connexion MongoDB via le pattern global._mongoClientPromise
 * (réutilisation cross-HMR en dev, singleton en production).
 * Exporte aussi les schémas Zod pour la validation d'entrée.
 */
import { MongoClient } from 'mongodb';
import { z } from 'zod';

// ═══ MongoDB Connection Pool (pattern officiel Next.js / Serverless) ═══
const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME || 'dagzflix';

/** @type {Promise<import('mongodb').MongoClient>|undefined} */
let clientPromise;

if (MONGO_URL) {
  if (process.env.NODE_ENV === 'development') {
    // En dev : réutilise le client cross-HMR via global._mongoClientPromise
    if (!global._mongoClientPromise) {
      const client = new MongoClient(MONGO_URL, { maxPoolSize: 10 });
      global._mongoClientPromise = client.connect();
    }
    clientPromise = global._mongoClientPromise;
  } else {
    // En production : une seule instance par processus (pool partagé)
    const client = new MongoClient(MONGO_URL, { maxPoolSize: 10 });
    clientPromise = client.connect();
  }
}

/**
 * Retourne une instance de la base MongoDB via le pool de connexions.
 * Utilise le pattern global._mongoClientPromise pour réutiliser le client
 * entre les requêtes en mode développement (HMR) et production.
 * @returns {Promise<import('mongodb').Db>} Instance de la base de données
 * @throws {Error} Si MONGO_URL n'est pas défini dans les variables d'environnement
 */
export async function getDb() {
  if (!MONGO_URL || !clientPromise) {
    throw new Error('MONGO_URL manquante dans les variables d\'environnement');
  }
  const client = await clientPromise;
  return client.db(DB_NAME);
}

// ═══ Schémas Zod — prévention injection NoSQL ═══
export const alphanumericId = z.string().regex(/^[a-zA-Z0-9_.-]+$/, 'ID invalide (caractères alphanumériques, _, -, . uniquement)').max(128);

export const FavoriteToggleSchema = z.object({
  itemId: alphanumericId,
  itemData: z.record(z.unknown()).optional(),
});

export const WizardFeedbackSchema = z.object({
  action: z.string().max(20),
  itemId: alphanumericId.optional(),
  tmdbId: alphanumericId.optional(),
  genres: z.array(z.string().max(50)).max(10).optional(),
});

export const MediaRateSchema = z.object({
  itemId: alphanumericId,
  value: z.union([z.number().int().min(1).max(5), z.string().regex(/^[1-5]$/)]),
  genres: z.array(z.string().max(50)).max(10).optional(),
});
