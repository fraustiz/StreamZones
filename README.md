# StreamZones

Plugin [Equicord](https://github.com/Equicord/Equicord) pour Discord : des zones dans les partages d'écran, dans les deux sens.

- **Partager seulement une zone de ton écran**, avec le son. Un onglet **Zone** s'ajoute à la fenêtre de partage d'écran. Tu dessines la zone à la souris, ou tu prends un format (16:9, 21:9, 4:3) que tu places à gauche, au centre ou à droite. Pratique avec un écran ultra-large, ou trois écrans que Windows voit comme un seul.
- **Recadrer les partages que tu regardes.** Clic droit sur un partage → **Recadrer** : tu choisis un format et une position, puis Alt + glisser pour ajuster. Le réglage est mémorisé pour chaque personne. Rien ne change pour les autres spectateurs.

## Ce qu'il faut

- Discord, version de bureau, sous **Windows** (c'est le seul système sur lequel le plugin a été essayé, et le partage de zone en dépend).
- **Equicord compilé depuis ses sources** : la version posée par l'installeur ne charge pas de plugin personnel. Voir le [dépôt d'Equicord](https://github.com/Equicord/Equicord).
- [Git](https://git-scm.com/), [Node.js](https://nodejs.org/) 22 ou plus récent, et [pnpm](https://pnpm.io/).

## Installation

Dans Git Bash, depuis ton dossier Equicord :

```bash
git clone https://github.com/fraustiz/StreamZones.git src/userplugins/streamZones
pnpm build
```

Ensuite, quitte Discord complètement (clic droit sur son icône près de l'horloge → Quitter) et relance-le. Dans **Paramètres → Equicord → Plugins**, active `StreamZones`.

Il faut bien un `git clone`, et non une copie des fichiers : c'est ce qui permet au plugin de se mettre à jour.

### Si tu avais déjà ZoneShare ou StreamCrop

StreamZones les remplace. Supprime d'abord leurs dossiers, puis installe comme ci-dessus :

```bash
rm -rf src/userplugins/zoneShare src/userplugins/streamCrop
```

Les réglages de ZoneShare (et son activation) ainsi que les recadrages de StreamCrop sont repris automatiquement.

## Utilisation

### Partager une zone

1. Rejoins un salon vocal et clique sur le bouton de partage d'écran.
2. Règle la qualité si tu veux, puis clique sur l'onglet **Zone**.
3. Tous tes écrans s'assombrissent. Sur celui que tu veux partager :
   - **Libre** : dessine la zone à la souris, le partage démarre dès que tu relâches ;
   - **16:9, 21:9 ou 4:3** : place la zone avec Gauche / Centre / Droite ou en la faisant glisser, puis **Partager** ou **Entrée**.
4. **Échap** annule. Pour arrêter, coupe le partage dans Discord.

La fois suivante, le dernier format utilisé est déjà sélectionné : onglet Zone, puis Entrée.

### Recadrer un partage que tu regardes

Clic droit sur le partage → **Recadrer** → un format, puis une position. **Alt + glisser** sur l'image pour ajuster. **Original** remet l'image d'origine.

## Mises à jour

Au démarrage de Discord, puis toutes les 6 heures, StreamZones regarde s'il existe une nouvelle version ici. Si oui, un bandeau propose de l'installer ; une fois installée, redémarre Discord.

- Le réglage `checkForUpdates` coupe cette vérification.
- Si tu as modifié des fichiers du plugin, il ne les écrase pas et ne propose rien.
- À la main : `git pull` dans `src/userplugins/streamZones`, puis `pnpm build` dans le dossier Equicord, puis redémarrer Discord.

## Comment ça marche

- **Partage de zone.** Discord ne sait capturer qu'un écran ou une fenêtre entière. Le plugin recopie la zone en direct dans une fenêtre invisible, et c'est elle que Discord partage. Pour le son, il fait traiter cette fenêtre comme un écran, ce qui envoie le son du système.
- **Le bon écran.** Juste avant le partage, un petit carré de couleur clignote au milieu de la zone : le plugin vérifie qu'il le voit dans ce qu'il capture, et refuse plutôt que de partager un autre écran.
- **Recadrage.** L'image reçue est agrandie et décalée dans sa tuile ; Discord demande alors une qualité adaptée, donc la partie visible reste nette.
- Le plugin modifie trois endroits du code de Discord. Une mise à jour de Discord peut un jour casser l'une des fonctions : dans ce cas, ouvre une *issue*.

## Si ça ne marche pas

| Ce que tu vois | Quoi faire |
| --- | --- |
| `StreamZones` n'apparaît pas dans la liste des plugins | Le `pnpm build` n'a pas été fait depuis le dossier Equicord, ou Discord n'a pas été complètement quitté. |
| Pas d'onglet **Zone** | Le plugin n'est pas activé. S'il l'est, une mise à jour de Discord l'a sans doute cassé. |
| Un autre écran que le tien est partagé, ou **Zone** ne fait rien | Si tu viens de changer la disposition de tes écrans, redémarre Discord complètement. Un jeu en plein écran exclusif peut aussi cacher l'écran de sélection : passe-le en fenêtré sans bordure. |
| Une fenêtre « Le partage de la zone n'a pas pu démarrer » | Redémarre Discord et réessaie. Si ça continue, le fichier indiqué dans la fenêtre dit ce qui a été tenté. |
| Les spectateurs n'entendent rien | Vérifie que le partage du son est activé dans la fenêtre de partage. |
| Pas de bandeau de mise à jour | Le dossier n'est pas un `git clone`, ou il a été modifié à la main. Le détail est dans le journal. |

Le journal est dans `%APPDATA%\Equicord\StreamZones\streamzones.log`. Il note les écrans vus, les choix faits et les erreurs, jamais ce qu'il y a sur les écrans.

## Désinstaller

Désactive le plugin. Pour le retirer complètement : supprime `src/userplugins/streamZones` dans ton dossier Equicord, relance `pnpm build`, puis redémarre Discord.

## Licence

GPL-3.0-or-later, comme Equicord. Voir [LICENSE](LICENSE).
