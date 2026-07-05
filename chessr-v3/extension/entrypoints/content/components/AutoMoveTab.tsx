import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import gsap from 'gsap';
import { useAutoMoveStore, type AutoMoveMode, type MovePreset, type HumanizePreset } from '../stores/autoMoveStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore, type Plan } from '../stores/authStore';
import { usePlatformStore, platformSupportsPremove } from '../stores/platformStore';
import Slider from './Slider';
import RangeSlider from './RangeSlider';
import Toggle from './Toggle';
import { useTranslation, t as tStatic } from '../lib/i18n';
import './auto-move-tab.css';

import { isPremium } from '../lib/premium';
import PremiumCta, { PremiumCtaCard } from './PremiumCta';

function platformLabel(p: ReturnType<typeof usePlatformStore.getState>['platform']): string {
  switch (p) {
    case 'lichess':    return 'Lichess';
    case 'worldchess': return 'World Chess';
    case 'chesscom':   return 'Chess.com';
    default:           return tStatic('auto.platform.thisPlatform');
  }
}

function useModeMeta(): Record<AutoMoveMode, { name: string; desc: string; cls: string; bg: string; border: string }> {
  const { t } = useTranslation();
  return {
    off:    { name: t('auto.mode.off'),    desc: t('auto.mode.off.desc'),    cls: 'off',  bg: 'rgba(255, 255, 255, 0.03)', border: 'rgba(228, 228, 231, 0.6)' },
    hotkey: { name: t('auto.mode.hotkey'), desc: t('auto.mode.hotkey.desc'), cls: 'hot',  bg: 'rgba(59, 130, 246, 0.15)',  border: 'rgba(96, 165, 250, 0.6)' },
    auto:   { name: t('auto.mode.auto'),   desc: t('auto.mode.auto.desc'),   cls: 'auto', bg: 'rgba(168, 85, 247, 0.15)',  border: 'rgba(192, 132, 252, 0.6)' },
  };
}

const SLOT_COLORS = ['#22c55e', '#3b82f6', '#f59e0b'];

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

// Full name — shown inside the KeyInput box
export function displayKey(key: string): string {
  switch (key) {
    case 'Shift':   return 'Shift';
    case 'Control': return 'Ctrl';
    case 'Alt':     return IS_MAC ? 'Option' : 'Alt';
    case 'Meta':    return IS_MAC ? 'Cmd'    : 'Win';
    case 'Space':
    case ' ':       return 'Space';
    case 'Enter':   return 'Enter';
    case 'Tab':     return 'Tab';
    case 'Escape':  return 'Esc';
    default:        return key;
  }
}

// Format a single millisecond value — `<1000` stays in ms, `≥1000` flips
// to seconds with up to 2 decimals stripped of trailing zeros so 1000 is
// "1s", 1500 is "1.5s", 1650 is "1.65s".
function fmtMs(v: number): string {
  if (v >= 1000) {
    const s = (v / 1000).toFixed(2).replace(/\.?0+$/, '');
    return `${s}s`;
  }
  return `${v}ms`;
}

// Range formatter — picks one unit for the whole range so "500ms–1.5s"
// (mixed) doesn't appear; if either bound crosses 1000ms, both render in
// seconds.
function fmtMsRange([lo, hi]: [number, number]): string {
  if (hi >= 1000) {
    const loS = (lo / 1000).toFixed(2).replace(/\.?0+$/, '');
    const hiS = (hi / 1000).toFixed(2).replace(/\.?0+$/, '');
    return `${loS}–${hiS} s`;
  }
  return `${lo}–${hi} ms`;
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
  const { t } = useTranslation();
  const MODE_META = useModeMeta();
  const s = useAutoMoveStore();
  const plan = useAuthStore((st) => st.plan);
  const premium = isPremium(plan);

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
    const meta = MODE_META[s.mode];
    const bg = meta.bg;
    const border = meta.border;
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
            // Auto + Hotkey are premium-only — free tier sees only Off
            // active. Locked buttons stay visible (greyed) so the user
            // sees what's available with an upgrade.
            const locked = !premium && (m === 'auto' || m === 'hotkey');
            return (
              <button
                key={m}
                type="button"
                data-mode={m}
                disabled={locked}
                title={locked ? t('auto.mode.locked') : undefined}
                className={`am-mode-btn ${meta.cls} ${active ? 'active' : ''} ${locked ? 'am-mode-btn--locked' : ''}`}
                onClick={() => { if (!locked) s.setMode(m); }}
              >
                <span className="am-mode-name">{meta.name}{locked ? ' 🔒' : ''}</span>
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
          premium ? (
            <div className="am-off-hint">{t('auto.offHint')}</div>
          ) : (
            <PremiumCtaCard
              source="automove-off"
              label={t('auto.unlock.title')}
              body={t('auto.unlock.body')}
            />
          )
        )}
      </div>
    </div>
  );
}

// ─── Hotkeys ───

function HotkeysCard() {
  const { t } = useTranslation();
  const s = useAutoMoveStore();
  const plan = useAuthStore((st) => st.plan);
  const premium = isPremium(plan);
  const platform = usePlatformStore((st) => st.platform);
  const premoveOk = platformSupportsPremove(platform);
  const premoveLocked = !premoveOk;
  const modDisplay = displayKey(s.premoveKey);
  return (
    <div className="am-card am-card--tight">
      <div className="am-card-top">
        <span className="am-card-title">{t('auto.hotkey.title')}</span>
      </div>
      <span className="am-card-hint">{t('auto.hotkey.clickKey')}</span>
      <div className="am-card-head">
        <span className="am-card-sublabel">{t('auto.hotkey.move')}</span>
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
      <div className={`am-card-head ${premoveLocked ? 'am-card-head--disabled' : ''}`}>
        <span className="am-card-sublabel">{t('auto.hotkey.premove')}</span>
        <KeyInput
          value={s.premoveKey}
          onChange={s.setPremoveKey}
          modifierOnly
          disabled={premoveLocked}
        />
      </div>
      {premoveLocked && (
        <div className="am-platform-warn">
          {t('auto.hotkey.notSupported', { platform: platformLabel(platform) })}
        </div>
      )}
      <div className="am-card-example">
        <span className="am-card-example-title">{t('auto.hotkey.exampleTitle')}</span>
        <div className="am-card-example-row">
          <div className="am-card-example-combo">
            <span className="am-kbd">{s.hotkey1}</span>
          </div>
          <span className="am-card-example-text">{t('auto.hotkey.playMove')}</span>
        </div>
        {!premoveLocked && (
          <div className="am-card-example-row">
            <div className="am-card-example-combo">
              <span className="am-kbd">{modDisplay}</span>
              <span className="am-kbd-plus">+</span>
              <span className="am-kbd">{s.hotkey1}</span>
            </div>
            <span className="am-card-example-text">
              {t('auto.hotkey.playPremove')} <em>{t('auto.hotkey.ifAvailable')}</em>
            </span>
          </div>
        )}
      </div>

      <div className="am-row">
        <div className="am-row-label-col">
          <span className="am-row-label-text">{t('auto.onScreenButtons')}</span>
          <span className="am-row-desc">
            {premoveOk ? t('auto.onScreenButtons.desc') : t('auto.onScreenButtons.descNoPremove')}
          </span>
        </div>
        <Toggle
          checked={premium && s.useOnScreenButtons}
          onChange={(v) => { if (premium) s.setUseOnScreenButtons(v); }}
          disabled={!premium}
        />
      </div>

      {!premium && (
        <>
          <div className="am-upgrade-note">{t('auto.upgrade.hotkey')}</div>
          <PremiumCta source="automove-hotkey" />
        </>
      )}
    </div>
  );
}

// ─── Premove delay ───

function PremoveCard() {
  const { t } = useTranslation();
  const s = useAutoMoveStore();
  const plan = useAuthStore((st) => st.plan);
  const premium = isPremium(plan);
  const platform = usePlatformStore((st) => st.platform);
  const premoveOk = platformSupportsPremove(platform);
  const disabled = !premium || !premoveOk;
  return (
    <div className={`am-card ${!premoveOk ? 'am-card--locked' : ''}`}>
      <div className="am-card-head">
        <span className="am-card-title">{t('auto.premoveCard.title')}</span>
        <span className="am-slider-val">{fmtMsRange(s.premoveDelay)}</span>
      </div>
      <span className="am-card-sub">{t('auto.premoveCard.timeBefore')}</span>
      <div className="am-slider-row">
        <RangeSlider value={s.premoveDelay} onChange={s.setPremoveDelay} min={0} max={60000} step={50} color="#3b82f6" disabled={disabled} />
      </div>
      {!premoveOk && (
        <div className="am-platform-warn">
          {t('auto.premoveCard.notSupported', { platform: platformLabel(platform) })}
        </div>
      )}
    </div>
  );
}

// ─── Auto Play ───

function isBotUrl(path: string): boolean {
  return /\/play\/computer|\/game\/computer\//.test(path);
}

function AutoPlayCard() {
  const { t } = useTranslation();
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
        <span className="am-card-title">{t('auto.autoPlay.title')}</span>
      </div>
      <div className="am-slider-row">
        <div className="am-slider-head">
          <span className="am-slider-label">{t('auto.autoPlay.delay')}</span>
          <span className="am-slider-val">{fmtMsRange(s.autoPlayDelay)}</span>
        </div>
        {/* Play delay stays customizable on free — it's the one auto-mode
            knob the user can tune even without premium. The auto MODE
            itself is locked at the mode-switch level above; if a free
            user is here it's because they were premium previously. */}
        <RangeSlider value={s.autoPlayDelay} onChange={s.setAutoPlayDelay} min={0} max={60000} step={50} color="#a855f7" />
      </div>
      <div className="am-card-head">
        <span className="am-card-sublabel">{t('auto.autoPlay.playPauseKey')}</span>
        <KeyInput
          value={s.autoPlayPauseKey}
          onChange={s.setAutoPlayPauseKey}
        />
      </div>
      <div className="am-row">
        <div className="am-row-label-col">
          <span className="am-row-desc">{t('auto.autoPlay.rematch')}</span>
          {isBotGame && (
            <span className="am-row-desc" style={{ color: '#fbbf24', fontSize: 9 }}>
              {t('auto.autoPlay.botNotAvailable')}
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
        <>
          <div className="am-upgrade-note">{t('auto.upgrade.auto')}</div>
          <PremiumCta source="automove-auto" />
        </>
      )}
    </div>
  );
}

// ─── Move selection ───

function MoveSelectionCard() {
  const { t } = useTranslation();
  const s = useAutoMoveStore();
  const plan = useAuthStore((st) => st.plan);
  const premium = isPremium(plan);
  const [w1, w2, w3] = s.moveWeights;
  const total = w1 + w2 + w3 || 1;

  const presetClick = (p: MovePreset) => { if (premium) s.setMovePreset(p); };

  return (
    <div className="am-card">
      <div className="am-card-head">
        <span className="am-card-title">{t('auto.moveSelection.title')}</span>
      </div>
      <div className="am-card-sub">{t('auto.moveSelection.desc')}</div>

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
            {p === 'mostly-best' ? t('auto.preset.mostlyBest') : p === 'balanced' ? t('auto.preset.balanced') : p === 'equal' ? t('auto.preset.equal') : t('auto.preset.manual')}
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
            <span>{t('auto.moveSelection.moveN', { n: i + 1 })}</span>
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
          <span className="am-row-label-text">{t('auto.moveSelection.prioritize')}</span>
          <span className="am-row-desc">{t('auto.moveSelection.prioritizeDesc')}</span>
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
  const { t } = useTranslation();
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
        <span className="am-card-title">{t('auto.humanize.title')}</span>
        <span className="am-slider-val">≈ {fmtMs(Math.round(total))}</span>
      </div>
      <div className="am-card-sub">{t('auto.humanize.desc')}</div>
      <div className="am-presets">
        {(['fast', 'balanced', 'slow', 'manual'] as const).map((p) => (
          <button
            key={p}
            type="button"
            disabled={locked}
            className={`am-preset ${cfg.preset === p ? 'active' : ''} ${locked ? 'am-preset--disabled' : ''}`}
            onClick={() => { if (!locked) s.setHumanizePreset(target, p); }}
          >
            {p === 'fast' ? t('auto.humanize.fast') : p === 'balanced' ? t('auto.preset.balanced') : p === 'slow' ? t('auto.humanize.slow') : t('auto.preset.manual')}
          </button>
        ))}
      </div>
      <DelayRange label={t('auto.humanize.pick')}   value={cfg.pickDelay}   onChange={(v) => s.setPickDelay(target, v)}   min={0} max={500} color="#22c55e" disabled={locked} />
      <DelayRange label={t('auto.humanize.select')} value={cfg.selectDelay} onChange={(v) => s.setSelectDelay(target, v)} min={0} max={300} color="#3b82f6" disabled={locked} />
      <DelayRange label={t('auto.humanize.move')}   value={cfg.moveDelay}   onChange={(v) => s.setMoveDelay(target, v)}   min={0} max={500} color="#a855f7" disabled={locked} />
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
        <span className="am-slider-val">{fmtMsRange(value)}</span>
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
    // Normalize a few non-printables so the stored value is searchable
    // (e.key for Space is the literal ' ' which renders blank). The
    // matcher's canonicalKey() understands the lowercase tokens.
    let k = e.key;
    if (e.code === 'Space')          k = 'Space';
    else if (e.code === 'Enter')     k = 'Enter';
    else if (e.code === 'Tab')       k = 'Tab';
    else if (e.code === 'Escape')    k = 'Escape';
    else if (e.code === 'Backspace') k = 'Backspace';
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
      {capturing ? tStatic('auto.key.press') : display}
    </button>
  );
}

