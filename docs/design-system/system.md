# Chessr Extension — Design System

> Extracted from the Auto Move tab mockup (the "premium" target) and cross-referenced with existing v3 patterns. This document is the source of truth for the Chessr extension's visual identity. When an existing component disagrees with the system, the component is wrong.

## Identity in one paragraph

Dark, dense, number-centric. Panel sits on top of chess.com, has to look premium against the host page without competing for attention. Surfaces are **layered transparent whites** on a deep navy/near-black base — not flat panels. Depth comes from **borders and subtle fills, not shadows**, except for the panel itself and interactive accents. Numbers are tabular, labels are tiny uppercase, controls are tightly grouped. Colors are functional: **blue = active/primary, violet = auto/engine, green = success, amber = warning, red = danger**. No decorative color.

---

## 1. Tokens

### 1.1 Color system (keep existing HSL tokens, formalize usage)

The extension already defines these CSS custom properties on `:host` in `app.css`. Keep them as-is — they are the basis of the system:

```css
:host {
  --background:      240 20% 5%;    /* panel backdrop */
  --foreground:      240 6% 90%;    /* primary text */
  --card:            233 19% 8%;    /* elevated surface (panel bg) */
  --card-foreground: 240 6% 90%;
  --primary:         217 91% 60%;   /* #3b82f6 — active, interactive */
  --secondary:       188 86% 53%;   /* #22d3ee — accent cyan */
  --muted:           235 21% 13%;   /* chip / subtle fill bg */
  --muted-foreground:240 5% 65%;    /* secondary text */
  --border:          236 20% 20%;
  --ring:            217 91% 60%;
  --destructive:     0 84% 60%;     /* #ef4444 */
  --success:         142 76% 36%;   /* #22c55e */
  --warning:         38 92% 50%;    /* #f59e0b */
  --radius:          0.5rem;        /* 8px */
}
```

**Semantic accents** (use hex directly when a token doesn't apply):

| Role | Color | Usage |
|---|---|---|
| Interactive blue | `#3b82f6` / `#60a5fa` / `#93c5fd` | Hotkey mode, primary buttons, active tabs, focus |
| Auto violet | `#a855f7` / `#c084fc` | Auto mode, engine/computation states |
| Success green | `#22c55e` / `#4ade80` | Winner, good accuracy, confirm |
| Warning amber | `#f59e0b` / `#fbbf24` | Game-over, medium accuracy, caution |
| Danger red | `#ef4444` / `#f87171` / `#fa412d` | Error, blunder, loss |
| Cyan accent | `#22d3ee` / `#26c2a3` | Brilliant move, premium badge text |

**Move-classification palette** (canonical — Chess.com parity):

```
brilliant  #26c2a3    (display text #22d3ee)
great      #749BBF
best       #81B64C    (display text #22c55e in our accent set)
excellent  #81B64C
good       #95b776
book       #D5A47D    (display text #a78bfa in our accent set)
forced     #96af8b
inaccuracy #F7C631    (display text #fbbf24)
mistake    #FFA459    (display text #fb923c)
miss       #FF7769
blunder    #FA412D    (display text #f87171)
```

**Surface & overlay pattern:**

```
Background       hsl(var(--background))        /* everything sits on this */
Panel            hsl(var(--card))              /* the chessr-panel itself */
Card             rgba(255,255,255,0.03)        /* content cards inside panel */
Card (muted)     hsl(var(--muted) / 0.15)      /* less emphasis */
Inset            rgba(0,0,0,0.25)              /* input tracks, tab bg */
Inset (strong)   rgba(0,0,0,0.35)              /* key inputs */
```

Never use a flat `#000` or `#fff` as a container background. Always go through the layering scheme.

### 1.2 Spacing scale

Base unit **4 px**. Valid steps: `0, 2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32`. Half-steps (2, 3, 6, 10, 14, 28) are allowed where the visual hierarchy demands it — they read on the mockup. Do not invent values outside this scale.

**Canonical gaps:**

- Card internal padding: `10–14px` (tight: 10, default: 12, spacious: 14)
- Between stacked cards: `gap: 10px`
- Within a row (icon + label + value): `gap: 6–10px`
- Section headers to content: `margin-bottom: 6–8px`

### 1.3 Radius scale

```
4px   — small chips, key inputs, tight pills
6px   — slider thumb, inner tab active bg, small rounded buttons
8px   — the default card/pill radius (matches --radius)
10px  — prominent cards (panel body sections)
12px  — top-level cards with avatars / feature cards
999px — pills (turn pill, tag pills)
```

Don't use values outside this scale. The mockup uses 10px heavily for content cards; 12px for "feature" containers (like the unlock banner).

### 1.4 Typography

**Font**: system font stack, already set: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`.

**Size scale (px)**:

```
7   — micro annotation, row sub-labels on widgets
8   — section label caps (UPPERCASE)
9   — tiny secondary text (ranges, hints)
10  — body secondary (values inside rows, sub-descriptions)
11  — primary UI labels, tab labels
12  — body text, card titles
13  — CTA button text, large numeric values
14  — prominent stat values (Game Rating, accuracy pills)
16  — large numeric highlights (move numbers, scores)
20  — big stat (accuracy hero)
22  — display number (rare)
```

**Weight scale**: `500` (body), `600` (labels, UI text), `700` (prominent), `800` (display numbers).

**Letter-spacing**: uppercase labels use `letter-spacing: 0.04em` (default) or `0.05em` (looser for very short labels). All other text is `normal`.

**Numbers**: **always** `font-variant-numeric: tabular-nums` for any value that might change (accuracy, elo, eval, counts). Alignment comes from the font, not from fixed widths.

**Monospace**: used for move notation (`b1c3`) and key inputs (`1`, `⇧`). Use `ui-monospace, monospace`.

### 1.5 Depth strategy

**Borders over shadows.** Primary separation is a 1 px border in `rgba(255,255,255,0.04 → 0.1)`:

```
Hairline (rarely visible) rgba(255,255,255,0.04)   — card borders when on low-contrast surfaces
Default                    rgba(255,255,255,0.05)   — standard card border
Subtle                     rgba(255,255,255,0.06)   — slider track bg, section dividers
Interactive idle           rgba(255,255,255,0.08)   — button/input outline
Interactive hover          rgba(255,255,255,0.1)    — hover state of same
```

**Shadows exist in two places only:**

1. **The panel itself** (sits above chess.com): `box-shadow: 0 8px 32px rgba(0,0,0,0.4)`.
2. **Active elements that need to "pop"**: `box-shadow: 0 1px 4px rgba(0,0,0,0.25-0.3)` on active tabs / primary buttons.

No card inside the panel gets a drop-shadow. Layering is borders + fills.

**Glow** (used sparingly): an accent dot can have `box-shadow: 0 0 5-8px <color>` to draw attention — used on the turn-pill dot, active status indicators.

### 1.6 Motion

```
Micro interactions      0.15s ease         (hover, focus, bg change)
State transitions       0.2s ease          (turn-pill color change)
Panel entrance          0.25s back.out(1.4) via GSAP
Content stagger         0.04s per row, 0.35s duration, power2.out
Counter animations      0.6–1.2s power2.out to final value
```

Always respect the user's `disableAnimations` setting — it short-circuits GSAP tweens with `gsap.set(...)` to the final state.

---

## 2. Primitives

The mockup established a small set of reusable primitives. These are the building blocks every new screen must use — don't invent equivalents.

### 2.1 Card

The workhorse surface. Every grouped content block is a card.

```css
.card {
  background: rgba(255, 255, 255, 0.03);      /* or hsl(var(--muted) / 0.15) for muted variant */
  border-radius: 10px;                         /* 8 for tight, 12 for feature cards */
  padding: 12px;                               /* 10 tight / 14 spacious */
  border: 1px solid rgba(255, 255, 255, 0.04); /* optional on low-contrast surfaces */
}
```

Cards don't stack box-shadows. They can contain rows, grids, sliders, tabs — but always with inner `gap` ≥ 6px.

### 2.2 Section header inside a card

```
[SECTION LABEL]    [optional tag/toggle on the right]
small subtitle describing what this card controls
```

- Label: `8px`, `uppercase`, `letter-spacing: 0.05em`, color `#a1a1aa` (`--muted-foreground`).
- Subtitle: `9px`, color `#71717a` (darker muted), single line when possible.
- The right-aligned slot can hold a tag pill, a small toggle, or a `Shared`/mode badge.

### 2.3 Mode tabs (3-way segmented control)

The defining interactive pattern of the Auto Move tab. Reusable for any "pick one of N" decision where N ≤ 4.

```html
<div class="mode-tabs">
  <span class="off">Off</span>
  <span class="active hot">Hotkey</span>
  <span class="auto">Auto</span>
</div>
```

```css
.mode-tabs {
  display: flex;
  gap: 3px;
  padding: 4px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 10px;
}
.mode-tabs > span {
  flex: 1;
  padding: 10px 6px;
  text-align: center;
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 12px;
  font-weight: 700;
}
.mode-tabs > span.active {
  box-shadow: inset 0 0 0 1px currentColor, 0 1px 4px rgba(0, 0, 0, 0.25);
}
.mode-tabs > span.active.hot  { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.mode-tabs > span.active.auto { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
```

Optional second line under the main label: `font-size: 8px`, `color: #71717a`, `margin-top: 2px` — describes the mode in one phrase.

### 2.4 Tab bar (flat, for screens)

Used for the top-level `Game / Engine / Auto Move` tabs.

```css
.tabs {
  display: flex;
  background: rgba(255, 255, 255, 0.03);
  padding: 3px;
  border-radius: 8px;
  gap: 3px;
}
.tabs > span { flex: 1; padding: 7px; text-align: center; font-size: 11px; font-weight: 600; color: #71717a; border-radius: 6px; cursor: pointer; }
.tabs > span.active { background: #1a1a2e; color: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
```

Difference from mode-tabs: **tab-bar is a screen router** (no color tint, neutral white active), **mode-tabs is a setting selector** (tinted to match downstream content).

### 2.5 Toggle

```
[ ● · · · ]  off — width 28, height 16, dot 12px, bg rgba(255,255,255,0.1)
[ · · · ● ]  on  — same, bg hsl(var(--primary)) or variant for specific contexts
```

28×16 is the default. A smaller 24×14 variant exists for floating widgets.

### 2.6 Slider

Custom `<div>`-based slider (already implemented in `Slider.tsx`). The design standard:

```
Track:      4px tall, bg rgba(255,255,255,0.06), radius 2px
Fill:       same height, colored per context, radius 2px
Thumb:      12px circle, 2px white border, colored fill
Range:      two thumbs (clip-path the fill between them)
```

**Color-per-context:**
- Neutral settings: blue (`#3b82f6`)
- Speed / time delays: gradient green→amber→red (slow = green, fast = red) OR violet-tinted for Auto
- Variety / ambition: symmetric gradient (center neutral, edges red)

Always render the value next to the slider — `font-size: 10px`, tabular-nums, on the right.

### 2.7 Status pill (with dot)

Used for the Game Info turn pill and any "current state" display.

```
⬤  Your turn           (blue   — interactive / waiting for user)
⬤  Playing 420ms…      (violet — auto is working)
⬤  Premove queued      (violet — queued action)
⬤  Draw                (amber  — neutral result)
⬤  You won             (green  — success)
⬤  You lost            (red    — failure)
```

Dot: `5-6px` circle, `box-shadow: 0 0 5-8px <color>` for the glow.
Container: `padding: 3-5px 8-12px`, `border-radius: 999px`, background = color-at-15%-alpha.
Text: `9-11px`, `font-weight: 600`, color = color lightened.

### 2.8 Badge / tag

Tiny contextual label, non-interactive:

```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  font-size: 9px;
  font-weight: 700;
  border-radius: 4px;             /* 999px for pill-shaped */
  background: <color>/0.12;
  color: <color>-400;
  border: 1px solid <color>/0.2;  /* optional */
}
```

Common variants: **Premium** (cyan-400 on cyan/0.18), **Shared/Tag** (green), **Mode pills** (blue for hotkey, violet for auto). Keep to ≤3 badge colors per screen.

### 2.9 Key input

Small keyboard-key visualization:

```css
.key {
  display: inline-block;
  padding: 3px 10px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  color: #e4e4e7;
  min-width: 28px;
  text-align: center;
}
```

Renders `1`, `Shift`, `⇧`, `Ctrl+K`. Minimum size is non-negotiable — readable as keyboard.

### 2.10 Three-column label grid

The layout fundamental for stat rows and comparison rows. **Adopted from Chess.com's review page.**

```css
.grid-row {
  display: grid;
  grid-template-columns: 1fr 80px 1fr;   /* or 1fr 120px 1fr for wider center */
  align-items: center;
  justify-items: center;                 /* critical — centers each cell's content */
}
```

Left cell: left side of a comparison (e.g. "You"). Center: label. Right cell: opposite side. This unifies the review screen, accuracy rows, classification rows, any "A vs B" view.

### 2.11 Button

```css
.btn-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 10px;
  background: #22c55e;            /* or --primary for the app-blue variant */
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}
.btn-primary:hover { background: #16a34a; }

.btn-ghost {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  padding: 10px;
}
.btn-ghost:hover { background: rgba(255, 255, 255, 0.04); }
```

Two variants cover the system: **primary** (one per screen) and **ghost** (secondary). No outlined, no text-only — if you need a third variant, reconsider.

### 2.12 Avatar (with winner ring)

For review screen player display.

```html
<div class="avatar" data-won>  <!-- outer wrapper gets green ring if winner -->
  <div class="avatar-inner"><img /></div>
</div>
```

```css
.avatar[data-won] { padding: 2px; border-radius: 12px; background: #22c55e; }
.avatar-inner { width: 40px; height: 40px; border-radius: 10px; overflow: hidden; background: rgba(255,255,255,0.06); }
```

Fallback when no avatar URL: first letter, `font-size: 40%` of size, `font-weight: 700`, color `rgba(255,255,255,0.3)`.

---

## 3. Composition rules

### 3.1 A screen is cards stacked with `gap: 10px`

Every screen in the panel body is:

```html
<div style="display:flex; flex-direction:column; gap:10px; padding:12px">
  <Card /> <Card /> <Card /> ...
</div>
```

No outlier margins. If a card needs more breathing room, change the parent `gap`.

### 3.2 Every card starts with a label row

The very first child of a card is always a `[SECTION LABEL] [optional right slot]` row. Even tiny cards follow this — it makes the panel scannable.

Exception: stat cards where the number is the entire point (big accuracy display). Then the label can be inside.

### 3.3 Numeric data > decorative text

When communicating a value, prefer the number (tabular-nums). Avoid sentences. "Opening 59.9" beats "Opening accuracy is 59.9%".

### 3.4 Color-code by context, not by whimsy

- Interactive / in-progress → **blue**
- Autonomous / engine-thinking → **violet**
- Success / winner → **green**
- Neutral-result / draw / caution → **amber**
- Failure / danger → **red**

Never pick a color because it "looks nice". The color encodes meaning.

### 3.5 Motion signals state change

Counters animate to new values — they don't snap. Rows stagger in on first mount only (not on re-render). The turn-pill pulses when it's your turn. Move-quality bar segments scale in from 0. None of this is decorative — each animation tells the user something has changed.

Respect `disableAnimations`: all GSAP tweens must fall back to `gsap.set(...)`.

---

## 4. Patterns

### 4.1 Labeled row inside a card

The single most common line in the system.

```
[icon]  Label                  value  [optional slot]
        description goes here
```

- Left: icon (10-18px) or color dot + label (`11-12px`, weight 600, `#e4e4e7`).
- Right: the value (tabular-nums) and/or an action (toggle, button).
- Rows inside the same card are separated by `border-top: 1px solid rgba(255,255,255,0.04)` except the first one, with `padding: 6px 0`.

### 4.2 Mode-gated sections

When a parent card hosts mode-dependent children:

1. Render the mode selector (mode-tabs) at the top of the parent.
2. Sections below the selector **transition in/out** based on mode. Use GSAP fade + slide (opacity 0 → 1, y 6 → 0, duration 0.25s).
3. Shared sections persist across modes (same card, same values).
4. Mode-specific sections swap — cleared from DOM when leaving the mode.

### 4.3 Progress bar + label head

```
MOVE QUALITY                   50 moves
[████▓▓▒▒░░░░░░░░░░░░░░░░░░]
```

Head: flex, 8px uppercase label (left) + 8px muted count (right). Bar: 8-10px tall, segments with `min-width: 3px`, `gap: 1px` between.

### 4.4 Skeleton / placeholder

When data is loading, render the same shape the data will occupy, with:

- Background: `rgba(255,255,255,0.03-0.05)` (matches the arrow color at low alpha where applicable).
- Animation: `animation: skeleton-pulse 2s ease-in-out infinite` (opacity 0.5 ↔ 1).

Never show a spinner in a content card — always use skeleton.

---

## 5. What does NOT belong in the system

These are patterns the mockup deliberately avoids. Audits should flag them:

- **Drop-shadows on inner cards** (only panel + active buttons get shadows).
- **Flat #000 or #fff backgrounds** (always use a layering scheme).
- **Decorative color** (every accent color encodes a role).
- **Font sizes outside the scale** (7, 8, 9, 10, 11, 12, 13, 14, 16, 20, 22).
- **Radii outside the scale** (4, 6, 8, 10, 12, 999).
- **Non-tabular numeric display** (always tabular-nums for values).
- **Spinners inside content** (use skeletons).
- **Pure CSS transitions on complex animations** (use GSAP, respect disableAnimations).
- **Uppercase body text** (reserved for labels ≤ 10px).

---

## 6. Current state vs. system (summary for audit)

Below is a quick scan of the current chessrv3 components against the system. Entries marked ⚠ need alignment in the audit step.

| Area | Current state | System target | Note |
|---|---|---|---|
| Game turn pill | ✅ Matches (dot + colored pill) | Same | Already good |
| Game card (You play / Turn) | ~ Uses `hsl(var(--muted) / 0.5)` — too opaque | Rgba(255,255,255,0.03) | ⚠ Darken contrast |
| Suggestion rows | ~ Has border-left accent, good | Keep + add hotkey chip slot | ⚠ Add hotkey chip |
| Tab bar (Game/Engine) | ✅ Matches | Same | |
| Settings screen | ⚠ Mixed — some raw px values, some `hsl(var(...))` | Migrate to token + system primitives | ⚠ Major audit |
| Engine section (Elo, Personality, etc.) | ~ Close, but spacing inconsistent | Apply 10px card padding uniformly | ⚠ Minor |
| Slider | ✅ Already implements the system | Same | Canonical |
| Panel (FAB + body) | ✅ Matches panel shadow + radius | Same | |
| Review screen | ✅ Recently aligned to 3-col grid | Same | Canonical |
| Performance card | ~ Numbers not all tabular-nums | Add tabular-nums | ⚠ Minor fix |
| Floating widget | ~ Uses some custom values | Move to `fCard / fRow / fLabel` extraction | ⚠ Could be cleaner |

The audit step will go row-by-row with the `interface-design:audit` skill.

---

## 7. References

- Brainstorm mockup: `.superpowers/brainstorm/43482-1776599937/auto-move-tab.html` (the Auto Move tab, source of the premium language).
- Review screen: `chessr-next/chessrv3/entrypoints/content/components/ReviewScreen.tsx` (already aligned — canonical example of 3-col grid + avatar + player stats).
- Slider: `chessr-next/chessrv3/entrypoints/content/components/Slider.tsx` (canonical slider implementation).
- CSS vars: `chessr-next/chessrv3/entrypoints/content/app.css` (token source).
