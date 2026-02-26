# Dragon 3.3 UCI Options

Output from `echo "uci" | ./dragon-m1` (Feb 2026).

## All Options

| Option | Type | Default | Range |
|---|---|---|---|
| Threads | spin | 1 | 1-256 |
| Ponder | check | true | - |
| Hash | spin | 256 | 1-524288 |
| Clear Hash | button | - | - |
| Table Memory | spin | 64 | 1-1024 |
| MultiPV | spin | 1 | 1-218 |
| OwnBook | check | true | - |
| Book File | string | komodo.bin | - |
| Book Moves | spin | 1000 | 0-1000 |
| Best Book Line | check | false | - |
| Log File | string | empty | - |
| Hash File Name | string | empty | - |
| UCI_Chess960 | check | false | - |
| UCI_AnalyseMode | check | false | - |
| Use LMR | check | true | - |
| Null Move Pruning | check | true | - |
| Overhead ms | spin | 50 | 0-10000 |
| Time Usage | spin | 0 | -90 to 90 |
| Use Syzygy | check | true | - |
| SyzygyPath | string | empty | - |
| Syzygy Probe Depth | spin | 1 | 0-99 |
| Syzygy Probe Limit | spin | 6 | 0-7 |
| Syzygy 50 Move Rule | check | true | - |
| Smart Syzygy | check | false | - |
| King Safety | spin | 83 | 0-200 |
| Selectivity | spin | 130 | 10-250 |
| Reduction | spin | -20 | -80 to 400 |
| Dynamism | spin | 100 | 0-400 |
| Contempt | spin | 20 | -250 to 250 |
| White Contempt | check | false | - |
| NNUE_Scale | spin | 72 | 10-500 |
| Use Regular Eval | check | false | - |
| MCTS Hash | spin | 128 | 32-32768 |
| Use MCTS | check | false | - |
| MCTS Explore | spin | 40 | 15-500 |
| MCTS Explore Root | spin | 60 | 15-500 |
| MCTS Optimism | spin | 10 | -50 to 50 |
| WeightsFile | string | empty | - |
| Personality | combo | Default | Default/Aggressive/Defensive/Active/Positional/Endgame/Beginner/Human |
| Armageddon | combo | Off | Off/White Must Win/Black Must Win |
| Variety | spin | 0 | 0-100 |
| UCI Elo | spin | 3500 | 1-3500 |
| UCI LimitStrength | check | false | - |
| Auto Skill | check | false | - |
| Skill Time | spin | 1 | 0-10 |
| UCI_Opponent | string | empty | - |

## Known Issues with KomodoConfig.ts

### Naming: spaces not underscores
Dragon 3.3 uses `UCI Elo` and `UCI LimitStrength` (with spaces).
`UCI_Elo` / `UCI_LimitStrength` (with underscores) are silently ignored.
**Fixed in commit 90b5bb0.**

### Options sent but don't exist
- `Skill` — removed in Dragon 3.3, replaced by `UCI Elo`. Silently ignored.
- `UCI ShowWDL` — not a Dragon option. Dragon sends WDL data by default.
- `Use LMR and Null Move Pruning` — not a single option. Two separate options: `Use LMR` + `Null Move Pruning`.

### Options not sent but should be
- `Armageddon` — client sends armageddon mode but server never passes it to engine. Expected values: `Off` / `White Must Win` / `Black Must Win`.

### Ranges to fix
- `UCI Elo` min is **1**, not 800. Server clamps to 800 unnecessarily.
- `Contempt` range is **-250 to 250**. Server clamps to 0-250, losing negative values.

## Search Nodes Scaling by ELO

### Problem
chessr-next uses a fixed `go nodes 700000` for all ELO levels.
The old server used `go movetime` scaled by ELO (60ms at 800, 320ms at 2000+).
Result: low-ELO users get engine moves that are too precise for their level.

### Old server movetime (for reference)
```
ELO ≤ 800  → 60ms
ELO ≤ 1200 → 100ms
ELO ≤ 1600 → 150ms
ELO ≤ 2000 → 220ms
ELO > 2000 → 320ms
```

### New approach: linear node interpolation
Instead of fixed steps, use continuous scaling so each ELO gets a unique node count.

```typescript
export function computeNodesForElo(elo: number): number {
  const minElo = 400;
  const maxElo = 3500;
  const minNodes = 50_000;
  const maxNodes = 1_000_000;
  const clamped = Math.max(minElo, Math.min(maxElo, elo));
  return Math.round(minNodes + ((clamped - minElo) / (maxElo - minElo)) * (maxNodes - minNodes));
}
```

### Reference values
| ELO | Nodes |
|---|---|
| 400 | 50,000 |
| 600 | 111,000 |
| 800 | 172,000 |
| 1000 | 234,000 |
| 1200 | 295,000 |
| 1500 | 387,000 |
| 1800 | 479,000 |
| 2000 | 540,000 |
| 2200 | 601,000 |
| 2500 | 694,000 |
| 3000 | 847,000 |
| 3500 | 1,000,000 |

### Where to apply
- Replace `SEARCH_NODES` constant in `KomodoConfig.ts`
- Call `computeNodesForElo(targetElo)` in `suggestionHandler.ts` before search
- Puzzle mode keeps max nodes (1M) since it uses full strength

## TODO
- [ ] Remove `Skill` from config (no-op, Dragon 3.3 doesn't have it)
- [ ] Remove `UCI ShowWDL` from config (no-op, Dragon sends WDL by default)
- [ ] Fix puzzle mode: split `Use LMR and Null Move Pruning` into two separate options: `Use LMR` + `Null Move Pruning`
- [ ] Add `Armageddon` option (`Off` / `White Must Win` / `Black Must Win`)
- [ ] Lower `UCI Elo` min clamp from 800 to 400 (match client slider min)
- [ ] Allow negative contempt values (-250 to 250)
- [ ] Replace fixed `SEARCH_NODES = 700000` with `computeNodesForElo(elo)`
- [ ] Verify linux/avx2 binary has same options (test on server)
