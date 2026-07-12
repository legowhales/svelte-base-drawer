# HANDOFF — Drawer Svelte (port de base-ui v1.6.0)

Document de passation. Tout ce qu'il faut pour reprendre le travail sans le
contexte des sessions précédentes. À lire avec le `CLAUDE.md` (état résumé) ;
ce document est la version détaillée.

---

## 1. Contexte et objectif

Port du composant **Drawer de base-ui** (React, `@base-ui/react`) vers
**Svelte 5**, en utilisant **bits-ui Dialog** comme fondation (accessibilité,
focus trap, escape, outside-press, portal, presence/transitions).

**Référence upstream : base-ui v1.6.0** — fichiers sources de référence :

- `packages/react/src/drawer/**` (tous les composants)
- `packages/react/src/utils/useSwipeDismiss.ts` (moteur de gestes)
- `packages/react/src/utils/scrollable.ts`
- Démos : `docs/src/app/(docs)/react/components/drawer/demos/**`

Pour re-cloner la référence :

```bash
git clone --depth 1 --branch v1.6.0 --filter=blob:none --sparse https://github.com/mui/base-ui.git
cd base-ui && git sparse-checkout set packages/react/src/drawer packages/react/src/utils "docs/src/app/(docs)/react/components/drawer"
```

**Motivation du projet** : le Drawer base-ui est le mieux optimisé du marché
pour le mobile (gestion du clavier virtuel, arbitrage scroll/swipe natif,
vélocités calibrées). Aucun équivalent Svelte n'existait.

## 2. État : TERMINÉ à parité fonctionnelle v1.6.0

- **Phase 1** : moteur de swipe à parité `useSwipeDismiss` v1.6.0, anatomie
  upstream, pilotage natif du touch, dismiss synchrone, scroll lock.
- **Phase 2** : snap points, nested drawers, SwipeArea (swipe-to-open),
  Provider/Indent/IndentBackground, VirtualKeyboardProvider, CloseWatcher
  Android, CSS 4 directions.
- **8 démos** (basique + 7 portées de la doc base-ui) sous `src/demos/*`,
  toutes affichées sur la page de doc unique (`src/routes/+page.svelte`).
- **Packagé pour npm** sous le nom `svelte-base-drawer` (voir §6, entrée
  "Publication npm").
- `npm run check` : 0 erreur, 0 warning.
- Vérifié par gestes simulés en navigateur (voir §7) : snap back, dismiss
  vélocité-scalé, expand/collapse entre snap points, stacking nested à 3
  niveaux, swipe-to-open, garde-fous (pas de swipe depuis input/zone de texte).
- **PAS ENCORE testé sur appareil réel iOS/Android** (voir §6).

## 3. Anatomie et API publique

```svelte
<Drawer.Root
	bind:open
	bind:snapPoint
	{snapPoints}
	snapToSequentialPoints
	swipeDirection="down"
	onOpenChange
	onSnapPointChange
>
	<Drawer.Trigger />
	<!-- re-export bits-ui -->
	<Drawer.SwipeArea />
	<!-- optionnel : ouverture par swipe depuis un bord -->
	<Drawer.VirtualKeyboardProvider>
		<!-- optionnel : clavier virtuel mobile -->
		<Drawer.Portal to={container}>
			<!-- re-export bits-ui -->
			<Drawer.Backdrop forceRender={false} />
			<Drawer.Viewport>
				<!-- OBLIGATOIRE : host de tous les gestes -->
				<Drawer.Popup trapFocus preventScroll>
					<!-- le panneau (bits-ui Dialog.Content) -->
					<Drawer.Handle />
					<Drawer.Title />
					<Drawer.Description />
					<Drawer.Close />
					<!-- re-exports -->
					<Drawer.Content />
					<!-- zone scrollable ([data-drawer-content]) -->
				</Drawer.Popup>
			</Drawer.Viewport>
		</Drawer.Portal>
	</Drawer.VirtualKeyboardProvider>
	<!-- Provider/Indent/IndentBackground s'utilisent AUTOUR du Root (voir démo indent) -->
</Drawer.Root>
```

⚠️ **Ne pas confondre avec l'ancienne V1 du projet** : l'ancien
`Drawer.Content` est devenu `Drawer.Popup` ; `Drawer.Overlay` est devenu
`Drawer.Backdrop`. `Drawer.Content` désigne maintenant la zone scrollable
(sémantique upstream).

### CSS vars (registerProperty, inherits: false)

| Var                            | Élément                                         | Rôle                                            |
| ------------------------------ | ----------------------------------------------- | ----------------------------------------------- |
| `--drawer-swipe-movement-x/-y` | popup                                           | déplacement pendant le drag (px)                |
| `--drawer-swipe-progress`      | backdrop (+ popup parent si nested, + indent)   | 0–1 fade                                        |
| `--drawer-swipe-strength`      | popup ET backdrop                               | 0.1–1, scalaire durée du dismiss                |
| `--drawer-snap-point-offset`   | popup                                           | offset du snap point actif (px)                 |
| `--drawer-height`              | popup (gelé si nested/ending), backdrop, indent | hauteur mesurée                                 |
| `--drawer-frontmost-height`    | popup                                           | hauteur du drawer le plus en avant du stack     |
| `--nested-drawers`             | popup                                           | nombre de drawers imbriqués ouverts (récursif)  |
| `--drawer-keyboard-inset`      | viewport                                        | inset clavier virtuel (VirtualKeyboardProvider) |

### Data attributes

- Popup : `data-drawer-popup`, `data-swipe-direction`, `data-swiping`,
  `data-expanded` (snap === 1), `data-nested`, `data-nested-drawer-open`,
  `data-nested-drawer-swiping`, `data-swipe-dismiss` (impératif),
  - ceux de bits-ui (`data-starting-style`, `data-ending-style`…).
- Backdrop : `data-drawer-backdrop`, `data-swiping`, `data-swipe-dismiss`.
- Viewport : `data-drawer-viewport`, `data-open`/`data-closed`.
- SwipeArea : `data-drawer-swipe-area`, `data-open`/`data-closed`,
  `data-swiping`, `data-swipe-direction`, `data-disabled`.
- Indent/IndentBackground : `data-drawer-indent(-background)`,
  `data-active`/`data-inactive`.
- Opt-out global : `data-swipe-ignore` (aucun swipe ne démarre dessus).

## 4. Carte des fichiers

### `src/lib/drawer/internal/`

- **`create-swipe-gesture.svelte.ts`** — moteur de gestes. Port ligne-à-ligne
  de `useSwipeDismiss` v1.6.0 : transform initial composé
  (`translate3d(initial+delta) scale(scale)`), snapshot/restore des styles
  inline, commit du release sur `buttons===0` (le move final traverse le
  pipeline avant handleEnd), cancel sur bouton non-primaire, pending
  re-attempt depuis un bord de scroll avec préservation du start pos,
  vélocité totale (`velocityX/Y` = delta/durée ≥50ms) + release velocity
  (delta du dernier sample / âge ≤80ms), damping √ par axe, ignore selector
  interactifs pour le pointer, `moveNative(event, boundary)` pour le pilotage
  capture-phase. Expose `pointerHandlers`, `touch.{start,move,end,cancel}`,
  `swiping`/`swipeDirection`/`dismissed` réactifs, `reset()`.
- **`create-drawer-touch-scroll.svelte.ts`** — interception touch. UN SEUL
  handler natif `touchmove` (document, capture, passive:false) qui décide
  preventDefault/stopPropagation ET pilote le moteur via `moveNative`
  (port du #4980). Handlers élément : touchstart/end/cancel + hooks du
  clavier virtuel. Logique `allowSwipe` tri-état, cross-axis preserve,
  range inputs, pinch, sélection de texte.
- **`drawer-state.svelte.ts`** — cœur. `DrawerRootState` (classe + Context
  runed) : wiring moteur/touch-scroll, physique du release
  (`handleSwipeRelease` sans snap / `handleSnapPointsRelease` avec),
  `startSwipeRelease` (dismiss synchrone : `data-swipe-dismiss` +
  `data-ending-style` + strength posés sur popup ET backdrop au release),
  progress backdrop + provider + parent (`handleSwipeProgress`,
  `applySwipeProgress`), coordination nested (`onNested*`), mesures
  (`trackPopupHeight` avec gel nested, `trackViewportSize`), dérivés snap
  (`resolvedSnapPoints`, `activeSnapPointOffset`, `snapPointRange`,
  `snapPointOffsetValue`, `expanded`), `createViewportHandlers()`,
  `resetAfterOpen()` (idempotent, SANS écriture de prop), revert rAF si un
  consommateur contrôlé rejette la fermeture. Exporte `DRAWER_CSS_VARS` et
  `registerDrawerCSSProperties()`.
- **`snap-points.ts`** — résolution pure des snap points (fraction ≤1 de la
  hauteur viewport, >1 px, strings px/rem), dédup ±1px (garde la dernière
  occurrence), `getSnapPointSwipeMovement` (damping √ en overshoot),
  `resolveActiveSnapPoint` (match exact par `Object.is` puis plus proche).
- **`drawer-provider.svelte.ts`** — `DrawerProviderState` (registre des
  drawers ouverts → `active`) + `visualStateStore` (store impératif
  swipeProgress/frontmostHeight, subscribe/set, PAS de $state — haute
  fréquence sans re-render).
- **`create-virtual-keyboard.svelte.ts`** — port complet de
  `DrawerVirtualKeyboardProvider` : `--drawer-keyboard-inset` via
  `visualViewport` (seuil 60px), scroll slack (padding-bottom +
  scroll-padding-bottom + overflow-anchor sur le conteneur scrollable),
  centrage smooth du champ focusé, tap-to-focus synchrone iOS (preventDefault
  touchend + focus off-screen + click redispatché, hit-slop 16px, sentinel
  KEYBOARD_TAP_BLOCKED, résolution label→control et contenteditable host,
  passthrough caret/pinch-zoom). Expose `VirtualKeyboardContext` (hooks
  onTouchStart/Move/End/Cancel consommés par le Viewport).
- **`utils.ts`** — helpers purs : traversal shadow-DOM-aware
  (`getParentNode` qui déballe les ShadowRoot), `findScrollableTouchTarget`
  (+ `allowOverflowIntent` pour le scroll slack), `hasScrollableAncestor`,
  scroll edges, sélection de texte, range inputs, `getElementTransform`,
  `getEventTarget` (composedPath), `safelyChangePointerCapture` (avale
  NotFoundError), sélecteurs `data-swipe-ignore`/`data-drawer-content`.

### `src/lib/drawer/components/`

- **`drawer-root.svelte`** — props open/snapPoint ($bindable), crée le state
  (lit les contextes parent/provider AVANT de poser le sien), box `open` dont
  le setter est LE chemin unique de notification interne (swipe dismiss,
  CloseWatcher) ; les fermetures bits-ui (escape/outside/close) notifient via
  le prop `onOpenChange` passé à Dialog.Root. Effects : reset du snap point à
  la FERMETURE, enregistrement provider, notifications nested (untracked !),
  CloseWatcher Android (topmost uniquement).
- **`drawer-viewport.svelte`** — `{#if drawer.mounted}` (mounted = open ||
  popupElement, suit la présence bits-ui pendant l'exit), enregistre
  viewportElement + hooks clavier, listener natif touchmove, reset-on-open,
  trackViewportSize, sync du progress backdrop quand le snap change sans
  swipe, reset du progress parent quand un drawer NESTED se ferme/démonte
  (parité upstream — sinon le parent garde ~1 après un swipe dismiss et ne
  reprend pas sa position empilée à la réouverture), spread des handlers
  gestes (pointer gated non-touch ; jamais depuis `[data-drawer-content]` ni
  `[data-swipe-ignore]`). `pointer-events: auto` explicite quand open : le
  scroll lock bits-ui met le body en `pointer-events: none`, le viewport doit
  se ré-activer pour que les scrollers pleine-page (pattern mobile-nav)
  reçoivent la molette partout (upstream ne désactive jamais le body).
- **`drawer-popup.svelte`** — wrappe `Dialog.Content` (child snippet), props
  `trapFocus`/`preventScroll` (mettre false×2 pour non-modal), registre
  popupElement + trackPopupHeight, warning dev si pas de Viewport
  (queueMicrotask), style TEMPLATE pour les vars pilotées par l'état
  (`--drawer-snap-point-offset`, `--nested-drawers`, `--drawer-height`,
  `--drawer-frontmost-height`, `--drawer-swipe-strength`, progress à 0 —
  voir piège n°1), interception de `onOpenAutoFocus`/`onCloseAutoFocus` :
  focus du POPUP à l'ouverture et retour à l'élément précédent à la
  fermeture, les deux avec `preventScroll: true` (le focus par défaut de
  bits-ui scrolle les ancêtres scrollables/overflow-hidden pour révéler le
  premier tabbable — contenu scrollé en fin, conteneurs de portal qui
  sautent), `handleInteractOutside` qui respecte
  `drawer.outsidePressDisabled` (SwipeArea).
- **`drawer-backdrop.svelte`** — wrappe `Dialog.Overlay`, non rendu si nested
  (sauf `forceRender`), registre backdropElement.
- **`drawer-content.svelte`** — simple div `[data-drawer-content]` (zone
  scrollable ; bloque le swipe pointer, touch-action: auto en CSS).
- **`drawer-swipe-area.svelte`** — swipe-to-open. Second moteur en mode
  inverse (`trackDrag: false`, direction = opposé du dismiss), ouvre dès 1px
  de déplacement, positionne le popup impérativement depuis l'offset fermé
  (résolu depuis le transform courant si ré-attrapé en pleine animation),
  damping √ passé la pleine ouverture, seuil d'ouverture 50 % de la taille du
  popup OU vélocité ≥ 0.1, `outsidePressDisabled` pendant le geste + 300ms.
- **`drawer-provider.svelte` / `drawer-indent.svelte` /
  `drawer-indent-background.svelte`** — indent effect. L'Indent synchronise
  `--drawer-swipe-progress`/`--drawer-height` impérativement via le
  visualStateStore (subscribe dans un $effect).
- **`drawer-virtual-keyboard-provider.svelte`** — crée les hooks, pose le
  contexte. Doit englober le Portal, dans le Root.
- **`drawer-handle.svelte`** — indicateur visuel (pas d'équivalent upstream ;
  leur `Drawer.Handle` exporté est le DialogHandle des triggers détachés —
  rien à voir).

### Autres

- **`src/lib/drawer/drawer.css`** — CSS de départ opt-in pour consommateurs
  (sélecteurs d'attributs, 4 directions, bleed, presence states).
  ⚠️ PAS importé par les pages de démo (voir pièges).
- **`src/lib/drawer/index.ts`** — exports du module drawer.
- **`src/lib/index.ts`** — entrée du package npm (`export * from "./drawer"`);
  c'est ce fichier que `svelte-package` publie comme `dist/index.js`.
- **`src/routes/+page.svelte`** — page de doc unique : intro/install/usage,
  les 8 démos en sections, référence CSS vars + data attributes, crédits.
- **`src/demos/`** — composants de démo réutilisés par la page de doc :
  `Basic/SnapPoints/Nested/VirtualKeyboard/Indent/MobileNav/SwipeToOpen/ActionSheet.svelte`
  - CSS préfixé par démo (`.basic-*`, `.snap-*`, `.nested-*`, `.vk-*`,
    `.indent-*`, `.nav-*`, `.swipe-*`, `.sheet-*`) + `shared.css`
    (`.demo-button`, `.demo-page`). Hors de `src/lib` pour ne pas être packagés.

## 5. Invariants et pièges (NE PAS RÉINTRODUIRE)

1. **Styles/attributs : template pour l'état, impératif pour le per-frame.**
   bits-ui réécrit l'attribut `style` complet du popup lors de SES re-renders
   (ex. `--bits-dialog-nested-count` change quand un dialog nested
   s'enregistre, dans un flush POSTÉRIEUR à nos effects) — toute valeur posée
   par `setProperty` est alors effacée sans que nos effects re-tournent.
   Règle : les vars pilotées par l'état (`--drawer-snap-point-offset`,
   `--nested-drawers`, `--drawer-height`, `--drawer-frontmost-height`,
   `--drawer-swipe-strength`, progress par défaut 0) vivent dans le style du
   TEMPLATE du Popup (comme le style prop upstream) — chaque réécriture les
   inclut. Les styles PER-FRAME du moteur (transform/transition/vars de
   mouvement, progress pendant un swipe) restent impératifs : la chaîne de
   style du template ne doit JAMAIS changer pendant un drag, sinon Svelte
   réécrit l'attribut et efface le drag en cours. C'est pour ça que les vars
   de hauteur sont ÉCHANTILLONNÉES hors swipe (en mode snap, la hauteur
   mesurée suit la var de mouvement à chaque frame via le padding-bottom).
   Les data-attributes `data-swipe-dismiss` / `data-ending-style` synthétique
   restent impératifs only (jamais dans le template — un attribut hors spread
   survit aux re-renders).
2. **`untrack()` sur toute notification cross-state depuis un `$effect`.**
   Une méthode qui lit PUIS écrit le même signal (ex. `onNestedOpenChange` /
   `nestedOpenDrawerCount`) s'auto-invalide → boucle infinie silencieuse
   (l'erreur effect_update_depth n'apparaît qu'en console). Les effects de
   notification du Root untrack leurs appels ; les méthodes compteur
   untrack leur lecture.
3. **Reset du snap point à la FERMETURE, pas à l'ouverture** (parité
   upstream). `resetAfterOpen` doit rester idempotent et sans écriture de
   prop : l'effect qui l'appelle peut re-tourner.
4. **`onOpenChange` : chemin unique.** Le setter du box `open` (Root) notifie
   pour les fermetures internes ; bits-ui notifie via son prop pour
   escape/outside/close. Ne pas ajouter d'appel ailleurs (double
   notification).
5. **Dismissal bits-ui débouncée.** L'interact-outside est différée (~10ms
   debounce, + click listener one-shot pour le touch → ghost clicks). D'où
   la fenêtre `outsidePressDisabled` de 300ms du SwipeArea.
6. **Scroll lock bits-ui compatible.** `preventScroll` (défaut true) : lock
   CSS + `pointerEvents: none` sur body (le popup/backdrop re-activent via
   style inline bits-ui, le viewport hérite none → les événements bubblent
   quand même depuis le popup ; `elementFromPoint` fonctionne car le popup
   est `auto`). Le listener touchmove iOS de bits-ui ne bloque que
   `documentElement` → pas de conflit avec notre arbitrage.
7. **`mergeProps` obligatoire** pour chaîner des handlers homonymes.
8. **bits-ui v2** : `data-starting-style`/`data-ending-style` (pas
   `data-transition`), retrait du starting-style via rAF + MutationObserver.
9. **Effets enfant avant parent au mount** : le warning "no viewport" du
   Popup est vérifié dans un `queueMicrotask`.
10. **`swipeDirection`/`snapPoints`/etc. passés en GETTERS au state** (sinon
    warning `state_referenced_locally` + valeur figée).
11. **CSS des démos ≠ CSS de la lib.** Ne jamais importer `drawer.css` dans
    une page de démo : ses sélecteurs d'attributs (spécificité 0,2,0)
    écraseraient les classes des démos, et le CSS importé par une route fuit
    sur les autres en navigation client. Les démos utilisent des classes
    préfixées par démo.
12. **Auto-focus bits-ui = scroll parasite.** Le FocusScope de bits-ui focus
    le premier tabbable via `.focus()` SANS `preventScroll` (à l'ouverture,
    dans un rAF, pendant que le popup est encore à sa position d'entrée
    off-screen) : tout ancêtre scrollable — y compris `overflow: hidden` —
    est scrollé pour le révéler (Drawer.Content scrollé en fin, conteneur de
    portal décalé, "jump" pendant un swipe-to-open). Le Popup intercepte
    open/close auto-focus et focus popup/élément-précédent avec
    `preventScroll: true` (comportement FloatingFocusManager upstream). Ne
    pas retirer cette interception.
13. **`--drawer-swipe-progress` du parent : reset à la fermeture du child.**
    Le child écrit le progress sur le popup parent pendant SON swipe ; à sa
    fermeture (tout chemin) et à son démontage, le viewport du child notifie
    0 (effet dans drawer-viewport, parité upstream). Sans ça, après un swipe
    dismiss le parent reste à ~1 et ne s'empile plus à la réouverture.
14. **Viewport `pointer-events: auto` quand open.** Compense le
    `pointer-events: none` que le scroll lock bits-ui pose sur le body
    (upstream n'en pose jamais). Nécessaire pour la molette sur les scrollers
    au niveau du viewport (mobile-nav) ; les clics sur le viewport hors popup
    restent des outside-press (dismiss) comme un clic backdrop.
15. **`frontmostHeight` ne doit jamais survivre au popup.** Au démontage du
    popup, `setPopupHeight(0)` remet aussi `frontmostHeight` à 0 (et
    `onNestedFrontmostHeightChange(0)` retombe sur `popupHeight` même nul).
    Sans ça, à la RÉOUVERTURE d'un nested la valeur périmée est poussée au
    parent (effet de notification du Root, qui tourne sur le flip de `open`,
    AVANT le mount du popup enfant) dans le même flush que `--nested-drawers`
    / `data-nested-drawer-open` : le `height` du parent passe de `auto` à la
    hauteur de l'enfant en un seul recalc de style — `auto` n'étant pas
    interpolable, aucune transition ne part → le parent SAUTE (~76px sur la
    démo). La 1re ouverture est fluide précisément parce que le parent
    n'apprend la hauteur de l'enfant qu'APRÈS son mount/mesure : la lecture
    d'`offsetHeight` du mount force un recalc intermédiaire qui épingle le
    `height` du parent en px, et le retarget px→px suivant est animable.
    Pas de seam de test automatisé pour ce pattern (interpolabilité CSS +
    timing de flush — il faudrait un harnais e2e navigateur, inexistant à ce
    jour) ; recette manuelle : ouvrir/fermer/rouvrir le nested et vérifier
    l'absence de saut (enregistrement rAF de `getBoundingClientRect().top`).

## 6. Points connus à corriger / améliorer (pour le repreneur)

- **Tests sur appareils réels iOS/Android** — première passe mobile validée
  le 2026-07-12 (démos OK sur l'appareil du propriétaire, via un build
  partagé). Reste à couvrir systématiquement : tap-to-focus clavier, scroll
  slack, ghost clicks, CloseWatcher Android, inertie. La démo
  `virtual-keyboard` (sticky footer `:focus-within`) est le banc d'essai
  principal. Dev server : `npm run dev` (port 5173), accessible sur le
  réseau local avec `--host`.
- **Partager un build sur mobile** : le projet est en `adapter-static`
  (toutes les routes prérendues via `src/routes/+layout.ts`).
  `npm run build` puis `sher link --no-build --dir build` (CLI sher.sh,
  `sher login` requis) → URL éphémère 24h.
- **Publication npm** : le package est prêt (`svelte-base-drawer@0.1.0`,
  nom vérifié disponible le 2026-07-12). `npm run package` construit `dist/`
  (`svelte-package`) et lance `publint` ; `npm publish` déclenche tout via
  `prepack`. bits-ui et svelte sont en `peerDependencies`, `drawer.css`
  exporté sous `svelte-base-drawer/drawer.css` (rendu autonome : la var
  Tailwind `--color-stone-200` a été remplacée par sa valeur littérale).
  Champ `repository` ajouté (remote GitHub `legowhales/svelte-base-drawer`).
  Le naming `Drawer.Handle` est publié tel quel en 0.1.x (voir plus bas) —
  un renommage éventuel se fera via alias + dépréciation avant la 1.0.
- **Démo indent** : la mécanique est validée (data-active, portal local,
  scale) mais le layout du cadre mérite un polish visuel (positionnement du
  popup dans le petit cadre).
- **SwipeArea : pas de trigger registration** (retour de focus vers la zone
  au close) — bits-ui n'a pas d'équivalent de `useTriggerRegistration`.
- **Snap points + `swipeDirection="up"`** : l'override de mouvement dans
  `handleSwipeProgress` n'est appliqué que pour "down" (comme upstream, qui a
  le même TODO).
- **`Drawer.Handle` divergence de naming** : notre Handle = indicateur
  visuel ; l'upstream exporte sous ce nom le DialogHandle (triggers
  détachés). Si la lib est publiée, trancher le naming.
- **Événements non typés "reasons"** : upstream passe des `eventDetails`
  (reason: swipe/escape/…) à onOpenChange/onSnapPointChange ; notre port ne
  les expose pas (signatures simples `(open: boolean)` /
  `(snapPoint | null)`).
- **`actionsRef`, `modal='trap-focus'`, `handle`/payload d'upstream** : non
  portés (peu demandés ; `trapFocus`/`preventScroll` couvrent le non-modal).

## 7. Comment vérifier (recettes de test)

- `npm run check` — 0 erreur attendu.
- `npm run package` — build du package + publint, "All good!" attendu.
- `npm run dev` → `http://localhost:5173` (page de doc unique, 8 démos).
- **⚠️ Piège majeur : onglet en arrière-plan.** `requestAnimationFrame` ne
  tourne pas dans un onglet masqué → bits-ui ne retire jamais
  `data-starting-style` et le drawer semble figé à sa position d'entrée. Ce
  n'est PAS un bug du code. En pilotage CDP, forcer des frames en prenant des
  captures d'écran entre les étapes (chaque capture force un BeginFrame).
- **Simuler un swipe pointer** (les vrais pointeurs ont la capture ; en
  synthétique, dispatcher le pointerdown sur l'élément sous le point, puis
  TOUS les moves/up sur le POPUP, sinon les moves sortis du popup atterrissent
  sur le backdrop et n'atteignent jamais les handlers du viewport) :
  ```js
  const popup = document.querySelector('[data-drawer-popup]');
  const ev = (type, x, y, buttons) =>
  	new PointerEvent(type, {
  		bubbles: true,
  		cancelable: true,
  		clientX: x,
  		clientY: y,
  		button: 0,
  		buttons,
  		pointerId: 1,
  		pointerType: 'mouse',
  		isPrimary: true,
  		view: window
  	});
  document.elementFromPoint(x, y0).dispatchEvent(ev('pointerdown', x, y0, 1));
  for (const y of steps) popup.dispatchEvent(ev('pointermove', x, y, 1));
  popup.dispatchEvent(ev('pointerup', x, yEnd, 0));
  ```
  Notes : le premier move est absorbé (compensation iOS re-ancre le start) —
  prévoir la distance en conséquence ; le seuil de dismiss/open est 50 % de la
  taille du popup ; des dispatches synchrones (sans sleep) = timeStamps
  identiques = vélocités min/max selon le chemin (utile pour tester le
  fast-swipe, piégeux pour le reste).
- **Assertions utiles** : pendant le drag → `popup.style.transform`
  (translate3d composé, sauf snap mode où il est retiré),
  `--drawer-swipe-movement-y`, `data-swiping` sur popup+backdrop,
  `--drawer-swipe-progress` sur le backdrop. Au release-dismiss →
  `data-swipe-dismiss` + `data-ending-style` + `--drawer-swipe-strength`
  posés synchroniquement sur popup ET backdrop. Snap →
  `--drawer-snap-point-offset`, `data-expanded`.

## 8. Historique des sessions (2026-07-11)

1. **Audit** : comparaison ligne-à-ligne du port V1 contre base-ui v1.6.0 ;
   identification de 6 écarts moteur + anatomie obsolète.
2. **Phase 1** : réécriture moteur/touch-scroll/state, nouvelle anatomie
   (Backdrop/Viewport/Popup/Content), dismiss synchrone, fix double
   onOpenChange, scroll lock activé, VirtualKeyboardProvider porté.
3. **Phase 2** : snap points, nested, SwipeArea, Provider/Indent,
   CloseWatcher, 4 directions, 7 démos. Bugs réels trouvés en vérification
   (et corrigés) : boucle d'effect sur `nestedOpenDrawerCount` (→ untrack),
   `--nested-drawers` non récursif (→ forward parent), reset snap fragile
   (→ on-close), fenêtre outside-press du SwipeArea (→ 300ms).
4. **Corrections post-passation** (bugs remontés sur les démos) :
   auto-focus bits-ui sans preventScroll (→ interception open/close
   auto-focus dans le Popup, piège n°12 — corrigeait snap-points scrollé en
   fin, mobile-nav scrollé au milieu, indent décalé, jump du swipe-to-open) ;
   réécriture du style attr par bits-ui qui effaçait les vars impératives du
   popup (→ vars d'état dans le style template, piège n°1 réécrit —
   corrigeait le jump nested et `transform: none`) ; progress parent jamais
   resetté à la fermeture du child (→ effet viewport, piège n°13 — le parent
   ne s'empilait plus à la réouverture) ; body `pointer-events: none` du
   scroll lock (→ viewport auto quand open, piège n°14 — molette partout
   dans mobile-nav).
5. **Packaging npm + doc unique (2026-07-12)** : package `svelte-base-drawer`
   (bits-ui/svelte en peerDependencies, `svelte-toolbelt` retiré — inutilisé,
   exports `.` + `./drawer.css`, `files: dist`, publint OK, tarball 48 ko) ;
   entrée `src/lib/index.ts` ; démos extraites en composants `src/demos/*`
   affichés sur une page de doc unique ; README npm + LICENSE (MIT, crédit
   Base UI © Material-UI SAS) ; favicon déplacé de `src/lib/assets` vers
   `static/`. Vérifié : les 8 démos s'ouvrent/ferment sur la page combinée,
   stacking nested OK, focus intercepté (scrollTop 0). Piège pane re-confirmé :
   compositeur du navigateur intégré gelé → portal bits-ui ne monte pas
   (rAF starvation) ; un resize_window relance les frames.
6. **Retouches page unique (2026-07-12)** : `z-index: 50` ajouté sur
   backdrop+viewport des 5 démos plein écran (mobile-nav, snap-points, nested,
   virtual-keyboard, action-sheet) — en pages séparées rien ne se chevauchait,
   mais sur la page combinée le `.swipe-area` (z-index 1, positionné) passait
   au-dessus des drawers en `z-index: auto` et intercept les clics (bouton « x »
   du mobile-nav). Démo basic réécrite dans le langage visuel commun
   (`src/demos/basic.css`, bordure noire/ombre dure) avec contenu réaliste :
   email en tête, texte scrollable, second input, Close.
7. **Fix saut du parent à la réouverture d'un nested (2026-07-12)** :
   `frontmostHeight` périmé après démontage du popup enfant → poussé au parent
   avant le remount → `height` du parent `auto`→px en un recalc, non
   interpolable, saut sec. Corrigé dans `setPopupHeight` (reset à 0 au
   démontage) + `onNestedFrontmostHeightChange` (retombe sur `popupHeight`
   même nul). Voir piège n°15.
8. **Fix cible SVG dans `getTargetAtPoint`** : le port filtrait le target avec
   `isHTMLElement` là où l'upstream ne fait qu'un cast TypeScript. Un clic
   pointer sur une icône `<svg>` dans un bouton (le « x » du mobile-nav)
   donnait donc `target: null` → le sélecteur d'ignore interactif ne matchait
   pas → un swipe démarrait avec `setPointerCapture` et le `click` re-ciblé
   n'atteignait jamais le bouton Close. Corrigé : narrowing sur `Element`
   (dont `closest()` suffit), `hasScrollableAncestor` accepte `Element`.
   Note : un vrai drag long depuis un bouton engage quand même un swipe via le
   re-attempt pending — c'est le comportement upstream, ne pas « corriger ».
