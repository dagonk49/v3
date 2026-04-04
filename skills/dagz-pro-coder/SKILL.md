\---

name: dagz-pro-coder

description: À utiliser pour le développement de Dagzflix V3. Force un standard de code professionnel, sécurisé, modulaire et tracé par des logs.

\---



\# Instructions Dagz Pro Coder - V3



\## 1. Code Limpide \& Explicite

\- \*\*Zéro Abréviation\*\* : Interdiction d'utiliser des noms courts (`err`, `el`, `fn`). Utilise `error`, `element`, `function`.

\- \*\*Commentaires Didactiques\*\* : Chaque bloc de logique complexe doit être expliqué en français. On doit comprendre le "pourquoi" avant le "comment".

\- \*\*Zéro Raccourci\*\* : Ne jamais omettre de code. Si un fichier change, réécris le bloc complet ou le fichier pour garantir l'intégrité.



\## 2. Sécurité Maximale (Production Ready)

\- \*\*Validation des Entrées\*\* : Utilise systématiquement des schémas (type Zod) pour valider les données venant de l'utilisateur ou d'API externes.

\- \*\*Protection XSS/CSRF\*\* : Applique les meilleures pratiques Next.js pour l'assainissement des données.

\- \*\*Gestion des Secrets\*\* : Ne jamais coder en dur une clé API ou un identifiant. Utilise exclusivement les variables d'environnement (`process.env`).

\- \*\*Principe du moindre privilège\*\* : Chaque fonction ne doit avoir accès qu'aux données strictement nécessaires.



\## 3. Architecture Modulaire (Découpage)

\- \*\*Principe de Responsabilité Unique\*\* : Si une fonction ou un composant dépasse 100 lignes, il doit être découpé.

\- \*\*Fichiers Séparés\*\* : N'hésite pas à créer des sous-fichiers dans `/components` ou des utilitaires dans `/lib` pour garder les fichiers principaux propres.

\- \*\*Clean Code\*\* : Préfère la lisibilité à la concision. Un code de 10 lignes clair est meilleur qu'un code de 3 lignes complexe.



\## 4. Tris \& Logs (Observabilité)

\- \*\*Logging Systématique\*\* : Ajoute des logs (`console.log` ou un logger dédié) pour chaque étape clé :

&#x20;   - Début/Fin de requête API.

&#x20;   - Erreurs interceptées (avec détails sans exposer de données sensibles).

&#x20;   - Actions critiques de l'utilisateur (connexion, changement de réglages).

\- \*\*Format des Logs\*\* : `\[NOM\_DU\_MODULE]\[TYPE\_D\_ACTION] Message explicite - \[TIMESTAMP]`.



\## 5. Finition Professionnelle

\- \*\*Gestion des erreurs (Error Boundaries)\*\* : Toujours prévoir un état de repli (fallback) si un composant plante.

\- \*\*Loading States\*\* : Chaque action asynchrone doit avoir un retour visuel (Skeleton ou Spinner).

\- \*\*TypeScript (si applicable)\*\* : Typage strict pour éviter les bugs silencieux.

