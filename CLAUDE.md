# Projet : Drawer Svelte porté de base-ui

> 📋 **Passation** : voir `HANDOFF.md` à la racine — carte détaillée des
> fichiers, invariants, recettes de test (simulation de gestes, piège de
> l'onglet caché), et liste des points restants à corriger.

> 🔁 **Mise à jour de parité upstream** : skill projet `/base-ui-parity`
> (`.claude/skills/base-ui-parity/SKILL.md`) — analyse la release base-ui,
> classe les changements (applicables / React-only), présente un plan
> d'action et N'IMPLÉMENTE RIEN avant validation de l'utilisateur.

## Contexte

Port du composant Drawer de base-ui (React) vers Svelte 5, en utilisant bits-ui Dialog comme fondation.
Le code source est dans `src/lib/drawer/`.
**Référence upstream : base-ui v1.7.0** (`packages/react/src/drawer/` + `packages/react/src/utils/useSwipeDismiss.ts`).

## Architecture

- `internal/create-swipe-gesture.svelte.ts` — moteur de gestes, port fidèle de `useSwipeDismiss` v1.7.0
- `internal/create-drawer-touch-scroll.svelte.ts` — interception touch (scroll vs swipe), port du handler natif de `DrawerViewport`
- `internal/create-virtual-keyboard.svelte.ts` — port de `DrawerVirtualKeyboardProvider` (clavier virtuel mobile)
- `internal/drawer-state.svelte.ts` — état du drawer, physique du release, coordination bits-ui
- `internal/utils.ts` — utilitaires purs (scroll, shadow-DOM-aware traversal, sélection, transform)
- `components/` — composants Svelte qui wrappent bits-ui Dialog

## Anatomie (alignée base-ui v1.7.0)

```
Drawer.Root                     → contexte + bits-ui Dialog.Root
  Drawer.Trigger                → re-export bits-ui
  Drawer.VirtualKeyboardProvider (optionnel, englobe le Portal)
    Drawer.Portal               → re-export bits-ui
      Drawer.Backdrop           → wrappe Dialog.Overlay ([data-drawer-backdrop])
      Drawer.Viewport           → conteneur fixed inset-0, HOST DE TOUS LES GESTES (obligatoire)
        Drawer.Popup            → le panneau, wrappe Dialog.Content ([data-drawer-popup])
          Drawer.Handle
          Drawer.Title / Description / Close (re-exports bits-ui)
          Drawer.Content        → zone scrollable ([data-drawer-content], touch-action: auto)
```

⚠️ Ne pas confondre avec l'ancienne V1 : notre ancien `Drawer.Content` est devenu `Drawer.Popup` ; `Drawer.Overlay` est devenu `Drawer.Backdrop`. `Drawer.Content` désigne maintenant la zone scrollable (comme upstream).

## Stack

- Svelte 5 avec runes ($state, $effect, $derived)
- bits-ui (pattern classes State + Context de runed)
- `untrack` pour lire l'état dans les handlers sans tracking
- Le Viewport est rendu via `{#if drawer.mounted}` où `mounted = open || popupElement !== null` (suit la présence bits-ui pendant l'animation de sortie)

## CSS vars (alignées upstream, registerProperty inherits:false)

- `--drawer-swipe-movement-x` / `-y` : déplacement pendant le drag (sur le popup)
- `--drawer-swipe-progress` : 0-1 (sur le backdrop)
- `--drawer-swipe-strength` : 0.1-1, scalaire de durée du dismiss (posé sur popup ET backdrop — inherits:false oblige)
- `--drawer-keyboard-inset` : inset clavier (sur le viewport, via VirtualKeyboardProvider)
- Attribut d'opt-out : `data-swipe-ignore` (aucun swipe ne démarre dessus)

## État actuel (Phase 2 TERMINÉE — parité fonctionnelle complète avec base-ui v1.7.0)

### Mise à jour v1.6.0 → v1.7.0 (2026-08-13)

Les 6 fixes drawer applicables de la release v1.7.0 sont portés :

- **#5105** swipe-to-open fiable : re-ancrage du 1er move seulement si `trackDrag`
  (le SwipeArea passe `trackDrag: false` → un flick entier dans le 1er move compte),
  init `sawPrimaryButtonsOnMove = !('touches' in event)`.
- **#5308** : `syncDragStyles` seulement quand l'offset change (curseur bloqué au
  bord d'écran → plus de saut de snap point). La fonction `swipeThreshold` est
  snapshotée au début du geste.
- **#5257** : arbitrage cross-axis réécrit (`shouldYieldTouchMove`) — slop 6px,
  biais 2px, attribution one-shot par geste (`drawerAxisAttributed`),
  non-cancelable → scroll natif, et AUCUN preventDefault tant qu'aucun axe n'a
  passé le slop (sinon iOS tue le scroll natif pour tout le geste).
- **#5360** Shadow DOM : `getElementAtPoint(element.getRootNode())` partout
  (elementFromPoint du document re-cible le contenu shadow vers le host).
- **#5112** anti-flash SwipeArea : flag `swipeAreaActive` sur le state —
  `resetAfterOpen` saute le reset des vars de mouvement et du backdrop pendant un
  swipe-to-open ; le SwipeArea ré-asserte ses styles quand le popup (re)mount.
- **#5179** clavier virtuel : refonte du réalignement quand le focus bouge clavier
  ouvert (passes 150ms×4, `preemptFocusReveal`, pin du scroll window, flag focus
  programmatique, settle-watching 60 frames, annulation au pointerdown).
- Guard outside-press du SwipeArea désormais **déterministe** (capture
  `pointerdown`/`click` + `isVirtualClick`, remplace le timer 300ms).

Non porté (React-only) : #5109 (remount du store), `Drawer.Handle`/`createHandle`
(triggers détachés DialogHandle — pas d'équivalent bits-ui), réductions de bundle,
`useIsoLayoutEffect`. Les refactors cosmétiques upstream (closestSnapPointIndex,
etc.) n'ont pas été calqués quand le comportement est identique.

Vérifié en preview (recettes HANDOFF §7) : dismiss basique, swipe-to-open avec
pause mi-geste (les vars survivent au flip d'ouverture), guard outside-press en
événements trusted CDP, snap expand/collapse, nested stacking. `svelte-check` 0
erreur, `npm run package` OK. Les comportements iOS réels (#5257, #5179) restent à
valider sur appareil.

Tous les composants sont portés : Root, Trigger, Portal, Backdrop, Viewport, Popup,
Content, Handle, Title, Description, Close, **SwipeArea**, **Provider**, **Indent**,
**IndentBackground**, **VirtualKeyboardProvider**. Fonctionnalités : snap points
(contrôlables via `bind:snapPoint`, `snapToSequentialPoints`, `data-expanded`),
nested drawers (stacking, `--nested-drawers` récursif, gel de hauteur,
`--drawer-frontmost-height`), swipe-to-open, indent effect, CloseWatcher Android,
scroll lock bits-ui actif (`preventScroll`, compatible interception touch — le
listener iOS de bits-ui ne bloque que `documentElement`), 4 directions en CSS.

Les 8 démos (basique + 7 ports de la doc base-ui : snap-points, nested,
virtual-keyboard, indent, mobile-nav, swipe-to-open, action-sheet) sont des
composants sous `src/demos/*`, tous affichés sur la page de doc unique
`src/routes/+page.svelte`, avec CSS préfixé par démo (PAS le drawer.css de la
lib — ses sélecteurs d'attributs écraseraient les classes).

## Package npm

Le projet est publié sur npm sous le nom **`svelte-base-drawer`** (v0.2.0 ;
convention : une montée minor de base-ui = une montée minor du package —
1.6→1.7 a donné 0.1→0.2) : entrée `src/lib/index.ts` → `dist/` via
`npm run package` (`svelte-package` + `publint`). `bits-ui` et `svelte` sont
en **peerDependencies** (le package s'installe à côté d'un bits-ui existant).
Exports : `.` (composants) et `./drawer.css` (feuille de départ, autonome —
pas de dépendance Tailwind). `npm publish` passe par `prepack`. README npm en
anglais + LICENSE MIT avec crédit Base UI (© Material-UI SAS). Les démos
(`src/demos/`) et routes sont hors package (`files: ["dist"]`).

## Historique Phase 1 (socle)

### Parité moteur avec useSwipeDismiss v1.6.0

- **Transform initial composé** : snapshot du transform courant (translate+scale) au start, drag = `translate3d(initial+delta) scale(scale)` ; vars = delta ; progress = displacement/(size×scale). Attraper le drawer en pleine animation ne saute plus.
- **Snapshot/restore des styles inline** (transition/transform) au lieu de removeProperty.
- **Commit du release sur `buttons===0`** (#5057) : le move final traverse le pipeline (déplacement + vélocité pic conservés) puis handleEnd. Cancel si bouton non-primaire.
- **Pending re-attempt depuis un bord de scroll** : le start pos d'origine est préservé → les flicks depuis une liste scrollable peuvent dismiss.
- **Vélocités upstream** : `velocityX/Y` = delta total / durée totale (≥50ms) pour le check FAST_SWIPE (0.5) ; `releaseVelocityX/Y` = delta depuis le dernier sample / âge (≤80ms sinon 0).
- **Ignore selector interactifs** (button,a,input,select,textarea,label,[role=button]) pour les swipes pointer ; touch passe (désambiguïsation par mouvement).
- **preventDefault sur pointermove** pendant le drag (anti-sélection Safari) + checks `defaultPrevented`.
- **Reverse-cancel** : baseline re-ancrée à chaque inversion, un-cancel au-delà du swipeThreshold complet.

### Pilotage natif du touch (#4980)

Un SEUL handler natif capture `touchmove` (document, passive:false) décide preventDefault/stopPropagation ET pilote le moteur via `moveNative`. Plus de double chemin élément/document. Les handlers d'élément ne gèrent que touchstart/end/cancel.

### Dismiss synchrone

Au release décidé : `data-swipe-dismiss` + `data-ending-style` posés synchroniquement sur popup ET backdrop, transition inline retirée, `--drawer-swipe-strength` posé sur les deux (fade backdrop synchronisé avec le popup). Revert via rAF si le consommateur contrôlé rejette la fermeture. Ces attributs sont gérés IMPÉRATIVEMENT (jamais dans les templates Svelte, sinon un re-render les retire en plein dismiss).

### Swipe pointer (desktop)

Les handlers pointer sont sur le **Viewport**, gated non-touch. Le swipe ne démarre jamais depuis `[data-drawer-content]` (la sélection de texte à la souris y reste possible) ni depuis un élément interactif. `canStart` exige elementFromPoint dans le popup.

### VirtualKeyboardProvider (porté de #4353)

- `--drawer-keyboard-inset` via `visualViewport` (seuil 60px pour distinguer clavier / chrome navigateur)
- Scroll slack : padding-bottom + scroll-padding-bottom + overflow-anchor:none injectés sur le conteneur scrollable
- Centrage smooth du champ focusé (respecte prefers-reduced-motion)
- Tap-to-focus synchrone iOS : preventDefault du touchend + focus off-screen + click redispatché ; hit-slop 16px ; sentinel tap-bloqué ; résolution label→control et contenteditable host ; passthrough caret/pinch-zoom
- Branché via `VirtualKeyboardContext` lu par le Viewport, hooks appelés depuis touchstart/end/cancel élément et le touchmove natif

### onOpenChange

Chemin unique : le setter du box `open` (swipe dismiss) OU le prop onOpenChange passé à Dialog.Root (escape/outside/close). Plus de double appel.

## Pièges résolus (à ne pas réintroduire)

- **Notifications cross-state dans les $effect** : un `$effect`qui appelle une méthode
lisant PUIS écrivant le même signal (ex:`parent.onNestedOpenChange`et`nestedOpenDrawerCount`) s'auto-invalide → boucle infinie silencieuse (l'erreur
effect_update_depth n'apparaît qu'en console). Toujours `untrack()` les appels de
  notification dans les effects, et untrack la lecture dans les méthodes compteur.
- **Reset du snap point à la FERMETURE, pas à l'ouverture** (parité upstream) : un reset
  on-open depuis un effect du viewport peut re-tourner après un release et écraser le
  snap point choisi. `resetAfterOpen` doit rester idempotent et sans écriture de prop.
- **Dismissal bits-ui débouncée** : l'interact-outside de bits-ui est différée (~10ms
  debounce + ghost clicks touch). Le SwipeArea garde `outsidePressDisabled` après le
  release jusqu'à la prochaine interaction qui n'est pas le click de release du geste
  (guard capture `pointerdown`/`click` + `isVirtualClick`, déterministe — upstream
  v1.7.0), sinon le geste qui vient d'ouvrir le drawer le referme.
- **Test en onglet caché** : `requestAnimationFrame` ne tourne pas dans un onglet masqué →
  le retrait de `data-starting-style` par bits-ui ne se fait jamais et le drawer semble
  bloqué à sa position d'entrée. Ce n'est PAS un bug du code — forcer des frames via
  des captures d'écran CDP pour tester.
- **bits-ui v2** utilise `data-starting-style` / `data-ending-style` (pas `data-transition`).
- **Vars d'état dans le style TEMPLATE du Popup, per-frame impératif** : bits-ui réécrit
  l'attribut style complet lors de ses re-renders (ex. son nested count change dans un flush
  postérieur à nos effects) et efface tout `setProperty()`. Les vars pilotées par l'état
  (snap offset, `--nested-drawers`, hauteurs, strength) vivent donc dans le style template
  (comme le style prop React upstream) ; SEULS les styles per-frame du moteur
  (transform/transition/vars de mouvement, progress pendant un swipe) restent impératifs,
  et la chaîne de style template ne doit jamais changer mid-drag (hauteurs échantillonnées
  hors swipe — en mode snap la hauteur mesurée suit la var de mouvement chaque frame).
  Voir HANDOFF piège n°1.
- **Auto-focus bits-ui sans preventScroll** : intercepté dans le Popup (focus du popup à
  l'ouverture, retour à l'élément précédent à la fermeture, `preventScroll: true`) — sinon
  scroll parasite de tout ancêtre scrollable/overflow-hidden (contenu scrollé en fin,
  conteneur de portal qui saute pendant un swipe-to-open). HANDOFF piège n°12.
- **Progress parent resetté quand un nested se ferme/démonte** (effet viewport, HANDOFF
  n°13) — sinon le parent garde ~1 après un swipe dismiss et ne s'empile plus.
- **Viewport `pointer-events: auto` quand open** : le scroll lock bits-ui met le body en
  `none` (upstream jamais) ; requis pour la molette sur les scrollers pleine page
  (mobile-nav). HANDOFF n°14.
- **`mergeProps` obligatoire** pour chaîner des handlers homonymes (un spread écrase silencieusement).
- **Attributs impératifs vs template** : un attribut posé via setAttribute survit aux re-renders SEULEMENT s'il n'apparaît jamais dans le template/spread. `data-swipe-dismiss`/`data-ending-style` sont impératifs only.
- **Effets enfant avant parent** au mount initial en Svelte : le warning "no viewport" du Popup est vérifié dans un queueMicrotask.
- **`swipeDirection` réactif** : passé en getter au state (sinon warning state_referenced_locally + valeur figée).
- **`frontmostHeight` ne survit jamais au popup** : reset à 0 au démontage
  (`setPopupHeight(0)`), sinon la valeur périmée est poussée au parent à la
  RÉOUVERTURE du nested avant le mount de l'enfant → le `height` du parent
  passe `auto`→px en un seul recalc (non interpolable, pas de transition) →
  le parent saute. La 1re ouverture est fluide car la hauteur enfant n'arrive
  qu'après mount/mesure (retarget px→px animable). HANDOFF piège n°15.

## Reste à faire / pistes

- **Tests sur appareils réels iOS/Android** : gestes touch, clavier virtuel (tap-to-focus
  synchrone, scroll slack), CloseWatcher — non simulables en preview desktop.
- Trigger registration pour le SwipeArea (retour de focus) — bits-ui n'a pas d'équivalent
  direct de `useTriggerRegistration`.
- `snapPoints` + `swipeDirection` up : le mouvement override dans `handleSwipeProgress`
  n'est appliqué que pour "down" (comme upstream).
- ~~Éventuel package~~ FAIT et PUBLIÉ sur npm (`svelte-base-drawer`, remote
  GitHub `legowhales/svelte-base-drawer`). Le naming `Drawer.Handle` est parti
  tel quel en 0.1.x (divergence upstream, voir HANDOFF §6) — renommage
  éventuel via alias + dépréciation avant la 1.0.
