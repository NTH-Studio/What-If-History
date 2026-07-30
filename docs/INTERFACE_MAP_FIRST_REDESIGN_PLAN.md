# What If: History — plan de refonte complète « Map-first »

## 1. Décision produit

La campagne doit devenir une expérience centrée sur la carte, et non une collection de pages
séparées.

La carte reste visible pendant la majorité de la partie. Les actions, la diplomatie, le conseiller,
la chronologie et les événements s'ouvrent autour d'elle sous forme de panneaux, tiroirs ou
surcouches. Lorsqu'un tour produit plusieurs événements, le jeu les présente un par un, déplace la
caméra vers le lieu concerné, met ce lieu en évidence, puis attend l'action « Suivant » du joueur.

La boucle cible est :

`Observer la carte → préparer des actions → avancer le temps → découvrir les événements un par un
sur la carte → reprendre la main`

## 2. Principes d’expérience retenus

- Pendant un saut temporel, le joueur lit chaque événement puis choisit quand poursuivre.
- Le saut temporel peut viser une durée ou le prochain événement majeur.
- Les événements peuvent affecter une ou plusieurs régions et la carte recentre la narration
  sur leur lieu principal.

### Conclusion

La lecture séquentielle avec « Suivant » reste la référence. Le modèle géographique rend le
recentrage vers les capitales et les lieux d’événements cohérent avec l’expérience centrée sur
la carte.

## 3. Audit de l'interface locale actuelle

### Ce qui existe déjà

- Une carte Leaflet 2D avec régions cliquables, villes, capitales, unités et propriétaires de
  campagne.
- Un recentrage initial sur le pays du joueur.
- Une page listant les événements.
- Une page séparée pour choisir et lancer un saut temporel.
- Des panneaux fonctionnels pour les actions, la diplomatie, le conseiller, le monde, la mémoire et
  les réglages.
- Des modales intégrées pour les confirmations et l'édition.
- Une API de tour qui renvoie les événements produits.

### Écarts avec l'expérience cible

1. La carte n'est visible que dans la section « Carte ».
2. Les événements sont une liste statique sans lien visuel avec la géographie.
3. Le saut temporel se termine sans lancer de lecteur d'événements.
4. Un événement connaît les pays affectés, mais pas ses régions, villes, unités ou coordonnées.
5. La carte ne propose pas encore de commande publique `focus`, `flyTo`, `highlight` ou
   `fitLocations`.
6. La navigation latérale de onze entrées disperse la boucle principale.
7. Sur mobile, la carte et le panneau d'information sont empilés comme une page classique.
8. Les erreurs de génération IA restent séparées du parcours de jeu et ne proposent pas de reprise
   contextualisée.
9. Le chargement de `/api/v1/presets` renvoie actuellement `404`; la refonte ne doit pas donner
   l'impression qu'un bouton est utilisable tant que son service ne l'est pas.
10. Une réponse IA invalide produit `VALIDATION_ERROR`; le lecteur d'événements doit avoir un état
    d'échec dédié et ne jamais afficher une séquence partielle comme validée.

## 4. Architecture d'écran cible

### 4.1 Carte persistante

La carte occupe tout l'espace disponible sous la barre supérieure et devient le fond fonctionnel du
jeu.

- Bureau : carte plein écran, panneaux flottants à gauche et à droite.
- Tablette : carte plein écran, tiroirs superposés de largeur limitée.
- Mobile : carte plein écran derrière une feuille basse extensible.
- La navigation vers un outil ne démonte pas la carte et ne réinitialise pas son zoom.
- Le joueur peut toujours fermer un panneau et retrouver immédiatement la carte.

### 4.2 Barre supérieure

Elle conserve uniquement les informations et actions globales :

- nation jouée et drapeau ;
- date et numéro du tour ;
- état de l'IA ;
- accès à l'activité IA ;
- bouton principal « Avancer le temps » ;
- préférences et menu secondaire.

Sur mobile, la date et « Avancer » restent visibles. Les éléments moins importants passent dans un
menu intégré.

### 4.3 Dock de jeu

Remplacer la longue barre latérale par un dock compact :

- Actions ;
- Diplomatie ;
- Conseiller ;
- Monde ;
- Journal.

Les outils avancés — mémoire, réglages de campagne, administration du monde — sont regroupés dans
un menu secondaire. « Carte » disparaît de la navigation, puisqu'elle est désormais le canevas
permanent.

### 4.4 Panneaux contextuels

Un seul panneau principal peut être ouvert à la fois, sauf pendant la lecture d'un événement.

- Largeur bureau : 360 à 440 px.
- Hauteur maximale avec défilement interne.
- Fermeture par bouton, touche Échap et retour mobile.
- Focus clavier placé dans le panneau à l'ouverture puis rendu au déclencheur à la fermeture.
- Aucun `alert`, `confirm` ou `prompt` natif.

## 5. Le « Théâtre des événements »

### 5.1 Déclenchement

Après le succès atomique d'un saut temporel :

1. l'interface reçoit la liste ordonnée des événements ;
2. les données de campagne et de carte sont actualisées ;
3. une file de lecture locale est créée ;
4. le premier événement devient actif ;
5. la caméra se déplace vers son lieu principal ;
6. le lieu est mis en évidence ;
7. la carte révèle les mutations produites ;
8. la fiche narrative apparaît ;
9. le joueur choisit « Suivant ».

Le bouton « Suivant » ne relance pas l'IA et ne modifie pas une seconde fois le monde. Il avance
uniquement dans la file d'événements déjà validée et enregistrée.

### 5.2 Composition de la fiche

La fiche d'événement affiche :

- progression `Événement 2 sur 5` ;
- date ;
- type et gravité, avec texte et icône en plus de la couleur ;
- titre ;
- récit ;
- lieu principal et lieux secondaires ;
- pays affectés ;
- résumé des changements visibles ;
- actions « Précédent », « Intervenir », « Sauvegarder » et « Suivant ».

« Suivant » est l'action primaire, placée à droite sur bureau et dans la zone du pouce sur mobile.

### 5.3 États du lecteur

Le lecteur suit une machine d'états explicite :

`inactif → génération → préparation → déplacement caméra → révélation → attente joueur →
événement suivant → résumé final`

États alternatifs :

- `échec de génération` : aucune mutation n'a été appliquée, afficher Réessayer et Modifier le saut ;
- `événement sans lieu` : utiliser un cadrage de repli documenté ;
- `animation réduite` : recentrage instantané sans mouvement ;
- `reprise` : restaurer l'index de lecture après actualisation de la page ;
- `intervention` : demander confirmation dans une modale intégrée puis arrêter la file restante.

### 5.4 Commandes

- Clic ou toucher sur « Suivant ».
- `Espace` ou `Flèche droite` pour suivant.
- `Flèche gauche` pour précédent.
- Désactivation temporaire de « Suivant » pendant le déplacement initial, avec délai très court.
- Un second clic ne peut jamais sauter deux événements.
- Option « Passer les animations » dans le lecteur.
- Option persistante « Réduire les animations » dans les préférences.

« Précédent » rejoue seulement la présentation. Il ne restaure pas l'ancien état du monde.

## 6. Mise en scène de la carte

### 6.1 Règles de caméra

- Un lieu ponctuel : `flyTo` vers la ville, la capitale, l'unité ou l'entité.
- Une région : cadrage sur ses limites avec marge pour la fiche.
- Plusieurs lieux proches : cadrage englobant.
- Plusieurs lieux éloignés : lieu principal d'abord, marqueurs secondaires visibles ; un bouton
  « Voir l'ensemble » élargit le cadrage.
- Événement national sans région : capitale du pays, puis centroïde du territoire si aucune capitale
  n'existe.
- Événement mondial : vue d'ensemble de la carte.
- Aucun lieu valide : vue d'ensemble avec le libellé « Portée géographique non précisée ». Ne jamais
  inventer un lieu.

### 6.2 Animation recommandée

- déplacement : 650 à 900 ms ;
- surbrillance de la région : fondu de 200 ms ;
- impulsion du marqueur : deux cycles maximum ;
- révélation du changement de propriétaire : transition de 300 à 500 ms ;
- apparition de la fiche après stabilisation de la caméra ;
- mouvement annulable immédiatement par l'utilisateur.

L'animation sert à expliquer, pas à ralentir. Le lecteur doit rester utilisable à 20 événements et
avec `prefers-reduced-motion`.

### 6.3 Calques

Créer des calques explicites et indépendants :

1. fond historique ;
2. frontières et propriétaires de campagne ;
3. entités permanentes : capitales, villes et unités ;
4. changements du tour ;
5. lieu de l'événement actif ;
6. sélection manuelle du joueur ;
7. infobulles et contrôles.

Les couleurs d'événement ne doivent pas remplacer les couleurs territoriales. Utiliser contour,
halo, motif ou symbole pour conserver la lisibilité politique.

## 7. Contrat de données nécessaire

### 7.1 Localisation d'un événement

Étendre le contrat partagé avec une structure validée :

```ts
type EventLocation = {
  role: 'primary' | 'secondary';
  kind: 'region' | 'feature' | 'unit' | 'nation' | 'coordinates' | 'global';
  regionId?: string;
  featureId?: string;
  unitId?: string;
  nationCode?: string;
  coordinates?: { x: number; y: number };
  label?: string;
};

type EventMapCue = {
  locations: EventLocation[];
  camera: 'point' | 'bounds' | 'nation' | 'world';
};
```

Les coordonnées libres ne sont qu'un dernier recours. Les identifiants stables de région, entité,
unité ou nation sont prioritaires.

### 7.2 Sortie IA

Le contexte de génération transmet à l'IA uniquement les identifiants géographiques autorisés et
leur libellé. La sortie doit :

- référencer des identifiants existants ;
- désigner au plus un lieu principal ;
- limiter le nombre de lieux secondaires ;
- associer chaque mutation cartographique à l'événement qui l'explique ;
- être entièrement rejetée si une référence requise est invalide.

Le serveur résout ensuite les identifiants en cadrages déterministes. Le navigateur ne doit pas
interpréter du texte libre pour deviner un lieu.

### 7.3 Persistance et migration

- Ajouter `map_cue` aux événements par migration additive.
- Conserver l'ordre de génération du tour.
- Pour les anciens événements, dériver le cadrage depuis `affected_nations`.
- Si le pays a une capitale, l'utiliser ; sinon utiliser ses régions ; sinon utiliser la vue monde.
- Conserver la compatibilité avec les sauvegardes et snapshots existants.
- Inclure la localisation dans l'édition, l'export et la restauration des événements.

## 8. Refonte des fonctions autour de la carte

### Actions

- Tiroir gauche avec brouillons et actions en attente.
- Bouton d'accès toujours disponible depuis la carte.
- Sélection facultative d'une région, ville ou unité pour préremplir le contexte d'une action.
- Badge du nombre d'actions qui seront traitées au prochain saut.

### Diplomatie

- Tiroir de conversation au-dessus de la carte.
- Cliquer un pays ouvre sa fiche, puis permet de démarrer ou reprendre une discussion.
- Les pays participants peuvent être mis en évidence sans déplacer la caméra en permanence.

### Conseiller

- Panneau conversationnel compact.
- Suggestions tenant compte du lieu actuellement sélectionné.
- Réponses susceptibles d'ouvrir une fiche pays ou de cadrer un lieu, sans mutation implicite.

### Chronologie

- « Avancer le temps » devient l'action principale de la barre supérieure.
- Le choix durée/prochain événement majeur s'effectue dans une modale intégrée.
- L'historique des tours devient un tiroir « Journal ».
- Le journal permet de rejouer la présentation cartographique d'un ancien événement.

### Événements

- La liste actuelle est conservée comme journal consultable et éditable.
- Un clic sur un événement le rejoue dans le Théâtre des événements.
- L'édition d'un événement permet aussi de corriger son lieu.
- La suppression conserve une confirmation intégrée, accessible et traduite.

### Monde, mémoire et réglages

- Ils restent des outils secondaires.
- Les modifications du monde sélectionnent et cadrent les entités concernées.
- Les opérations lourdes ne doivent pas masquer la carte sans nécessité.

## 9. Mobile

L'écran mobile de référence est un téléphone de 390 px de large.

- Carte en plein écran sous la barre supérieure.
- Dock de cinq icônes maximum en bas.
- Fiche d'événement sous forme de feuille basse :
  - état compact : titre, progression, lieu et « Suivant » ;
  - état étendu : récit complet et détails ;
  - hauteur maximale laissant toujours une partie de la carte visible.
- « Suivant » reste visible au-dessus de la zone de sécurité.
- Glisser la fiche ne déclenche pas de zoom accidentel sur la carte.
- Orientation paysage prise en charge.
- Aucun panneau ne dépasse horizontalement.

## 10. Accessibilité et internationalisation

- Français et anglais complets dès le premier lot visible.
- Annonce `aria-live` du titre, de la progression et du lieu actif.
- Focus visible et ordre de tabulation stable.
- Alternative textuelle à toute animation ou changement de couleur.
- Contraste conforme WCAG AA.
- Zones tactiles d'au moins 44 × 44 px.
- Support de `prefers-reduced-motion`.
- La carte ne piège jamais le clavier.
- Les raccourcis du lecteur sont désactivés quand le focus est dans un champ de saisie.
- Les modales et confirmations sont intégrées au design, accessibles, traduites, mobiles et
  compatibles clair/sombre.

## 11. Robustesse et performance

- La carte est montée une seule fois par session de campagne.
- Les panneaux sont chargés à la demande.
- Les changements de l'événement suivant sont préparés pendant la lecture de l'événement courant.
- Les marqueurs et régions ne sont pas tous recalculés à chaque frappe dans un panneau.
- La séquence supporte 20 événements sans dégradation notable.
- La caméra reste fluide sur mobile moyen de gamme.
- Une perte réseau après l'enregistrement du tour ne double jamais son application.
- L'index de lecture et l'identifiant du tour sont persistés localement puis supprimés à la fin.
- La fermeture volontaire du lecteur demande une confirmation intégrée seulement s'il reste des
  événements non lus.

## 12. Plan de livraison

### Lot 0 — stabiliser les parcours bloquants

Livrables :

- corriger ou masquer proprement l'appel `/api/v1/presets` tant que la route n'existe pas ;
- rendre les erreurs `VALIDATION_ERROR` compréhensibles et réessayables ;
- définir les mesures de référence bureau, tablette et mobile ;
- ajouter les tests de garde contre les dialogues JavaScript natifs.

Critères d'acceptation :

- aucune requête `404` répétée au chargement normal ;
- une génération invalide ne modifie ni le tour ni la carte ;
- l'utilisateur sait s'il peut réessayer, modifier le saut ou revenir au jeu.

### Lot 1 — nouveau shell centré sur la carte

Livrables :

- carte persistante ;
- nouvelle barre supérieure ;
- dock compact ;
- panneaux superposés pour les fonctions existantes ;
- conservation du zoom et de la sélection entre les outils.

Critères d'acceptation :

- le passage Actions → Diplomatie → Conseiller ne démonte pas la carte ;
- la carte utilise tout l'espace restant sur les trois formats ;
- toutes les fonctions actuelles restent accessibles.

### Lot 2 — localisation fiable des événements

Livrables :

- schémas `EventLocation` et `EventMapCue` ;
- migration SQLite additive ;
- contexte et sortie IA géographiques ;
- validation des références ;
- stratégie de repli pour les anciens événements ;
- édition du lieu dans le journal.

Critères d'acceptation :

- un événement nouveau possède un cadrage déterministe ;
- une référence inexistante rejette atomiquement le tour ;
- une ancienne campagne reste lisible sans modification manuelle.

### Lot 3 — lecteur séquentiel

Livrables :

- machine d'états du Théâtre des événements ;
- fiche avec progression ;
- « Précédent », « Sauvegarder », « Intervenir » et « Suivant » ;
- reprise après actualisation ;
- résumé final du tour ;
- lecture d'un ancien événement depuis le journal.

Critères d'acceptation :

- tous les événements d'un tour sont présentés dans leur ordre ;
- « Suivant » n'applique aucune mutation supplémentaire ;
- les doubles clics ne sautent aucun événement ;
- le dernier événement rend la main au joueur avec un résumé.

### Lot 4 — caméra, surbrillances et mutations visuelles

Livrables :

- API de contrôle de la carte ;
- cadrage point, région, pays, groupe et monde ;
- halo, impulsion et surbrillance ;
- révélation des transferts territoriaux, unités et entités ;
- option de réduction ou suppression des animations.

Critères d'acceptation :

- chaque événement localisé montre clairement le lieu concerné ;
- plusieurs lieux restent compréhensibles ;
- le mode réduit ne contient aucun mouvement non essentiel ;
- interrompre une animation ne casse pas le lecteur.

### Lot 5 — intégration complète des outils

Livrables :

- sélection cartographique réutilisable dans Actions et Conseiller ;
- fiche pays et Diplomatie liées à la sélection ;
- Journal regroupant tours et événements ;
- rejouabilité des événements ;
- harmonisation des états vides, chargements et erreurs.

Critères d'acceptation :

- le joueur peut accomplir la boucle principale sans quitter la carte ;
- chaque outil affiche clairement ce qui est sélectionné ;
- aucun écran secondaire ne ressemble à une application séparée.

### Lot 6 — mobile, accessibilité et finition

Livrables :

- feuille basse d'événement ;
- dock mobile ;
- navigation clavier complète ;
- annonces lecteur d'écran ;
- thèmes clair/sombre ;
- réglages d'animation ;
- optimisation du rendu.

Critères d'acceptation :

- parcours complet validé à 390 px, 768 px et 1440 px ;
- aucun débordement horizontal ;
- « Suivant » reste accessible à chaque événement ;
- carte, panneaux et lecteur sont utilisables au clavier et avec mouvement réduit.

## 13. Stratégie de tests

### Tests unitaires

- résolution d'un lieu vers un cadrage ;
- priorité région → entité → nation → monde ;
- file et machine d'états ;
- anti-double-clic ;
- reprise d'index ;
- ordre des événements ;
- préférences d'animation.

### Tests de contrats et serveur

- validation de tous les types de localisation ;
- rejet des identifiants inconnus ;
- migration d'une ancienne base ;
- restauration d'un snapshot avec lieux ;
- atomicité du tour ;
- absence de doublon lors d'une nouvelle tentative réseau.

### Tests d'intégration

- lancer un saut et ouvrir automatiquement le premier événement ;
- cinq événements avec lieux variés ;
- événement sans lieu ;
- événement mondial ;
- plusieurs lieux éloignés ;
- intervention au milieu d'une séquence ;
- reprise après rechargement ;
- échec IA avant toute mutation.

### Tests visuels et end-to-end

- bureau 1440 × 900 ;
- tablette 768 × 1024 ;
- mobile 390 × 844 ;
- mobile paysage ;
- thèmes clair et sombre ;
- mouvement normal et réduit ;
- clavier uniquement ;
- vérification qu'aucun dialogue natif n'est utilisé.

La validation finale exécute `npm run check` puis `npm run test:e2e`, complétés par une vérification
visuelle de la vraie route de campagne.

## 14. Risques à maîtriser

| Risque                                          | Réponse prévue                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| L'IA invente un lieu                            | Identifiants autorisés et validation serveur stricte                          |
| Une animation masque le récit                   | Durée courte, annulation et mouvement réduit                                  |
| Le monde est déjà muté avant la lecture         | Présenter la lecture comme une révélation, pas comme une application différée |
| Plusieurs événements modifient la même région   | Conserver l'ordre et calculer les deltas par événement                        |
| Un ancien événement n'a pas de lieu             | Capitale, territoire, puis vue monde                                          |
| Le mobile cache entièrement la carte            | Feuille basse compacte et extensible                                          |
| Le nouveau shell casse un outil existant        | Migration outil par outil avec tests de parité                                |
| Les fonctions non implémentées semblent actives | États indisponibles explicites, jamais de bouton factice                      |

## 15. Hors périmètre de cette refonte

- multijoueur ;
- services communautaires en ligne ;
- remplacement immédiat de la carte 2D par un globe 3D ;
- nouvel éditeur complet de presets ;
- simulation IA en continu pendant la lecture.

Le globe 3D pourra utiliser plus tard le même contrat de caméra et le même Théâtre des événements.

## 16. Définition de terminé

La refonte est terminée lorsque :

1. la carte est le canevas permanent de la campagne ;
2. un saut réussi ouvre automatiquement une séquence d'événements ;
3. chaque événement localisé déplace ou cadre la carte et met son lieu en évidence ;
4. « Suivant » parcourt toute la séquence sans nouvelle mutation ;
5. les événements sans lieu ont un repli honnête et déterministe ;
6. Actions, Diplomatie, Conseiller, Journal et Monde fonctionnent autour de la carte ;
7. le parcours complet fonctionne sur mobile, au clavier et avec mouvement réduit ;
8. les erreurs IA ou réseau ne laissent jamais la campagne dans un état partiel ;
9. aucune fonctionnalité non implémentée ne déclenche de `404` silencieux ;
10. aucun dialogue JavaScript natif n'existe ;
11. les tests automatiques et la vérification visuelle de la route réelle réussissent.

## 17. Ordre recommandé

`Stabilité → shell Map-first → données géographiques → lecteur séquentiel → animations →
intégration des outils → mobile et accessibilité`

Il faut éviter de commencer par les animations : sans localisation persistée et validée, elles
reposeraient sur des suppositions fragiles. Le premier jalon réellement démontrable est un tour qui
produit trois événements localisés, les affiche dans l'ordre et permet de les parcourir avec
« Suivant » sur une carte qui ne disparaît jamais.
