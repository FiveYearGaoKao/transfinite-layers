# AGENTS.md

## Commands

```sh
npm run dev          # dev server (vite)
npm run build        # type-check → build-only (removes dist/ first)
npm run type-check   # vue-tsc --build (NOT tsc — .vue files)
npm run lint         # eslint . --fix
npm run format       # prettier --write src/
```

**Build order matters**: `build` removes `dist/` with `fs.rmSync`, then runs `type-check` + `build-only` in parallel. Vite config has `build.emptyOutDir: false` — the rm step is manual because of this.

## Architecture (must follow)

Strict unidirectional dependency: `tools → data → save/access → compute → logic → meta → ui`. No imports going upward.

- **`compute/` is read-only**: functions take state as input, return results, never mutate.
- **`logic/` is where mutations happen** (purchases, resets, automations).
- **`effects.ts` is the central buff pipeline**: every numeric modifier (cost, production, reset gain, etc.) goes through `registerEffect`/`calculate`. New systems MUST register effects here, never bake bonuses into core formulas.

Full architecture & effect mechanism docs: `docs/面向开发者/` (架构.md, 层级系统.md, effect机制.md, 存档.md, 开发规范.md). Player-facing guide: `docs/面向玩家/玩法指南.md`.

### Layers (read `docs/面向开发者/层级系统.md` first)
- Coordinates (`LayerId`) are **slots only**, written in **canonical form**: no leading zero digits (all-zero = `[0]`), so coordinates do not depend on `player.layerDepth`. Build and look up keys with `layerKey()` (`tools/ordinal.ts`) — never hand-write `pos.toString()`, and never use a zero-padded coordinate like `[0,5]`. A layer's height lives in `Layer.level`. Layer relations go through `access/layerGraph.ts` (`prevLayer` / `levelGap` / `getOrderedLayers`) and `tools/ordinal.ts` (`nextLayer`): the **o-order bonus source of layer L is `nextLayer(L, o)`**. Never hand-roll coordinate arithmetic in other modules.
- Iterate layers via `getOrderedLayers('asc' | 'desc')` / `forEachLayer`; production runs high→low, automation low→high. **Never** rely on `Object.keys(player.layers)` order (integer-like keys always enumerate first, so mixed keys cannot express height order).
- A layer's **order** is the weight of its own slot digit (the lowest non-zero digit: `[5]` and `[1,5]` are both order 0, `[1,0]` is order 1), and a **window** is `(ancestor digits, order)` — never infer either from the coordinate's length.
- Adding/removing `player.layers` entries is only allowed in `logic/layerStructure.ts` (it also owns temp-layer sync, window rotation and the debug invariant self-check).
- Temp layers (coordinate `-1`, stored in `data/temp.ts`) are previews only: no production, no bonuses, no automation.
- Runtime caches and the log store live in `data/` (`data/temp.ts`, `data/log.ts`) so that `access`/`compute`/`logic` never import upward from `app`.

## Gotchas

### Numbers
- **All game numbers use `Decimal` from `break_eternity.js`**. Never use plain JS `number` for player state, costs, or production.
- Decimals are NOT JSON-serializable. The save system uses `markDecimals` (→ `{$d: "...", $l: layer}`) / `unmarkDecimals` on save/load. Layer-0 Decimals are stored as the exact double string and rebuilt via `fromComponents_noNormalize` — the round-trip is bit-exact (break_eternity's `toString`/`fromString` loses ~1 ulp for `|mag| < 1`).

### Save system
- Custom serialization in `save/save.ts`. Checksum (`save/checksum.ts`) is computed over the `markDecimals`-serialized result and verified on load for saves with `version >= CHECKSUM_VERSION` (older saves skip verification). It is an integrity check, not anti-cheat — the algorithm is public in source.
- No backwards compatibility for old saves (migration.ts is empty).

### Type system
- `vue-tsc` handles `.vue` type-checking; plain `tsc` will fail on `.vue` imports.
- `@/` alias → `src/` (configured in both tsconfig and vite).

### Lint/format rules
- **No semicolons**, **single quotes**, max line width 100 (Prettier).
- Unused variables: prefix with `_` to suppress ESLint error.
- `vue/multi-word-component-names` is off.

### UI conventions
- Button classes come in pairs: **type** (sizing: `subTab`, `prestige`, `buyable`, `upgrade`, `mainTab`, `toggle`) + **state** (color: `selected`, `affordable`, `bought`, `toggle-on`, `toggle-off`, `meta`). All defined in `src/assets/style.css`.
- Theme colors: use `var(--...)` CSS variables from `:root` / `body.light`. Add new themes by extending the theme cycle in `settings.ts` + adding the corresponding CSS variables.

### Code style
- **Chinese JSDoc comments above every new function**.
- **Registry pattern** for all game systems: define an array (`UPGRADES`, `BUYABLES`, `AUTOMATIONS`, achievements), register at module level, query via accessor functions.
- **Pure functions with no save/effect dependencies go in `tools/`** (e.g. `softCapValue`). Gameplay-aware wrappers (reading effect slots/player state) live in `compute/`.

## No tests
This project has no test suite. Verify changes by running `npm run type-check && npm run lint && npm run build`.
