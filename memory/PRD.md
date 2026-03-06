# DagzFlix - Product Requirements Document

## Original Problem Statement
DagzFlix is a unified web application that acts as a smart front-end for existing Jellyfin and Jellyseerr servers. The goal is a single, seamless interface for browsing, watching, and requesting media.

## Architecture
- **Stack**: Next.js 14 (App Router) with BFF (Backend-For-Frontend) pattern
- **Backend**: Single catch-all API route (`/api/[[...path]]/route.js`) proxying to Jellyfin/Jellyseerr
- **Database**: MongoDB for config, sessions, and user preferences
- **Frontend**: React SPA with client-side routing, Shadcn/UI + TailwindCSS + Framer Motion
- **Auth**: Proxy-based login via Jellyfin credentials → HTTP-Only cookie sessions
- **Streaming**: Direct Play URLs (browser → Jellyfin directly, no proxy)

## Core Features
1. **Setup Wizard** - 3-step config for Jellyfin/Jellyseerr URLs and API keys
2. **Proxy Authentication** - Login via Jellyfin, local session management
3. **Genre Onboarding** - Favorite/disliked genre selection for DagzRank
4. **Dashboard** - Hero section, Continue Watching, recommendations, recent items, trending
5. **Movies/Series Pages** - 4 tabs: Library, Search, DagzRank, Le Magicien
6. **Media Detail** - Backdrop, poster, metadata, seasons/episodes, collections/sagas, similar items
7. **Smart Button** - Dynamic Play/Request/Pending based on Jellyfin+Jellyseerr status
8. **DagzRank Algorithm** - Recommendation scoring (genres, watch history, ratings, freshness)
9. **Le Magicien (Wizard)** - Interactive 3-step discovery (mood→era→duration)
10. **Video Player** - Direct Play with subtitle/audio selection, seek, volume, fullscreen
11. **Trailers** - YouTube embed from Jellyfin RemoteTrailers or Jellyseerr/TMDB
12. **Collections/Sagas** - Movie collection display from Jellyfin BoxSets or TMDB
13. **Continue Watching** - Resume items from Jellyfin watch history
14. **Client-side Cache** - TTL-based caching to reduce server load

## Implemented (Feb 2026)
- [x] All backend API endpoints (setup, auth, media, search, discover, recommendations, wizard, proxy, resume)
- [x] Setup wizard (3-step)
- [x] Login with Jellyfin proxy auth
- [x] Genre onboarding
- [x] Dashboard with hero, media rows
- [x] Movies/Series pages with 4 tabs
- [x] Le Magicien (Wizard) interactive discovery
- [x] Media detail with seasons/episodes/collections
- [x] Smart Button (Play/Request/Pending)
- [x] Video Player with Direct Play URLs
- [x] Trailer button with YouTube embed
- [x] Collection/Saga display
- [x] Continue Watching (resume endpoint)
- [x] Client-side caching system
- [x] Navigation history (smart back button)
- [x] Codebase refactored into modular components
- [x] DB_NAME fixed in .env
- [x] French character rendering fixed (UTF-8)

## File Structure
```
/app
├── app/
│   ├── api/[[...path]]/route.js    # BFF: All backend logic
│   ├── page.js                     # Main app orchestrator (slim)
│   ├── layout.js                   # Root layout
│   └── globals.css                 # Glassmorphism + animations
├── components/
│   ├── dagzflix/                    # App-specific components
│   │   ├── LoadingScreen.jsx
│   │   ├── SetupView.jsx
│   │   ├── LoginView.jsx
│   │   ├── OnboardingView.jsx
│   │   ├── Navbar.jsx
│   │   ├── MediaCard.jsx           # + MediaRow
│   │   ├── HeroSection.jsx
│   │   ├── SmartButton.jsx         # + TrailerButton
│   │   ├── VideoPlayer.jsx
│   │   ├── MediaDetailView.jsx     # + EpisodeCard
│   │   ├── WizardView.jsx
│   │   ├── MediaTypePage.jsx
│   │   ├── SearchView.jsx
│   │   └── DashboardView.jsx
│   └── ui/                         # Shadcn UI components
├── lib/
│   ├── api.js                      # Cache + API helpers
│   ├── constants.js                # Genres, moods, eras, durations
│   └── utils.js                    # TailwindCSS merge utility
└── .env                            # MONGO_URL, DB_NAME=dagzflix
```

## P0 - Done
All core features implemented and tested.

## P1 - Future Improvements
- Performance monitoring (request analytics)
- Mobile-optimized video player controls
- Keyboard shortcuts for player
- Watch progress sync back to Jellyfin

## P2 - Nice to Have
- Multi-user profiles
- Custom watchlists
- Notification system for completed requests
- PWA support for mobile
