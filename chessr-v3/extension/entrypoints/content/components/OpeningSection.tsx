import { useOpeningTracker } from '../hooks/useOpeningTracker';
import { useGameStore } from '../stores/gameStore';
import { useTranslation } from '../lib/i18n';
import type { NextMove } from '../lib/openingApi';
import './opening.css';

function fmtMove(uci: string): string {
  return `${uci.slice(0, 2)}→${uci.slice(2, 4)}`;
}

function fmtWinRate(reply: NextMove, playerColor: string | null): string | null {
  const wr = playerColor === 'black' ? reply.winRate?.black : reply.winRate?.white;
  return wr != null ? `${Math.round(wr * 100)}%` : null;
}

export default function OpeningSection() {
  const phase = useOpeningTracker();
  const playerColor = useGameStore((s) => s.playerColor);
  const moves = useGameStore((s) => s.moveHistoryUci);
  const { t } = useTranslation();

  if (phase.type === 'none') return null;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
        <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.07)' }} />
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#3f3f46', textTransform: 'uppercase' }}>
          {t('opening.section.title')}
        </span>
        <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.07)' }} />
      </div>

      {phase.type === 'no_match' && (
        <div className="opening-locked" style={{ opacity: 0.7 }}>
          <div className="opening-locked-top">
            <div className="opening-status-dot" style={{ background: '#52525b' }} />
            <span className="opening-locked-name">
              {t('opening.section.noMatch', { move: moves[0] ? fmtMove(moves[0]) : '' })}
            </span>
          </div>
          {phase.bookReply && (
            <div className="opening-next-row">
              <span className="opening-next-lbl">{t('opening.section.bookReply')}</span>
              <span className="opening-next-move">{fmtMove(phase.bookReply.uci)}</span>
              <span className="opening-chip-name">{phase.bookReply.name}</span>
            </div>
          )}
        </div>
      )}

      {(phase.type === 'start' || phase.type === 'narrowing') && (
        <div className="opening-chips">
          {phase.openings.map((o) => (
            <div key={o.eco} className={`opening-chip ${phase.type === 'narrowing' ? 'opening-chip--active' : ''}`}>
              <span className="opening-eco">{o.eco}</span>
              <span className="opening-chip-name">{o.name}</span>
              <span className="opening-chip-hint">{o.uci.split(' ')[0]}…</span>
            </div>
          ))}
        </div>
      )}

      {phase.type === 'in_book' && (
        <div className="opening-locked">
          <div className="opening-locked-top">
            <div className="opening-status-dot" style={{ background: '#4ade80', boxShadow: '0 0 5px #4ade8055' }} />
            <span className="opening-eco">{phase.opening.eco}</span>
            <span className="opening-locked-name">{phase.opening.name}</span>
          </div>
          {phase.nextMove && (
            <div className="opening-next-row">
              <span className="opening-next-lbl">{t('opening.section.yourTheoryMove')}</span>
              <span className="opening-next-move">{fmtMove(phase.nextMove)}</span>
            </div>
          )}
        </div>
      )}

      {phase.type === 'opp_deviated' && (
        <div className="opening-locked opening-locked--deviated">
          <div className="opening-locked-top">
            <div className="opening-status-dot" style={{ background: '#fde047', boxShadow: '0 0 5px #fde04755' }} />
            <span className="opening-eco">{phase.opening.eco}</span>
            <span className="opening-locked-name">{phase.opening.name}</span>
            <span className="opening-tag opening-tag--deviated">{t('opening.section.oppDeviated')}</span>
          </div>
          <div className="opening-next-row">
            <span className="opening-next-lbl">{t('opening.section.oppPlayed')}</span>
            <span className="opening-next-move">{fmtMove(phase.deviationMove)}</span>
          </div>
          {phase.theoryMove && (
            <div className="opening-theory-block">
              <div className="opening-theory-lbl">{t('opening.section.continuePlan')}</div>
              <span className="opening-theory-move">{fmtMove(phase.theoryMove)}</span>
            </div>
          )}
          {phase.bookReply && (
            <div className="opening-alts-block">
              <div className="opening-alts-lbl">{t('opening.section.bookReply')}</div>
              <div className="opening-alts-pills">
                <span className="opening-alt-pill">{fmtMove(phase.bookReply.uci)}</span>
                <span className="opening-chip-name">{phase.bookReply.name}</span>
                {fmtWinRate(phase.bookReply, playerColor) && (
                  <span className="opening-chip-hint">{fmtWinRate(phase.bookReply, playerColor)}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {phase.type === 'player_deviated' && (
        <div className="opening-locked opening-locked--adopted">
          <div className="opening-locked-top">
            <div className="opening-status-dot" style={{ background: '#D5A47D', boxShadow: '0 0 5px #D5A47D55' }} />
            <span className="opening-eco">{phase.opening.eco}</span>
            <span className="opening-locked-name">{phase.opening.name}</span>
            <span className="opening-tag opening-tag--adopted">{t('opening.section.playerDeviated')}</span>
          </div>
          {phase.bookReply && (
            <div className="opening-next-row">
              <span className="opening-next-lbl">{t('opening.section.continuation')}</span>
              <span className="opening-next-move">{fmtMove(phase.bookReply.uci)}</span>
              <span className="opening-chip-name">{phase.bookReply.name}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
