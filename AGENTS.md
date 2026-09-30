# AGENTS.md

## Commands

```sh
npm run dev          # dev server (vite)
npm run build        # type-check → build-only (removes dist/ first)
npm run type-check   # vue-tsc --build (NOT tsc — .vue files; covers src/ and scripts/)
npm run lint         # eslint . --fix (also lints scripts/)
npm run format       # prettier --write src/
npm run check        # all collision-check scripts (pricing/effects/save/achievements/meta/commands/worldDepth)
```

**Build order matters**: `build` removes `dist/` with `fs.rmSync`, then runs `type-check` + `build-only` in parallel. Vite config has `build.emptyOutDir: false` — the rm step is manual because of this.

**Two release lines** (`docs/面向开发者/开发规范.md` §三): pushing `main` publishes the stable build at the site root (`/<repo>/`); pushing `beta` builds with `.env.beta` (`VITE_BETA=true`) and publishes the test build to the subdirectory `/<repo>/beta/`. The beta `base` in `vite.config.ts` must match that subdirectory exactly (one level off means every asset 404s and the page is blank). CI always builds both branches with explicit `ref`s into one Pages artifact, so a single push never drops the other line. The two lines **never share saves or settings** (`storagePrefix` in `data/constants.ts` adds `-beta`). Bump `gameVersion` + add a `CHANGELOG` entry for every published batch. Bugs that show up while building a batch and are fixed before that batch is committed are **not** recorded (players only ever see the final shape); a bug that reached players gets its own version and entry.

## Architecture (must follow)

Strict unidirectional dependency: `tools → data → save/access → compute → logic → meta → ui`. No imports going upward. The few known exceptions (and why `import type` does not count) are listed in `docs/面向开发者/架构.md` §三 — do not add a new one without checking whether it can be inverted.

- **`compute/` is read-only**: functions take state as input, return results, never mutate.
- **`logic/` is where mutations happen** (purchases, resets, automations).
- **`effects.ts` is the central buff pipeline**: every numeric modifier (cost, production, reset gain, soft cap, etc.) goes through `registerEffect`/`applyTo`. New systems MUST register effects here, never bake bonuses into core formulas.
- **Effect mechanism rules** (full contract: `docs/面向开发者/effect机制.md`):
  - A value point's `id` **is** its modifier target — one id, one meaning. Never let two meanings share a target.
  - Slots are **named and registered** with `defineSlot(id, init, scope)`; never construct a slot object at a call site, never write `{ pos: [0], id: 0 }` (ctx defaults to `pos=[0], id=0`). `scope` picks the frame-cache key: `'item'` (default, value may depend on layer+item id), `'layer'` (value depends on the layer only — same cache entry for every dimension/item of that layer), `'global'` (no context at all). Declaring `'layer'`/`'global'` is a promise that the dev-build cross-context check will verify.
  - Numeric callbacks (`init`/`value`/curve methods) **return `Decimal`**; the read path must not re-wrap with `new Decimal(...)`.
  - Soft caps are the `cap` effect type (`threshold`/`power` slots + constant `height`) — never call `softCap`/`softCapValue` from core formulas, and never write a soft cap as `custom` (that makes the value point non-invertible).
  - `applyTo`/`slotValue` results are invertible only while every step is `add`/`mul`/`exp`/`cap`; any `custom` on a price point disables inversion (falls back to `maxSatisfying`).
  - Prices and challenge goals are declared as a `Curve` with four optional methods (`at`/`inverse`/`sum`/`sumInverse`); a missing method falls back to the generic path. Sum accuracy must stay within 1% (`constantCurve`/`linear`/`geometric` are exact, `power` uses an integral approximation, `expLinear`/`powerQuadratic`/`powerDoubleExp` rely on the last-two-terms geometric closed form).
  - Price formulas and challenge goals get their base from `getBase()` **only through `compute/curves.ts` / `upgradeCost`** — item and goal declarations must not read `player` directly, and prices that must not scale with the ordinal base (knowledge upgrades) must pass an explicit constant base. `player.base` is an integer in 2..10; a curve's `inverse` must return `undefined` when `base <= 1`.
- **Frame cache contract** (`compute/frameCache.ts`): per numeric point the frame keeps an **effect plan** (active effect list + folded steps, built by folding adjacent same-type `static` effects), plus slot values and curve parameters. Any write that changes these must call `clearFrameCache()` right after (see `docs/面向开发者/性能.md`). Violating it only yields stale values within the frame, but they will be wrong — dev builds catch it via `runStaticSelfCheck` (called after production and at end of frame in `app/core.ts`). Effects are **dynamic by default** — mark `static` only when the value depends solely on purchases/unlocks/layer structure (never on points, produced amounts, energy or time), and never read `current` from a `static` effect. Use the debug command `/perf` to see cache hit/miss counts and search evaluation counts.

Full architecture & effect mechanism docs: `docs/面向开发者/` (架构.md, 层级系统.md, effect机制.md, 数值.md, 性能.md, 存档.md, 开发规范.md). Player-facing guide: `docs/面向玩家/玩法指南.md`.

### Layers (read `docs/面向开发者/层级系统.md` first)

- Coordinates (`LayerId`) are **slots only**, written in **canonical form**: no leading zero digits (all-zero = `[0]`), so coordinates do not depend on `player.layerDepth`. Build and look up keys with `layerKey()` (`tools/ordinal.ts`) — never hand-write `pos.toString()`, and never use a zero-padded coordinate like `[0,5]`. A layer's height lives in `Layer.level`. Layer relations go through `access/layerGraph.ts` (`prevLayer` / `levelGap` / `getOrderedLayers`) and `tools/ordinal.ts` (`nextLayer`): the **o-order bonus source of layer L is `nextLayer(L, o)`**. Never hand-roll coordinate arithmetic in other modules.
- Iterate layers via `getOrderedLayers('asc' | 'desc')` / `forEachLayer`; production runs high→low, automation low→high. **Never** rely on `Object.keys(player.layers)` order (integer-like keys always enumerate first, so mixed keys cannot express height order).
- A layer's **order** is the weight of its own slot digit (the lowest non-zero digit: `[5]` and `[1,5]` are both order 0, `[1,0]` is order 1), and a **window** is `(ancestor digits, order)` — never infer either from the coordinate's length.
- Adding/removing `player.layers` entries is only allowed in `logic/layerStructure.ts` (it also owns temp-layer sync, window rotation and the debug invariant self-check).
- Temp layers (coordinate `-1`, stored in `data/temp.ts`) are previews only: no production, no bonuses, no automation.
- Runtime caches and the log store live in `data/` (`data/temp.ts`, `data/log.ts`) so that `access`/`compute`/`logic` never import upward from `app`.

## Gotchas

### Numbers

- **All game numbers use `Decimal` from `break_eternity.js`** (representation, API, cost per op and the design ranges of constants: `docs/面向开发者/数值.md`). Never use plain JS `number` for player state, costs, or production; `number` is only for ids, indices, flags and small counts.
- **One Decimal op costs on the order of 1 µs** — three orders of magnitude more than a `number` read/write. Avoid recomputing per frame: use a named slot plus its `scope` (see above) instead of doing the math inside formulas.
- **Decimals are never mutated in place** — always replace the whole value (`player.x = player.x.add(y)`). For that reason `data/player.ts` marks `Decimal.prototype` with Vue's `__v_skip`, so Decimals never go through the reactive proxy (measured: about half the frame time; see 性能.md). Never call in-place mutators (`normalize()`, `fromComponents()`) or write `.mag` directly.
- Design ranges you may rely on: `player.base` is an integer in 2..10; active layer count is normally ≤ 256; each layer has 4..8 dimensions (initial 4, cap raised by meta-dimension boosts — take the count from `L.dimensions.length`, never from `DIMENSION_COUNT`); price soft-cap `power > 1`, dimension-production soft-cap `power < 1`. Knowledge-upgrade prices are a special case: constant base, no effect pipeline, no soft cap, independent of `player.base`.
- Decimals are NOT JSON-serializable. The save system uses `markDecimals` (→ `{$d: "...", $l: layer}`) / `unmarkDecimals` on save/load. Layer-0 Decimals are stored as the exact double string and rebuilt via `fromComponents_noNormalize` — the round-trip is bit-exact (break_eternity's `toString`/`fromString` loses ~1 ulp for `|mag| < 1`).

### Save system

- Custom serialization in `save/save.ts`. Checksum (`save/checksum.ts`) is computed over the `markDecimals`-serialized result and verified on load for saves with `version >= CHECKSUM_VERSION` (older saves skip verification). It is an integrity check, not anti-cheat — the algorithm is public in source.
- Missing fields in old saves fall back to `initializeSave()` defaults (blank-shape fill + `save/validate.ts` shape check), so adding a field normally needs no other change; `save/migration.ts` is only for data transforms (rename/recompute) that defaults cannot express.

### Type system

- `vue-tsc` handles `.vue` type-checking; plain `tsc` will fail on `.vue` imports.
- `@/` alias → `src/` (configured in both tsconfig and vite).

### Lint/format rules

- **No semicolons**, **single quotes**, max line width 100 (Prettier).
- Unused variables: prefix with `_` to suppress ESLint error.
- `vue/multi-word-component-names` is off.

### Editing files

- **Never rewrite a repo file through PowerShell** (`Get-Content … | Set-Content`, `… -replace … | Set-Content`, `Out-File`): Windows PowerShell 5.1 reads these files as ANSI, so every Chinese character comes back re-encoded as garbage and the file is silently destroyed. Shell one-liners are fine for read-only commands; to change a file inside the repo use the file tools (`read` / `edit` / `write`) only.

### UI conventions

- Button classes come in pairs: **type** (sizing: `subTab`, `prestige`, `buyable`, `upgrade`, `mainTab`, `toggle`) + **state** (color: `selected`, `affordable`, `bought`, `toggle-on`, `toggle-off`, `meta`). All defined in `src/assets/style.css`.
- Theme colors: use `var(--...)` CSS variables from `:root` / `body.light`. Add new themes by extending the theme cycle in `settings.ts` + adding the corresponding CSS variables.

### Code style

- **Chinese JSDoc comments above every new function**.
- **Registry pattern** for all game systems: define an array (`UPGRADES`, `BUYABLES`, `AUTOMATIONS`, achievements), register at module level, query via accessor functions.
- **Pure functions with no save/effect dependencies go in `tools/`** (e.g. `softCapValue`); a pure helper with a single consumer may stay in its owning layer (e.g. the curve families in `compute/curves.ts`). Gameplay-aware wrappers (reading effect slots/player state) live in `compute/`.

## Verification (no test framework)

Small single-file changes: `npm run type-check && npm run lint && npm run build`.
Complex changes (pricing/curves, effects & frame cache, save format, achievements, layer structure) must also run the collision-check scripts. `npm run check` runs all of them; pick the matching one when that is enough (the "which change → which script" table is in `docs/面向开发者/开发规范.md` §二.13):

```sh
npm run check                                     # all of the below
npm run check:pricing       # curve sums/inverses vs brute force, maxBuyable vs referee, base-independence
npm run check:effects       # folded plan vs per-effect evaluation, inversion round-trips, stat tree, static self-check
npm run check:save          # export→import round-trip, checksum tampering, shape pruning, load guards, migration
npm run check:achievements   # trigger buckets, manual achievements have an unlock site in src/
npm run check:meta           # meta-dimension boost formulas, dimension-count growth, forced reset, save round-trip
npm run check:commands        # quiz cooldown/storage, offline-time cap, new save fields round-trip
npm run check:worldDepth      # frontier-window rules (carry / refusal / rotation), [1,0] unlock path, coordinate≠height semantics
```

Balance/progression changes: `node scripts/run-ts.mjs scripts/sim.ts [minutes] [stepSeconds] [printEvery] [--bot=phased|greedy|none] [--fresh] [--save=baselineFile] [--max-step=seconds]` runs the real `gameLoop` headlessly (it loads the real save if one is present) and prints a progress timeline plus metric snapshots. `--bot=phased` (the default for balance runs) adds a scripted player (`scripts/bot.ts`) that acts only through the same `logic/` entry points the UI buttons use — no debug commands, no direct state writes — with a phase machine for the opening (`--opening=invest|fast`), the layer-2 gate (`--next-gain=N`, i.e. a24 + N points of the layer below) and the a24 side quest (`--no-a24` to disable); `--bot=greedy` is the branch-free lower bound. Use `--max-step=1` for strategy comparisons: otherwise the bot is throttled to one action per 60 game seconds when idle. Report before/after runs instead of a guess; endgame criteria, the metric table, the deliberate-achievement list and the measured opening comparison: `docs/面向开发者/测试与平衡.md` §五. Runs meant to be compared start from a **baseline save** in `saves/` (`npm run saveBank` regenerates them, `--save=<file>` starts a run from one; stages, naming and import steps: `saves/README.md`).

Scripts are excluded from the build but included in `npm run type-check` (own project: `tsconfig.scripts.json`); shared assertions/bootstrap/fixtures live in `scripts/helpers.ts`, and one-off probes must not be left behind.
