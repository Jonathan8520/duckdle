# Duckdle

**Une case de BD Disney s'affiche. Tu as quinze secondes pour trouver qui l'a dessinée.**

Jouer : **https://jonathan8520.github.io/duckdle/**

[![Données Inducks](https://github.com/Jonathan8520/duckdle/actions/workflows/data.yml/badge.svg)](https://github.com/Jonathan8520/duckdle/actions/workflows/data.yml)
[![Site](https://github.com/Jonathan8520/duckdle/actions/workflows/pages.yml/badge.svg)](https://github.com/Jonathan8520/duckdle/actions/workflows/pages.yml)

Un jeu pour reconnaître le trait des dessinateurs Disney (Barks, Rosa, Scarpa, Cavazzano, Vicar…), dans l'esprit de Duckguessr, le jeu de l'équipe DucksManager aujourd'hui hors ligne.

## Le jeu

- **8 cases par partie, 9 dessinateurs proposés.** Chaque dessinateur n'est la bonne réponse qu'une fois : l'un des neuf est un leurre, et les réponses déjà données sont grisées.
- **15 secondes par case.** 100 points par bonne réponse, plus un bonus de rapidité (jusqu'à 100 points) tant que la barre est jaune, soit 7,5 secondes.
- **La case s'ouvre sur un détail puis s'élargit.** La bande du haut de la planche (titre, crédits) reste cachée jusqu'à la réponse, puis toute la page se dévoile avec le titre et le lien vers Inducks.
- **Modes** :
  - *Pour commencer* : Débutant (grands noms aux styles marqués) et Tous les dessinateurs (près de 350 aujourd'hui).
  - *Par pays* : un mode par pays, créé automatiquement dès que neuf de ses dessinateurs ont assez de planches (aujourd'hui Argentine, Brésil, Danemark, Espagne, France, Italie, Pays-Bas, États-Unis).
  - *Au kiosque* : tout ce qui a paru dans un pays depuis 20 ans, d'où que ça vienne (France, Italie, Allemagne, Espagne, Brésil, Pays-Bas, Danemark, Norvège, Suède, Finlande, monde anglophone). Le kiosque du pays de la langue choisie passe en premier.
  - *Autrement* : Les histoires Egmont (produites pour l'Europe du Nord).
- **Qui est de la partie** : dans chaque mode, tous les dessinateurs qui ont au moins 30 planches jouables, ceux dont les histoires ont paru au moins 400 fois dans le monde (même avec peu de planches scannées), et au moins les 40 plus connus quand le mode est plus petit. Les 9 noms d'une partie sont tirés au sort en favorisant les plus connus, mesurés au nombre de parutions de leurs histoires dans le monde : un auteur d'histoires longues et très rééditées (Rosa, Casty) pèse autant qu'un auteur de centaines de gags.
- **Noms d'usage** : quand Inducks donne un nom complet (« Francisco Rodriguez Peinado »), le jeu affiche le nom officiel plus court sous lequel on le connaît (« Paco Rodriguez »). L'Atelier retrouve un dessinateur par n'importe lequel de ses noms.
- **L'atelier** : quelques planches de chaque dessinateur, pour apprendre à reconnaître son trait.
- **Défis précédents** : les défis des jours passés, à rejouer sans toucher à la série.
- **Défi du jour** : les mêmes cases pour tout le monde, une tentative, résultat à partager en carrés de couleur.
- **Défi entre amis** : un lien qui rejoue exactement les mêmes cases, avec le score à battre.
- **Statistiques et médailles** gardées dans le navigateur (rien n'est envoyé nulle part).
- Clavier : touches 1 à 9 pour répondre, Entrée pour passer à la case suivante.
- **Onze langues** : français, anglais, italien, allemand, espagnol, portugais, néerlandais, danois, norvégien, suédois et finnois. La langue du navigateur est choisie d'office, le globe en haut permet d'en changer. Les titres des histoires s'affichent dans la langue choisie quand Inducks en connaît une traduction.

## Comment le dépôt se met à jour tout seul

```
chaque lundi            ┌──────────────────────────────┐
GitHub Actions  ──────▶ │ data.yml                      │
                        │  1. tests du pipeline         │
                        │  2. export public Inducks     │
                        │  3. pipeline/build_data.py    │
                        │  4. commit de site/data       │
                        └──────────────┬───────────────┘
                                       ▼
                        ┌──────────────────────────────┐
                        │ pages.yml                     │
                        │  vérifications, puis          │
                        │  publication sur gh-pages     │
                        └──────────────────────────────┘
```

- `pipeline/build_data.py` lit l'export `isv.tgz` d'Inducks, garde les scans publics de premières pages d'histoires (pas de couvertures ni de strips de journaux) dessinées par **un seul** dessinateur, choisit de préférence un scan d'une édition française, puis construit les modes.
- Une case n'est gardée que si la planche est **de la main du dessinateur crédité**. Sont écartés, d'après les fiches Inducks : les remakes et reprises de dessin d'une histoire d'un autre dessinateur (cases reproduites, remontage, flashback…), les parutions redessinées ou décalquées, et les jeux (cases à remettre dans l'ordre). Les séries non Disney parues dans des revues Disney (Mopsi Giso e Leo, Angelino…), qu'Inducks range sous l'en-tête « Q », sont écartées aussi. Un remake de sa propre histoire, ou une simple reprise d'idée, reste permis.
- Le calendrier des défis du jour est prolongé de cinq semaines à chaque passage. **Un jour passé, celui du jour et celui du lendemain ne sont jamais modifiés**, et leurs cases restent dans `site/data/archive.json`. Un jour plus lointain dont une case vient d'être écartée est refait.
- Les titres traduits sont écrits dans `site/data/titles/<langue>.json`, seulement pour les histoires en jeu.
- Les images ne sont pas copiées dans le dépôt : le navigateur les affiche depuis Inducks.

Lancer la mise à jour à la main : onglet *Actions*, workflow *Données Inducks*, *Run workflow*. Décocher *publish* fait un essai à blanc : les données sont jointes au run comme artefact, sans commit.

Savoir pourquoi un dessinateur est absent : workflow *Pourquoi ce dessinateur ?*, avec les noms séparés par des virgules. Le résumé du run indique, étape par étape, combien de ses histoires passent les filtres (histoires dessinées, en planches, seul dessinateur, scan public de la première page, dessin de sa main).

Deux autres outils du même onglet : *Fiche d'une histoire* affiche tout ce que l'export Inducks contient sur des codes d'histoire donnés (versions, crédits, liens vers d'autres histoires), et *Audit des cases* liste les cases écartées par raison, avec des exemples à vérifier.

## En ligne (Supabase)

Le site reste statique sur GitHub Pages ; une base [Supabase](https://supabase.com) ajoute ce qui se partage entre joueurs :

- **Statistiques communes** : chaque partie terminée envoie le mode, les cases, les réponses et leurs temps, sans nom ni identifiant. Le site affiche les parties des dernières 24 heures, les joueurs du défi du jour, le rang (« tu fais mieux que 72 % des joueurs »), la répartition des cases trouvées, la part des joueurs qui ont trouvé chaque case et le taux de reconnaissance de chaque dessinateur dans l'Atelier.
- **Joueurs en ligne** : compte des onglets ouverts (Supabase Realtime), sans rien enregistrer.
- **Comptes** : un pseudo et un mot de passe, sans e-mail (chaque pseudo devient une adresse fictive en `.invalid`, qui ne reçoit jamais rien). La progression du navigateur s'ajoute au compte à la première connexion, puis se synchronise entre appareils sans rien compter deux fois (`site/js/sync.js`, testé dans `tests/sync.test.mjs`). Un mot de passe oublié ne peut pas être récupéré.
- **Une seule tentative au défi du jour** : il n'y a pas de bouton pour effacer ses statistiques, et l'appareil garde la trace des derniers défis joués même après une déconnexion ou la suppression du compte. Côté base, un compte ne compte qu'une fois par jour (la première partie envoyée). Une partie anonyme ne peut pas être reconnue : rejouer en navigation privée ou dans un autre navigateur reste possible, comme sur tous les jeux de ce genre sans compte obligatoire.

Tout passe par des fonctions SQL (`supabase/migrations/`) : les tables sont fermées, le site ne peut qu'envoyer une partie et lire des totaux ; un joueur connecté ne voit que sa propre progression. Sans réseau, le jeu continue en local.

- **Parties vérifiées** : la base recalcule elle-même les cases trouvées et le score à partir des réponses et des temps envoyés ; le score calculé par le navigateur n'est pas lu.
- **Envois en rafale** : une même adresse peut envoyer 60 parties en dix minutes. Pour le savoir, la base garde une empreinte salée de l'adresse IP (jamais l'adresse elle-même), effacée au bout de dix minutes et reliée à aucune partie.

Les réponses du défi du jour sont dans les données du site (`daily.json` donne les cases, `archive.json` leur dessinateur) : un site statique ne peut pas faire autrement, puisque le navigateur doit connaître la réponse pour l'afficher. Le classement du jour repose donc sur la bonne foi des joueurs, comme sur tous les jeux de ce genre.

Mise en place :

1. Secret `SUPABASE_DB_URL` du dépôt : l'adresse « Session pooler » du projet, mot de passe compris. Le workflow *Base Supabase* applique alors chaque nouvelle migration (suivi dans le schéma `duckdle_meta`).
2. Dans Supabase, *Authentication*, *Sign In / Providers*, *Email* : « Confirm email » décoché.
3. L'adresse et la clé publique du projet sont dans `site/js/online.js`.

Les parties envoyées par les contrôles automatiques (adresse avec `?test`) sont gardées mais jamais comptées.

Un projet Supabase gratuit se met en pause après une semaine sans activité : le workflow *Réveil Supabase* lit les totaux publics deux fois par semaine pour l'éviter.

L'ancienne adresse (`/coup-de-patte/`) est servie par le dépôt [Jonathan8520/coup-de-patte](https://github.com/Jonathan8520/coup-de-patte), qui ne contient qu'une page de redirection vers Duckdle.

## Organisation

```
pipeline/   construction des données (Python, sans dépendance) et ses tests
site/       le site statique publié (HTML, CSS, JavaScript sans framework)
  data/     données générées par le workflow, à ne pas modifier à la main
  i18n/     textes de l'interface, un fichier par langue (fr.json fait référence)
scripts/    vérifications avant publication, icônes, migrations, bibliothèque Supabase
supabase/   structure de la base (migrations SQL)
tests/      synchronisation des comptes, fonctions de la base
```

## En local

```bash
python -m unittest discover -s pipeline        # tests du pipeline
python -m http.server -d site 8000             # puis http://localhost:8000
node scripts/check-site.mjs                    # vérifie les données et les traductions
python scripts/make_icons.py                   # régénère les icônes (Playwright)
```

## Traduire

Chaque langue est un fichier `site/i18n/<code>.json` avec les mêmes clés que `fr.json`. Les pluriels sont des objets (`one`, `other`, et `few` ou `many` si la langue en a besoin). `node scripts/check-site.mjs` signale une clé ou une variable oubliée. Pour ajouter une langue : créer son fichier et l'ajouter à la liste `LANGS` de `site/js/i18n.js`.

## Crédits

- Données : [Inducks](https://inducks.org), utilisées selon [la licence Inducks](https://inducks.org/inducks/COPYING).
- Idée originale : Duckguessr, par l'équipe de [DucksManager](https://github.com/bperel/DucksManager).
- Les personnages et histoires Disney sont © Disney. Projet de fan, sans lien avec Disney.
- Police : [Shantell Sans](https://fonts.google.com/specimen/Shantell+Sans).
