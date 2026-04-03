# DagzFlix - VideoPlayer.jsx Refactoring PRD

## Problem Statement
Refactoring de la logique interne de `VideoPlayer.jsx` pour exploiter pleinement le flux HLS renvoyé par le backend Jellyfin, avec sélection automatique intelligente des langues (VFF → VFQ → VOSTFR) et gestion de l'Adaptive Bitrate (ABR).

## Architecture
- **Stack** : Next.js + React + HLS.js + Framer Motion + Tailwind CSS
- **Backend** : Jellyfin server (jellyfin.dagz.fr) fournissant des flux HLS master.m3u8
- **Composant cible** : `components/dagzflix/VideoPlayer.jsx`
- **API Layer** : `lib/api.js` (cache double couche Map + sessionStorage)

## User Persona
- Utilisateur francophone consommant du contenu vidéo via DagzFlix
- Préférence : VFF (France) > VFQ (Québec) > VOSTFR (sous-titres FR)

## Core Requirements (Static)
1. ABR optimisé via HLS.js (EWMA algorithm, conservative bandwidth estimation)
2. Sélection automatique audio FR en cascade : VFF → VFQ → FR générique
3. Fallback VOSTFR : activation automatique des sous-titres FR si pas d'audio FR
4. UI inchangée (Tailwind, Framer Motion, contrôles tactiles)
5. Code complet, commenté abondamment en français

## What's Been Implemented (2026-04-03)
- [x] Fonctions utilitaires de détection linguistique (isFrenchTrack, isVFF, isVFQ)
- [x] Configuration HLS.js ABR optimisée (abrEwmaDefaultEstimate, abrBandWidthFactor, etc.)
- [x] Algorithme cascade executerSelectionAutomatique (VFF → VFQ → FR → VOSTFR)
- [x] Fonction appliquerSelectionSousTitres avec retry automatique
- [x] Ref autoLangApplied pour empêcher les re-sélections après choix manuel
- [x] Écoute de MANIFEST_PARSED, AUDIO_TRACKS_UPDATED, SUBTITLE_TRACKS_UPDATED
- [x] UseEffect de secours pour Safari natif et métadonnées backend
- [x] Tests statiques passés à 100%

## Prioritized Backlog
- P0: (done) ABR + Sélection automatique langue
- P1: Persistance du choix de langue utilisateur (localStorage)
- P2: Indicateur visuel du niveau de qualité ABR actuel dans l'UI
- P2: Sélection manuelle de la qualité vidéo (override ABR)

## Next Tasks
- Intégrer le fichier mis à jour dans le projet Next.js de production
- Tester avec des flux réels multi-audio (VFF + VFQ + VO)
- Ajouter un indicateur de qualité dans les contrôles du lecteur
