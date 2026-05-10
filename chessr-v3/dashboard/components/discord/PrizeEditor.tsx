'use client';

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Prize } from './giveaway-shared';

/**
 * Stand-alone prize list editor — used both on the create page and in
 * the detail page's "Prizes" tab. Manages an array of prizes via
 * setPrizes; the parent owns persistence (PUT /admin/giveaway/:id/prizes).
 *
 * Reorder is up/down buttons rather than drag-n-drop — much less
 * machinery for v1, and the position field is recomputed on each
 * mutation so the array index always equals position - 1.
 */
export function PrizeEditor({
  prizes, setPrizes, disabled = false,
}: {
  prizes: Prize[];
  setPrizes: (next: Prize[]) => void;
  disabled?: boolean;
}) {
  function add() {
    setPrizes([
      ...prizes,
      { position: prizes.length + 1, prize_kind: 'token', token_count: 10 },
    ]);
  }
  function remove(i: number) {
    const next = prizes.filter((_, j) => j !== i).map((p, j) => ({ ...p, position: j + 1 }));
    setPrizes(next);
  }
  function move(i: number, delta: -1 | 1) {
    const j = i + delta;
    if (j < 0 || j >= prizes.length) return;
    const next = [...prizes];
    [next[i], next[j]] = [next[j], next[i]];
    setPrizes(next.map((p, k) => ({ ...p, position: k + 1 })));
  }
  function update(i: number, patch: Partial<Prize>) {
    const next = [...prizes];
    next[i] = { ...next[i], ...patch };
    // Switching kind clears the irrelevant fields so the row stays
    // valid against the DB CHECK constraint.
    if (patch.prize_kind === 'plan') {
      next[i].token_count = null;
      if (!next[i].plan_kind) next[i].plan_kind = 'premium';
      if (next[i].plan_kind === 'premium' && !next[i].plan_days) next[i].plan_days = 30;
    } else if (patch.prize_kind === 'token') {
      next[i].plan_kind = null;
      next[i].plan_days = null;
      if (!next[i].token_count) next[i].token_count = 10;
    }
    if (patch.plan_kind === 'lifetime') next[i].plan_days = null;
    if (patch.plan_kind === 'premium' && !next[i].plan_days) next[i].plan_days = 30;
    setPrizes(next);
  }

  return (
    <div className="space-y-2">
      {prizes.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-background/40 p-4 text-center text-[12px] text-muted-foreground">
          No prizes yet — add one below.
        </div>
      ) : (
        <ul className="space-y-2">
          {prizes.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/40 p-2">
              {/* Order controls */}
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={disabled || i === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, +1)}
                  disabled={disabled || i === prizes.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              <span className="num w-6 text-center text-[11px] font-semibold tabular-nums">#{p.position}</span>

              {/* Kind */}
              <select
                value={p.prize_kind}
                onChange={(e) => update(i, { prize_kind: e.target.value as 'plan' | 'token' })}
                disabled={disabled}
                className="h-8 rounded-md border border-border bg-background/40 px-2 text-[12px] capitalize"
              >
                <option value="plan">plan</option>
                <option value="token">token</option>
              </select>

              {/* Plan sub-config */}
              {p.prize_kind === 'plan' && (
                <>
                  <select
                    value={p.plan_kind ?? 'premium'}
                    onChange={(e) => update(i, { plan_kind: e.target.value as 'lifetime' | 'premium' })}
                    disabled={disabled}
                    className="h-8 rounded-md border border-border bg-background/40 px-2 text-[12px] capitalize"
                  >
                    <option value="lifetime">lifetime</option>
                    <option value="premium">premium</option>
                  </select>
                  {p.plan_kind === 'premium' && (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={1}
                        max={3650}
                        value={p.plan_days ?? 30}
                        onChange={(e) => update(i, { plan_days: Math.max(1, Number(e.target.value) || 1) })}
                        disabled={disabled}
                        className="h-8 w-20 text-[12px]"
                      />
                      <span className="text-[11px] text-muted-foreground">days</span>
                    </div>
                  )}
                </>
              )}

              {/* Token sub-config */}
              {p.prize_kind === 'token' && (
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={1}
                    max={10000}
                    value={p.token_count ?? 1}
                    onChange={(e) => update(i, { token_count: Math.max(1, Number(e.target.value) || 1) })}
                    disabled={disabled}
                    className="h-8 w-20 text-[12px]"
                  />
                  <span className="text-[11px] text-muted-foreground">tokens</span>
                </div>
              )}

              <div className="ml-auto" />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => remove(i)}
                disabled={disabled}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                title="Remove prize"
              >
                <Trash2 size={13} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" size="sm" variant="outline" onClick={add} disabled={disabled} className="h-7 gap-1.5">
        <Plus size={12} /> Add prize
      </Button>
    </div>
  );
}
