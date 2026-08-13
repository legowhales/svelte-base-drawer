---
name: base-ui-parity
description: Vérifier s'il y a des évolutions du Drawer base-ui à porter (parité upstream), analyser la release, et présenter un plan d'action SANS RIEN IMPLÉMENTER tant que l'utilisateur n'a pas validé le plan. Utiliser quand l'utilisateur demande de vérifier les mises à jour base-ui, la parité du port, ou "des évolutions à faire".
---

# Mise à jour de parité base-ui

Workflow validé sur la mise à jour v1.6.0 → v1.7.0 (2026-08-13, release
0.2.0). **RÈGLE ABSOLUE : présenter la synthèse du plan d'action en français
concis et S'ARRÊTER — l'utilisateur valide (ou ajuste) avant toute
implémentation.** Idem pour la livraison : commit, deploy, release et publish
se font chacun sur demande explicite uniquement.

## 1. Situer les versions

- Version de référence actuelle : ligne « Référence upstream » de `CLAUDE.md`.
- Dernières releases upstream : `gh api repos/mui/base-ui/releases --jq
  '.[].tag_name' | head`, puis WebFetch de la page de release pour les notes.
- Plusieurs releases de retard → les traiter toutes (diff cumulé
  ancienne…dernière, mais lire les notes de CHAQUE release intermédiaire).

## 2. Analyser le diff upstream (dans le scratchpad, pas dans le repo)

```bash
git clone --filter=blob:none --no-checkout https://github.com/mui/base-ui.git
cd base-ui && git fetch --depth=1 origin tag vANCIENNE tag vNOUVELLE
git diff vANCIENNE vNOUVELLE --stat -- packages/react/src/drawer 'packages/react/src/utils/useSwipeDismiss*'
```

- Diff source par thème, SANS les tests (`':!*test*'`), exporté en fichiers
  pour lecture (les tests upstream indiquent par contre les comportements
  attendus — utiles en cas de doute).
- Repérer les nouveaux fichiers (`--diff-filter=A --name-only`) et les
  utilitaires partagés touchés (`getElementAtPoint`, `popupStateMapping`,
  helpers de swipe…) — les fixes drawer s'y cachent parfois.
- Croiser avec les notes de release : section Drawer ET changements généraux
  (dialog/popup communs).

## 3. Classer chaque changement

- **Applicable au port** : comportement navigateur/geste/clavier/DOM
  (iOS, WebKit, Shadow DOM…). Vérifier dans `src/lib/drawer/` que la zone
  correspondante est bien restée à l'ancienne version avant de le déclarer.
- **React-only** : store, hooks, re-render, bundle-size, types, DialogHandle
  détachés — à lister comme non porté avec la raison.
- **Cosmétique** : refactor sans changement de comportement — n'adopter que
  si ça rapproche le texte du code d'upstream (facilite les diffs futurs).

## 4. Présenter le plan et ATTENDRE

Synthèse en français concis : lots par fichier, ce qui est N/A et pourquoi,
risques, impact perf (l'utilisateur ne veut AUCUNE régression de perf),
périmètre détachable si l'utilisateur veut réduire. **STOP ici.**

## 5. Après validation seulement — implémenter

- Sous-agents possibles pour les fichiers disjoints (leur donner le diff
  upstream exporté + les contraintes de style) ; TOUJOURS relire leurs diffs
  ligne à ligne ensuite.
- Vérifier : `npm run check` (0 erreur), `npm run package` (publint OK),
  démos en preview avec les recettes HANDOFF §7. Pièges de test : onglet
  qui ne peint pas (forcer des frames par captures), events synthétiques
  untrusted qui ne déclenchent NI l'outside-press NI l'Escape de bits-ui
  (utiliser de vrais inputs CDP), pointer-swipe impossible depuis
  `[data-drawer-content]` (voulu).
- Mettre à jour : `CLAUDE.md` + `HANDOFF.md` (référence upstream, section de
  mise à jour, historique §8, recettes §7 si le comportement testable a
  changé), en-têtes des fichiers portés, `README.md` et
  `src/routes/+page.svelte` (mention de version base-ui).
- Version du package : montée **minor** base-ui = montée **minor** du
  package ; patch = patch. (1.6→1.7 a donné 0.1→0.2.)

## 6. Livraison (chaque étape sur demande explicite uniquement)

- **Test mobile d'abord** : `npm run build && npx wrangler deploy --env dev`
  → https://svelte-base-drawer-dev.otarie.workers.dev. ⚠️ L'env `dev` a
  `"routes": []` EXPLICITE dans `wrangler.jsonc` — ne jamais le retirer,
  sinon l'env hérite de la route racine et VOLE le custom domain de prod.
- **Prod** : `npx wrangler deploy` (ré-attache le custom domain au worker
  de prod).
- Commits (séparer port et site), push, release GitHub avec changelog par
  domaine et liens `mui/base-ui#XXXX` (`gh release create vX.Y.Z`),
  `npm publish` — jamais sans demande explicite.
