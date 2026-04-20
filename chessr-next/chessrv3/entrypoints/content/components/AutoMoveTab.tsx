import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import gsap from 'gsap';
import { useAutoMoveStore, type AutoMoveMode, type MovePreset, type HumanizePreset } from '../stores/autoMoveStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore, type Plan } from '../stores/authStore';
import Slider from './Slider';
import RangeSlider from './RangeSlider';
import Toggle from './Toggle';
import './auto-move-tab.css';

function isPremium(plan: Plan): boolean {
  return plan === 'premium' || plan === 'lifetime' || plan === 'beta' || plan === 'freetrial';
}

const MODE_META: Record<AutoMoveMode, { name: string; desc: string; cls: string; bg: string; border: string }> = {
  off:    { name: 'Off',    desc: 'Manual play',          cls: 'off',  bg: 'rgba(255, 255, 255, 0.03)', border: 'rgba(228, 228, 231, 0.6)' },
  hotkey: { name: 'Hotkey', desc: 'You press a key',      cls: 'hot',  bg: 'rgba(59, 130, 246, 0.15)',  border: 'rgba(96, 165, 250, 0.6)' },
  auto:   { name: 'Auto',   desc: 'Engine plays for you', cls: 'auto', bg: 'rgba(168, 85, 247, 0.15)',  border: 'rgba(192, 132, 252, 0.6)' },
};

const SLOT_COLORS = ['#22c55e', '#3b82f6', '#f59e0b'];

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

// Full name — shown inside the KeyInput box
export function displayKey(key: string): string {
  switch (key) {
    case 'Shift':   return 'Shift';
    case 'Control': return 'Ctrl';
    case 'Alt':     return IS_MAC ? 'Option' : 'Alt';
    case 'Meta':    return IS_MAC ? 'Cmd'    : 'Win';
    default:        return key;
  }
}

// Compact abbreviation / symbol — shown inside kbd chips in the example
export function displayKeyCompact(key: string): string {
  switch (key) {
    case 'Shift':   return '⇧';
    case 'Control': return IS_MAC ? '⌃' : 'Ctrl';
    case 'Alt':     return IS_MAC ? '⌥' : 'Alt';
    case 'Meta':    return IS_MAC ? '⌘' : 'Win';
    default:        return key;
  }
}

export default function AutoMoveTab() {
  const s = useAutoMoveStore();

  const modeRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const firstModeRender = useRef(true);

  useLayoutEffect(() => {
    const bar = modeRef.current;
    const ind = indicatorRef.current;
    if (!bar || !ind) return;
    const activeBtn = bar.querySelector<HTMLButtonElement>(`[data-mode="${s.mode}"]`);
    if (!activeBtn) return;
    const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = activeBtn;
    const { bg, border } = MODE_META[s.mode];
    const disable = useSettingsStore.getState().disableAnimations;

    if (firstModeRender.current || disable) {
      gsap.set(ind, { x: offsetLeft, y: offsetTop, width: offsetWidth, height: offsetHeight, backgroundColor: bg, borderColor: border, opacity: 1 });
      firstModeRender.current = false;
    } else {
      gsap.to(ind, {
        x: offsetLeft, y: offsetTop, width: offsetWidth, height: offsetHeight,
        backgroundColor: bg, borderColor: border,
        duration: 0.3, ease: 'power3.out',
      });
    }
  }, [s.mode]);

  // Mode content fade-in
  const contentRef = useRef<HTMLDivElement>(null);
  const firstContentRender = useRef(true);
  useLayoutEffect(() => {
    if (firstContentRender.current) { firstContentRender.current = false; return; }
    if (!contentRef.current) return;
    if (useSettingsStore.getState().disableAnimations) return;
    gsap.fromTo(contentRef.current, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.22, ease: 'power2.out' });
  }, [s.mode]);

  return (
    <div className="am-tab">
      {/* Mode switch */}
      <div className="am-mode-wrap">
        <div className="am-mode" ref={modeRef}>
          <div className="am-mode-indicator" ref={indicatorRef} />
          {(['off', 'hotkey', 'auto'] as const).map((m) => {
            const meta = MODE_META[m];
            const active = s.mode === m;
            return (
              <button
                key={m}
                type="button"
                data-mode={m}
                className={`am-mode-btn ${meta.cls} ${active ? 'active' : ''}`}
                onClick={() => s.setMode(m)}
              >
                <span className="am-mode-name">{meta.name}</span>
                <span className="am-mode-desc">{meta.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div ref={contentRef} className="am-mode-content">
        {s.mode === 'hotkey' && (
          <>
            <HotkeysCard />
            <PremoveCard />
            <HumanizeCard />
          </>
        )}

        {s.mode === 'auto' && (
          <>
            <AutoPlayCard />
            <MoveSelectionCard />
            <HumanizeCard />
          </>
        )}

        {s.mode === 'off' && (
          <div className="am-off-hint">Select a mode to configure assist.</div>
        )}
      </div>
    </div>
  );
}

// ─── Hotkeys ───

function HotkeysCard() {
  const s = useAutoMoveStore();
  const plan = useAuthStore((st) => st.plan);
  const premium = isPremium(plan);
  const modDisplay = displayKey(s.premoveKey);
  return (
    <div className="am-card am-card--tight">
      <div className="am-card-top">
        <span className="am-card-title">Hotkey</span>
      </div>
      <span className="am-card-hint">Click a key to configure</span>
      <div className="am-card-head">
        <span className="am-card-sublabel">Move</span>
        <div className="am-hotkey-slots">
          {[1, 2, 3].map((slot) => (
            <div key={slot} className="am-hotkey-slot">
              <span className="am-dot" style={{ background: SLOT_COLORS[slot - 1] }} />
              <KeyInput
                value={(s as any)[`hotkey${slot}`]}
                onChange={(key) => s.setHotkey(slot as 1 | 2 | 3, key)}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="am-card-head">
        <span className="am-card-sublabel">Premove</span>
        <KeyInput value={s.premoveKey} onChange={s.setPremoveKey} modifierOnly />
      </div>
      <div className="am-card-example">
        <span className="am-card-example-title">Example · Move 1</span>
        <div className="am-card-example-row">
          <div className="am-card-example-combo">
            <span className="am-kbd">{s.hotkey1}</span>
          </div>
          <span className="am-card-example-text">play the move</span>
        </div>
        <div className="am-card-example-row">
          <div className="am-card-example-combo">
            <span className="am-kbd">{modDisplay}</span>
            <span className="am-kbd-plus">+</span>
            <span className="am-kbd">{s.hotkey1}</span>
          </div>
          <span className="am-card-example-text">
            play + queue premove <em>(if available)</em>
          </span>
        </div>
      </div>
      {!premium && (
        <div className="am-upgrade-note">Upgrade to premium to unlock full hotkey tuning</div>
      )}
    </div>
  );
}

// ─── Premove delay ───

function PremoveCard() {
  const s = useAutoMoveStore();
  const plan = useAuthStore((st) => st.plan);
  const premium = isPremium(plan);
  return (
    <div className="am-card">
      <div className="am-card-head">
        <span className="am-card-title">Premove</span>
        <span className="am-slider-val">{s.premoveDelay[0]}–{s.premoveDelay[1]} ms</span>
      </div>
      <span className="am-card-sub">Time before queuing the premove</span>
      <div className="am-slider-row">
        <RangeSlider value={s.premoveDelay} onChange={s.setPremoveDelay} min={0} max={3000} step={50} color="#3b82f6" disabled={!premium} />
      </div>
    </div>
  );
}

// ─── Auto Play ───

function isBotUrl(path: string): boolean {
  return /\/play\/computer|\/game\/computer\//.test(path);
}

function AutoPlayCard() {
  const s = useAutoMoveStore();
  const plan = useAuthStore((st) => st.plan);
  const premium = isPremium(plan);
  const [isBotGame, setIsBotGame] = useState(() => isBotUrl(location.pathname));
  useEffect(() => {
    const onNav = () => setIsBotGame(isBotUrl(location.pathname));
    window.addEventListener('popstate', onNav);
    // chess.com SPA nav — poll as safety net
    const id = setInterval(onNav, 1000);
    return () => { window.removeEventListener('popstate', onNav); clearInterval(id); };
  }, []);
  return (
    <div className="am-card">
      <div className="am-card-head">
        <span className="am-card-title">Auto Play</span>
      </div>
      <div className="am-slider-row">
        <div className="am-slider-head">
          <span className="am-slider-label">Play delay</span>
          <span className="am-slider-val">{s.autoPlayDelay[0]}–{s.autoPlayDelay[1]} ms</span>
        </div>
        <RangeSlider value={s.autoPlayDelay} onChange={s.setAutoPlayDelay} min={0} max={3000} step={50} color="#a855f7" disabled={!premium} />
      </div>
      <div className="am-row">
        <div className="am-row-label-col">
          <span className="am-row-desc">Auto-rematch when the game ends</span>
          {isBotGame && (
            <span className="am-row-desc" style={{ color: '#fbbf24', fontSize: 9 }}>
              This is not available on bot games
            </span>
          )}
        </div>
        <Toggle
          checked={s.autoRematch && !isBotGame}
          onChange={s.setAutoRematch}
          disabled={!premium || isBotGame}
        />
      </div>
      {!premium && (
        <div className="am-upgrade-note">Upgrade to premium to unlock full auto-play tuning</div>
      )}
    </div>
  );
}

// ─── Move selection ───

function MoveSelectionCard() {
  const s = useAutoMoveStore();
  const plan = useAuthStore((st) => st.plan);
  const premium = isPremium(plan);
  const [w1, w2, w3] = s.moveWeights;
  const total = w1 + w2 + w3 || 1;

  const presetClick = (p: MovePreset) => { if (premium) s.setMovePreset(p); };

  return (
    <div className="am-card">
      <div className="am-card-head">
        <span className="am-card-title">Move selection</span>
      </div>
      <div className="am-card-sub">How often the engine picks move #1 vs alternatives</div>

      {/* Presets on top */}
      <div className="am-presets">
        {(['mostly-best', 'balanced', 'equal', 'manual'] as const).map((p) => (
          <button
            key={p}
            type="button"
            disabled={!premium}
            className={`am-preset ${s.movePreset === p ? 'active' : ''} ${!premium ? 'am-preset--disabled' : ''}`}
            onClick={() => presetClick(p)}
          >
            {p === 'mostly-best' ? 'Mostly best' : p === 'balanced' ? 'Balanced' : p === 'equal' ? 'Equal' : 'Manual'}
          </button>
        ))}
      </div>

      {/* Stacked probability bar */}
      <div className="am-stack-bar">
        <div style={{ width: `${(w1 / total) * 100}%`, background: SLOT_COLORS[0] }} />
        <div style={{ width: `${(w2 / total) * 100}%`, background: SLOT_COLORS[1] }} />
        <div style={{ width: `${(w3 / total) * 100}%`, background: SLOT_COLORS[2] }} />
      </div>

      {/* 3 sliders */}
      {[0, 1, 2].map((i) => (
        <div key={i} className="am-weight-row">
          <div className="am-row-label">
            <span className="am-dot" style={{ background: SLOT_COLORS[i] }} />
            <span>Move {i + 1}</span>
          </div>
          <div className="am-weight-slider">
            <Slider
              min={0} max={100} step={1}
              value={s.moveWeights[i]}
              onChange={(v) => s.setMoveWeight(i as 0 | 1 | 2, v)}
              disabled={!premium}
              trackColor={SLOT_COLORS[i]}
              thumbColor={SLOT_COLORS[i]}
            />
          </div>
          <span className="am-weight-val" style={{ color: SLOT_COLORS[i] }}>{s.moveWeights[i]}%</span>
        </div>
      ))}

      <div className="am-row">
        <div className="am-row-label-col">
          <span className="am-row-label-text">Prioritize checks & mates</span>
          <span className="am-row-desc">Always play a forcing move when available; sample between moves if multiple.</span>
        </div>
        <Toggle
          checked={premium ? s.prioritizeForcing : true}
          onChange={(v) => { if (premium) s.setPrioritizeForcing(v); }}
          disabled={!premium}
        />
      </div>
    </div>
  );
}

// ─── Humanize (shared) ───

function HumanizeCard() {
  const s = useAutoMoveStore();
  const plan = useAuthStore((st) => st.plan);
  const premium = isPremium(plan);
  const target: 'hotkey' | 'auto' = s.mode === 'auto' ? 'auto' : 'hotkey';
  const cfg = s.humanize[target];
  const total = avg(cfg.pickDelay) + avg(cfg.selectDelay) + avg(cfg.moveDelay);
  // Tuning is premium-gated for both modes.
  const locked = !premium;
  const accentStyle: React.CSSProperties = target === 'hotkey'
    ? { '--preset-tint': 'rgba(59, 130, 246, 0.15)', '--preset-border': 'rgba(59, 130, 246, 0.35)', '--preset-color': '#60a5fa' } as React.CSSProperties
    : { '--preset-tint': 'rgba(168, 85, 247, 0.15)', '--preset-border': 'rgba(168, 85, 247, 0.35)', '--preset-color': '#c084fc' } as React.CSSProperties;
  return (
    <div className="am-card" style={accentStyle}>
      <div className="am-card-head">
        <span className="am-card-title">Humanize</span>
        <span className="am-slider-val">≈ {Math.round(total)} ms</span>
      </div>
      <div className="am-card-sub">Randomized delays around each move</div>
      <div className="am-presets">
        {(['fast', 'balanced', 'slow', 'manual'] as const).map((p) => (
          <button
            key={p}
            type="button"
            disabled={locked}
            className={`am-preset ${cfg.preset === p ? 'active' : ''} ${locked ? 'am-preset--disabled' : ''}`}
            onClick={() => { if (!locked) s.setHumanizePreset(target, p); }}
          >
            {p === 'fast' ? 'Fast' : p === 'balanced' ? 'Balanced' : p === 'slow' ? 'Slow' : 'Manual'}
          </button>
        ))}
      </div>
      <DelayRange label="Pick"   value={cfg.pickDelay}   onChange={(v) => s.setPickDelay(target, v)}   min={0} max={500} color="#22c55e" disabled={locked} />
      <DelayRange label="Select" value={cfg.selectDelay} onChange={(v) => s.setSelectDelay(target, v)} min={0} max={300} color="#3b82f6" disabled={locked} />
      <DelayRange label="Move"   value={cfg.moveDelay}   onChange={(v) => s.setMoveDelay(target, v)}   min={0} max={500} color="#a855f7" disabled={locked} />
    </div>
  );
}

function DelayRange({ label, value, onChange, min, max, color, disabled }: {
  label: string;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  min: number; max: number; color: string; disabled?: boolean;
}) {
  return (
    <div className="am-slider-row">
      <div className="am-slider-head">
        <span className="am-slider-label">{label}</span>
        <span className="am-slider-val">{value[0]}–{value[1]} ms</span>
      </div>
      <RangeSlider value={value} onChange={onChange} min={min} max={max} step={10} color={color} disabled={disabled} />
    </div>
  );
}

// ─── Tiny primitives ───

function avg(r: [number, number]) { return (r[0] + r[1]) / 2; }

function KeyInput({ value, onChange, modifierOnly, disabled }: { value: string; onChange: (k: string) => void; modifierOnly?: boolean; disabled?: boolean }) {
  const [capturing, setCapturing] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const onKey = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!capturing) return;
    const k = e.key;
    if (modifierOnly && !['Shift', 'Control', 'Alt', 'Meta'].includes(k)) return;
    onChange(k);
    setCapturing(false);
    ref.current?.blur();
  };

  useEffect(() => {
    if (!capturing || disabled) return;
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, disabled]);

  const display = displayKey(value);

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      className={`am-key ${capturing ? 'capturing' : ''} ${disabled ? 'am-key--disabled' : ''}`}
      onClick={() => { if (!disabled) setCapturing(true); }}
      onBlur={() => setCapturing(false)}
    >
      {capturing ? 'Press…' : display}
    </button>
  );
}

