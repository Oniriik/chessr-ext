import { useState, useEffect, useRef } from 'react';
import { useTranslation, t as tStatic } from '../lib/i18n';
import { useAuthStore } from '../stores/authStore';
import { isPremium } from '../lib/premium';
import { openBillingPage } from '../lib/openBilling';
import { useOpeningStore } from '../stores/openingStore';
import { searchOpenings, fetchPopularOpenings, type OpeningEntry } from '../lib/openingApi';
import './opening.css';

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`opening-toggle ${on ? 'opening-toggle--on' : ''}`}
      onClick={() => onChange(!on)}
      type="button"
      aria-pressed={on}
    >
      <div className="opening-toggle-thumb" />
    </button>
  );
}

function ColorSwatch({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className="opening-color-swatch"
      style={{ background: color }}
      onClick={() => inputRef.current?.click()}
      title={tStatic('opening.tab.changeColor')}
    >
      <input
        ref={inputRef}
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function WinRateBar({ wr }: { wr: OpeningEntry['winRate'] | undefined }) {
  if (!wr || wr.white == null) return null;
  const w = Math.round(wr.white * 100);
  const d = Math.round((wr.draw ?? 0) * 100);
  const b = Math.max(0, 100 - w - d);
  return (
    <span className="opening-wr" title={`White ${w}% · Draw ${d}% · Black ${b}%`}>
      <span className="opening-wr-bar">
        <span style={{ width: `${w}%`, background: '#e4e4e7' }} />
        <span style={{ width: `${d}%`, background: '#52525b' }} />
        <span style={{ width: `${b}%`, background: '#18181b' }} />
      </span>
      <span className="opening-wr-pct">{w}%</span>
    </span>
  );
}

export default function OpeningTab() {
  const {
    selectedOpenings,
    addOpening,
    removeOpening,
    theoryArrowEnabled, setTheoryArrowEnabled,
    theoryArrowColor, setTheoryArrowColor,
    deviationArrowEnabled, setDeviationArrowEnabled,
    deviationArrowColor, setDeviationArrowColor,
  } = useOpeningStore();

  const { t } = useTranslation();
  const plan = useAuthStore((st) => st.plan);
  const premium = isPremium(plan);
  const [query, setQuery] = useState('');
  const [browseResults, setBrowseResults] = useState<OpeningEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the most-played openings on mount (empty-search browse list)
  useEffect(() => {
    setLoading(true);
    fetchPopularOpenings().then((results) => {
      setBrowseResults(results);
      setLoading(false);
    });
  }, []);

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      // Reset to the most-played list
      setLoading(true);
      fetchPopularOpenings().then((results) => {
        setBrowseResults(results);
        setLoading(false);
      });
      return;
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      searchOpenings(query, 20).then((results) => {
        setBrowseResults(results);
        setLoading(false);
      });
    }, 300);
  }, [query]);

  const isSelected = (eco: string) => selectedOpenings.some((o) => o.eco === eco);
  const isFull = selectedOpenings.length >= 3;

  return (
    <div className="opening-tab">

      {/* ── Premium lock banner + upgrade CTA ───── */}
      {!premium && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 7,
          padding: '9px 10px', borderRadius: 8,
          background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 600, color: '#fbbf24' }}>
            <span style={{ fontSize: 12 }}>🔒</span>
            <span>{t('opening.tab.premiumOnly')}</span>
          </div>
          <button
            onClick={() => openBillingPage()}
            style={{
              border: 'none', cursor: 'pointer', borderRadius: 6,
              padding: '6px 10px', fontSize: 11, fontWeight: 700,
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', color: '#1a1917',
            }}
          >
            {t('game.review.upgrade')}
          </button>
        </div>
      )}

      {/* Locked content stays visible (greyed) so free users see what an
          upgrade unlocks — same pattern as the AutoMove mode buttons. */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        ...(premium ? {} : { opacity: 0.45, pointerEvents: 'none', filter: 'grayscale(0.4)' }),
      }}>

      {/* ── White-only notice ───────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 8px', borderRadius: 6,
        background: 'rgba(213,164,125,0.08)', border: '1px solid rgba(213,164,125,0.25)',
        fontSize: 10, color: '#D5A47D',
      }}>
        <span style={{ fontSize: 12 }}>♙</span>
        <span>{t('opening.tab.whiteOnly')}</span>
      </div>

      {/* ── Slots ───────────────────────────────── */}
      <div className="opening-tab-section">
        <div className="opening-tab-header">
          <span className="opening-tab-label">{t('opening.tab.mySlots')}</span>
          <span className={`opening-tab-count ${isFull ? 'opening-tab-count--full' : ''}`}>
            {selectedOpenings.length} / 3
          </span>
        </div>
        <div className="opening-slots">
          {selectedOpenings.map((o) => (
            <div key={o.eco} className="opening-slot-filled">
              <span className="opening-eco">{o.eco}</span>
              <span className="opening-slot-filled-name">{o.name}</span>
              <WinRateBar wr={o.winRate} />
              <button className="opening-slot-remove" onClick={() => removeOpening(o.eco)}>✕</button>
            </div>
          ))}
          {Array.from({ length: 3 - selectedOpenings.length }).map((_, i) => (
            <button
              key={i}
              className="opening-slot-empty"
              onClick={() => {
                const first = browseResults.find((r) => !isSelected(r.eco));
                if (first) addOpening({ eco: first.eco, name: first.name, uci: first.uci, winRate: first.winRate });
              }}
              disabled={isFull}
            >
              {t('opening.tab.addSlot')}
            </button>
          ))}
        </div>
        {isFull && (
          <p className="opening-tab-desc">{t('opening.tab.maxReached')}</p>
        )}
      </div>

      {/* ── Browse ──────────────────────────────── */}
      <div className="opening-tab-section">
        <div className="opening-tab-header">
          <span className="opening-tab-label">{t('opening.tab.browse')}</span>
          <span className="opening-tab-count">{t('opening.tab.totalCount')}</span>
        </div>
        <div className="opening-search-row">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: '#52525b', flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="opening-search-input"
            type="text"
            placeholder={t('opening.tab.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{ background: 'transparent', border: 'none', color: '#52525b', cursor: 'pointer', fontSize: 10, padding: 0 }}
            >✕</button>
          )}
        </div>
        {loading ? (
          <p className="opening-tab-desc" style={{ textAlign: 'center' }}>{t('opening.tab.loading')}</p>
        ) : browseResults.length === 0 ? (
          <p className="opening-tab-desc" style={{ textAlign: 'center' }}>{t('opening.tab.noResults')}</p>
        ) : query.trim() ? (
          // Search results — flat list
          <div>
            {browseResults.slice(0, 20).map((o) => {
              const already = isSelected(o.eco);
              return (
                <div
                  key={o.eco}
                  className={`opening-browse-row ${already ? 'opening-browse-row--already' : isFull ? 'opening-browse-row--disabled' : ''}`}
                  onClick={() => { if (!already && !isFull) addOpening({ eco: o.eco, name: o.name, uci: o.uci, winRate: o.winRate }); }}
                >
                  <span className="opening-browse-eco">{o.eco}</span>
                  <span className="opening-browse-name">{o.name}</span>
                  <WinRateBar wr={o.winRate} />
                  {already
                    ? <span className="opening-browse-check">✓</span>
                    : <span className="opening-browse-add">{t('opening.tab.add')}</span>}
                </div>
              );
            })}
          </div>
        ) : (
          // Most-played openings (empty search)
          <div>
            <div className="opening-browse-group-lbl">{t('opening.tab.popular')}</div>
            {browseResults.map((o) => {
              const already = isSelected(o.eco);
              return (
                <div
                  key={o.eco}
                  className={`opening-browse-row ${already ? 'opening-browse-row--already' : isFull ? 'opening-browse-row--disabled' : ''}`}
                  onClick={() => { if (!already && !isFull) addOpening({ eco: o.eco, name: o.name, uci: o.uci, winRate: o.winRate }); }}
                >
                  <span className="opening-browse-eco">{o.eco}</span>
                  <span className="opening-browse-name">{o.name}</span>
                  <WinRateBar wr={o.winRate} />
                  {already
                    ? <span className="opening-browse-check">✓</span>
                    : <span className="opening-browse-add">{t('opening.tab.add')}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Theory arrows ───────────────────────── */}
      <div className="opening-tab-section">
        <div className="opening-tab-header">
          <span className="opening-tab-label">{t('opening.tab.theoryArrows')}</span>
          <Toggle on={theoryArrowEnabled} onChange={setTheoryArrowEnabled} />
        </div>
        {theoryArrowEnabled && (
          <div className="opening-color-row">
            <span className="opening-color-lbl">{t('opening.tab.color')}</span>
            <ColorSwatch color={theoryArrowColor} onChange={setTheoryArrowColor} />
          </div>
        )}
      </div>

      {/* ── Deviation arrows ────────────────────── */}
      <div className="opening-tab-section">
        <div className="opening-tab-header">
          <span className="opening-tab-label">{t('opening.tab.deviationArrows')}</span>
          <Toggle on={deviationArrowEnabled} onChange={setDeviationArrowEnabled} />
        </div>
        <p className="opening-tab-desc">{t('opening.tab.deviationDesc')}</p>
        {deviationArrowEnabled && (
          <div className="opening-color-row">
            <span className="opening-color-lbl">{t('opening.tab.color')}</span>
            <ColorSwatch color={deviationArrowColor} onChange={setDeviationArrowColor} />
          </div>
        )}
      </div>

      </div>{/* end lock wrapper */}

    </div>
  );
}
