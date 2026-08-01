# What If: History — règles impératives pour les agents

## Principe de base

- Une modification n'est jamais terminée parce que le code compile ou qu'un test ciblé passe.
- Vérifier le résultat concret sur la surface réellement concernée avant toute conclusion.
- Ne jamais annoncer « corrigé », « terminé », « validé » ou un équivalent sans fournir les preuves exécutées pendant la tâche en cours.
- Si une vérification complète est impossible, arrêter la conclusion et indiquer précisément ce qui reste non vérifié.
- Préserver toutes les modifications préexistantes du worktree qui ne font pas partie de la demande.

## Avant de modifier

- Inspecter l'état Git et distinguer les changements préexistants de ceux de la tâche.
- Reproduire le problème sur la vraie route, la vraie API, la vraie base ou le vrai fournisseur concerné lorsque ces éléments sont disponibles.
- Rechercher toutes les sources de vérité avant de corriger une valeur persistée : schéma, migration, valeur par défaut, prompt, fixture, preset, snapshot et données existantes.
- Pour une classe CSS, un composant ou un contrat partagé, inventorier ses consommateurs avant de le modifier.
- Établir un état de référence observable pour les changements graphiques : capture, dimensions, console et interaction concernée.

## Pendant l'implémentation

- Découper les changements transversaux en portes internes : données, moteur, API, LLM, interface, puis intégration.
- Vérifier chaque porte avant de passer à la suivante. Ne pas accumuler toutes les vérifications à la fin.
- Ajouter un test de régression qui échoue avec le défaut initial et passe avec la correction.
- Utiliser `apply_patch` pour les modifications manuelles de fichiers. Réserver les formateurs aux réécritures mécaniques.
- Ne jamais désactiver, contourner ou falsifier un test ou le hook de validation pour obtenir un passage vert.
- Ne jamais utiliser `window.confirm`, `window.alert`, `window.prompt`, `confirm`, `alert`, `prompt` ni leurs variantes `globalThis.*` ou `self.*`. Utiliser une modale intégrée, accessible, traduite, mobile et compatible clair/sombre.

## Validation obligatoire

- Après toute modification, exécuter `npm run verify:task`.
- Cette commande doit réussir sur l'empreinte exacte du worktree livré. Toute modification ultérieure rend la preuve obsolète et impose de relancer la validation.
- `npm run verify:task` exécute au minimum :
  - `git diff --check` ;
  - `npm run check` ;
  - l'intégralité de Playwright lorsque des fichiers applicatifs, des contrats, des tests E2E ou la configuration d'exécution ont changé.
- Un test ciblé sert au diagnostic rapide, mais ne remplace jamais la porte finale.

## Validation graphique obligatoire

Pour toute modification susceptible d'affecter l'interface :

- lancer réellement l'application et ouvrir la route concernée ;
- vérifier le rendu avec le navigateur contrôlé par Codex en bureau et à 390 px de large ;
- inspecter visuellement une capture après modification ;
- vérifier l'absence de chevauchement, débordement, texte coupé, contrôle flottant mal ancré et frontière disproportionnée ;
- cliquer les actions principales et vérifier leur état actif, désactivé, chargement et erreur ;
- vérifier que la console ne contient aucune erreur liée à la modification ;
- contrôler les styles calculés pertinents, pas seulement la présence des éléments dans le DOM ;
- ajouter ou renforcer une assertion Playwright sur la géométrie, la couleur ou le comportement qui a régressé.

Une suite automatisée verte ne suffit pas à déclarer une interface graphiquement valide sans cette inspection rendue.

## Validation du moteur, de l'API et du LLM

- Vérifier les valeurs persistées directement via l'API ou la base lorsque le comportement dépend de l'état.
- Tester les migrations sur une base antérieure représentative et vérifier qu'aucune campagne existante n'est réinitialisée.
- Si le comportement dépend d'un fournisseur LLM réel, compléter les faux fournisseurs par un essai réel non destructif.
- Vérifier que le prompt, le payload fournisseur, la validation serveur et les données persistées utilisent la même date et les mêmes identifiants.
- Une réponse LLM ne doit jamais être considérée comme une preuve de mutation du monde ; vérifier la mutation et sa révision dans le moteur et l'API.

## Compte rendu final

Le compte rendu doit mentionner :

- les fichiers et comportements réellement modifiés ;
- les commandes exécutées et leur résultat exact ;
- le nombre de tests réussis, ignorés et échoués ;
- les routes, dimensions, campagnes ou fournisseurs réellement vérifiés ;
- l'état de la console pour une modification graphique ;
- toute limite ou vérification non réalisée.

Ne jamais remplacer ces preuves par « cela devrait fonctionner ».
