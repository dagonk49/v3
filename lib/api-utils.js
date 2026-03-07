/**
 * lib/api-utils.js — Utilitaires API partagés
 *
 * jsonResponse, validateOrigin, ALLOWED_ORIGIN, getConfig.
 * Utilisés par tous les controllers et le routeur principal.
 */
import { NextResponse } from 'next/server';
import { getDb } from './db';

// ═══ SÉCURITÉ : Origine CORS autorisée (APP_ORIGIN en production) ═══
export const ALLOWED_ORIGIN = process.env.APP_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');

/**
 * Valide l'origine d'une requête pour les headers CORS.
 * En production : n'autorise que APP_ORIGIN (variable d'environnement).
 * En développement : autorise localhost si APP_ORIGIN n'est pas défini.
 * @param {string|null} requestOrigin - Header Origin de la requête
 * @returns {string} Origine validée ou chaîne vide (bloque les requêtes cross-origin)
 */
export function validateOrigin(requestOrigin) {
  if (ALLOWED_ORIGIN && requestOrigin === ALLOWED_ORIGIN) return ALLOWED_ORIGIN;
  if (!ALLOWED_ORIGIN && requestOrigin) {
    if (requestOrigin.startsWith('http://localhost:') || requestOrigin.startsWith('http://127.0.0.1:')) {
      return requestOrigin;
    }
  }
  return ALLOWED_ORIGIN || '';
}

/**
 * Crée une NextResponse JSON avec les headers CORS sécurisés.
 * L'origine autorisée est contrôlée par la variable APP_ORIGIN.
 * @param {Object} data  - Corps de la réponse JSON
 * @param {number} [status=200] - Code HTTP
 * @returns {NextResponse} Réponse prête à être retournée par le handler
 */
export function jsonResponse(data, status = 200) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (ALLOWED_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN;
  }
  return NextResponse.json(data, { status, headers });
}

/**
 * Récupère la configuration principale de DagzFlix depuis MongoDB.
 * Document `config.main` contenant jellyfinUrl, jellyseerrUrl, clés API, etc.
 * @returns {Promise<Object|null>} Document de configuration ou null
 */
export async function getConfig() {
  const db = await getDb();
  return db.collection('config').findOne({ _id: 'main' });
}
