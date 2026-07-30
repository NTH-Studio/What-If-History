# What If: History — plan d’exécution des lots 0 à 4

Ce document transforme le wiki public de What If: History en objectifs concrets pour l’édition
locale. Le wiki sert de catalogue fonctionnel ; les comportements retenus ici privilégient une
simulation solo robuste, une interface premium et des données locales maîtrisables.

## Principes communs

- Aucun dialogue JavaScript natif : toutes les confirmations utilisent les composants intégrés.
- Chaque mutation importante est transactionnelle et vérifiable.
- Les campagnes existantes doivent survivre aux migrations.
- Les écrans sont utilisables en français et en anglais, au clavier, sur mobile et dans les thèmes
  clair/sombre.
- Les sorties IA restent validées par des schémas stricts avant toute écriture.
- Les fonctionnalités avancées sont exposées progressivement, avec des valeurs par défaut sûres.

## Lot 0 — socle, qualité et direction produit

### Objectif

Disposer d’une base stable, documentée et mesurable avant d’étendre le modèle de jeu.

### Livrables

- Plans des lots 0 à 4 et critères d’acceptation.
- Migration SQLite additive et tests de non-régression.
- Contrats partagés pour les nouveaux systèmes.
- Garde automatique contre les dialogues natifs et le HTML React brut.
- Contrôle complet : format, lint, types, tests, build et audit.
- Navigation et composants visuels réutilisables pour les écrans avancés.

### Critères d’acceptation

- `npm run check` réussit.
- Une ancienne base s’ouvre sans perte de campagne.
- Les nouveaux écrans utilisent le même langage visuel que le reste du jeu.

## Lot 1 — boucle de jeu solo complète

### Objectif

Rendre les actions, le conseiller et la diplomatie suffisamment riches pour conduire une campagne
sans contourner l’interface.

### Livrables

- Difficultés `very_easy`, `easy`, `normal`, `hard`, `impossible`, persistées par campagne.
- Profils IA par mécanique : actions, conseiller, diplomatie et tours.
- Modification d’une action en attente et amélioration par IA.
- Suggestions d’actions structurées et directement réutilisables.
- Conversations du conseiller persistantes, suggestions rapides et effacement confirmé.
- Chats diplomatiques à plusieurs participants.
- Choix du prochain intervenant, automatique ou forcé.
- Ouverture de la diplomatie depuis une fiche pays.

### Critères d’acceptation

- La difficulté influence explicitement les prompts de tour et de diplomatie.
- Une action modifiée est celle simulée au tour suivant.
- Les messages du conseiller survivent à un rechargement.
- Un chat de groupe conserve tous ses participants et son historique.

## Lot 2 — tours, snapshots, événements et mémoire

### Objectif

Faire de chaque tour une opération contrôlée, inspectable et réversible.

### Livrables

- Exécutions de tour avec statuts et provenance.
- Snapshot complet avant chaque application.
- Stratégies de saut : durée fixe ou prochain événement majeur.
- Gestionnaire d’événements : modification et suppression.
- Restauration d’un snapshot avec confirmation.
- Consolidations automatiques, éditables et supprimables.
- Réglages `startRound` et `chunkSize`.
- Réinjection des consolidations dans le contexte IA.

### Critères d’acceptation

- Une réponse IA invalide ne modifie rien.
- La restauration ramène date, tour, états, unités, événements, lois et carte au même point.
- Supprimer ou modifier un événement invalide les consolidations concernées.
- Les campagnes longues utilisent les consolidations dans leurs prompts.

## Lot 3 — monde dynamique

### Objectif

Permettre au moteur de simulation de transformer la carte et les forces, pas uniquement les
indicateurs numériques.

### Livrables

- État de région propre à chaque campagne : propriétaire et type.
- Types `land`, `coastal`, `ocean`, `strait`.
- Entités cartographiques : `city`, `capital`, `battalion`, `custom`.
- Changements IA validés pour régions, unités et entités.
- Application atomique avec le reste du tour.
- Panneau Monde pour inspecter et ajuster ces données.
- Historique des mutations cartographiques.

### Critères d’acceptation

- Un transfert territorial valide change la carte au même tour que l’événement associé.
- Une référence à une région ou une unité inexistante rejette toute l’application.
- Les capitales, villes et bataillons restent visibles et accessibles.

## Lot 4 — presets et studio de création

### Objectif

Transformer les scénarios ponctuels en contenus réutilisables, versionnés et transportables.

### Livrables

- Presets, brouillons et versions immuables.
- Métadonnées : titre, résumé, catégorie, tags, date, monde antérieur et règles.
- Pays jouables et difficulté recommandée.
- Création de campagne depuis un preset.
- Duplication, import et export JSON.
- Publication locale et archivage.
- Studio de prompts par mécanique avec mode par défaut ou personnalisé.
- Helpers déclaratifs limités, aperçu du contexte et test sans écriture.
- Éditeur de carte fondé sur les régions et entités du lot 3.

### Critères d’acceptation

- Un export réimporté produit le même preset fonctionnel.
- Une version publiée ne change plus quand le brouillon est modifié.
- Une campagne créée depuis un preset copie son état initial et reste indépendante.
- Aucun helper ne peut exécuter du JavaScript arbitraire côté serveur.

## Ordre de livraison

`Socle → boucle solo → tours et mémoire → monde dynamique → presets et studio`

Les lots multijoueur et services en ligne sont explicitement hors périmètre pour cette phase.
