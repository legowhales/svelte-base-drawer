# Projet : Drawer Svelte porté de base-ui

## Contexte
Port du composant Drawer de base-ui (React) vers Svelte 5, en utilisant bits-ui Dialog comme fondation.
Le code source est dans `src/lib/drawer/`.

## Architecture
- `internal/create-swipe-gesture.svelte.ts` — moteur de gestes (pointer + touch séparés)
- `internal/create-drawer-touch-scroll.svelte.ts` — interception touch pour scroll vs swipe
- `internal/drawer-state.svelte.ts` — état du drawer, coordination avec bits-ui Dialog
- `internal/utils.ts` — utilitaires purs
- `components/` — composants Svelte qui wrappent bits-ui Dialog
- Le code est porté de github.com/mui/base-ui (packages/react/src/drawer/)

## Stack
- Svelte 5 avec runes ($state, $effect, $derived)
- bits-ui (dernière version, pattern avec classes State et Context de runed)
- svelte-toolbelt (mergeProps, boxWith)
- Utiliser `untrack` quand il faut éviter de re-run un effect
- Utiliser `on` de svelte/events pour attacher les events

## État actuel (V1 — bottom drawer)

### Ce qui fonctionne
- Ouverture/fermeture animée (slide in/out via bits-ui `data-starting-style` / `data-ending-style`)
- Swipe pour dismiss (pointer desktop + touch mobile)
- Vélocité du swipe prise en compte pour l'animation de fermeture (`--drawer-swipe-strength`)
- Overlay qui s'estompe pendant le swipe (`--drawer-swipe-progress`)
- Scroll interne préservé (touch scroll handler décide scroll vs swipe)
- Snap back animé quand le swipe ne dépasse pas le seuil de dismiss

### Techniques portées de base-ui

#### CSS
- **Bleed** : `--bleed: 3rem` étend le popup sous le viewport pour éviter les gaps pendant l'animation. `margin-bottom` négatif + `padding-bottom` compensatoire.
- **iOS status bar** : `@supports (-webkit-touch-callout: none) { position: absolute }` sur l'overlay pour éviter le glitch derrière la barre de statut iOS. Bleed désactivé sur iOS, `border-radius: 10px` natif.
- **`will-change: transform`** sur le popup pour la composition GPU.
- **`env(safe-area-inset-bottom)`** dans le padding pour les appareils à encoche.
- **Dismiss vélocité-scalée** : `transition-duration: calc(var(--drawer-swipe-strength, 1) * 400ms)` sur `[data-ending-style]`.
- **Overlay** : `user-select: none`, `pointer-events: none` sur `[data-ending-style]` pour empêcher les clics pendant l'animation de fermeture.

#### Comportement swipe
- **Inline transform** : pendant le swipe, `transform` et `transition: none` sont appliqués en inline sur le popup (style.setProperty). Supprimés au release pour que la transition CSS prenne le relais (snap back ou dismiss).
- **Rubber-band / damping directionnel** : `value ** 0.5` (racine carrée) quand l'utilisateur tire dans la direction opposée au dismiss (ex: tirer un bottom drawer vers le haut).
- **Pointer capture sur le popup** : `setPointerCapture` sur l'élément popup (pas `event.target`) pour un tracking fiable pendant le drag.
- **Seuil d'activation 1px** : feedback visuel quasi-immédiat (base-ui: `MIN_DRAG_THRESHOLD = 1`).
- **Compensation iOS first-move** : `dragStartPos` est reset à la position courante sur le premier `pointermove`, compensant le délai iOS entre pointerdown et le premier pointermove.
- **`data-swipe-dismiss`** : attribut sur le popup quand la fermeture est causée par un swipe (permet de styler différemment du close programmatique).
- **Clear selection** : les sélections de texte sont supprimées au début d'un swipe pointer (non-touch).
- **`CSS.registerProperty`** : les CSS vars haute-fréquence (`--drawer-swipe-x/y`, `--drawer-swipe-progress`, `--drawer-swipe-strength`) sont enregistrées avec `inherits: false` pour éviter la cascade dans les sous-arbres profonds.
- **`offsetHeight`** dans le ResizeObserver (inclut padding+border, reflète la taille visuelle utilisée pour les calculs de dismiss).

### Pièges résolus
- **`data-transition` vs bits-ui** : bits-ui v2 utilise `data-starting-style` / `data-ending-style`, PAS `data-transition="entering/entered/exiting"`.
- **Conflit style Svelte** : ne PAS mettre les CSS vars (`--drawer-swipe-y`, etc.) dans l'objet `style` des props réactifs — Svelte écrase les `setProperty()` impératifs du moteur de gestes au re-render. Utiliser les fallbacks CSS (`var(--drawer-swipe-y, 0px)`) pour les valeurs initiales.
- **`mergeProps` obligatoire** : `swipeGesture.pointerHandlers` et `touchScroll.handlers` exportent tous les deux `onpointerdown`. Un spread `{...a, ...b}` écrase silencieusement le premier. Utiliser `mergeProps()` de bits-ui pour chaîner les deux handlers.

## Prochaines étapes (Phase 2)
- 4 directions (up, left, right en plus de down)
- Snap points
- Nested drawers (stacking avec scale, `--nested-drawers`)
- SwipeArea
- Provider / Indent (scale-down du contenu derrière le drawer)

---

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.
