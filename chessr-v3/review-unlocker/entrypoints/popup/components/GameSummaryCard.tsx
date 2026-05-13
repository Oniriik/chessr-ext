import { useEffect, useState } from 'react';
import { fetchChesscomAvatar, type GameMeta } from '../lib/chesscomMeta';

function Avatar({ username, won, lost }: { username: string | null; won?: boolean; lost?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchChesscomAvatar(username).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [username]);

  const wrapCls = `gsc-avatar-wrap${won ? ' gsc-avatar-wrap--winner' : ''}${lost ? ' gsc-avatar-wrap--loser' : ''}`;
  return (
    <div className={wrapCls}>
      <div className="gsc-avatar">
        {url ? <img src={url} alt={username || ''} /> : <span>{(username || '?').charAt(0).toUpperCase()}</span>}
      </div>
    </div>
  );
}

function resultText(result: string | null): { label: string; cls: string } {
  if (result === '1-0') return { label: '1–0', cls: 'gsc-result--win' };
  if (result === '0-1') return { label: '0–1', cls: 'gsc-result--win' };
  if (result === '1/2-1/2') return { label: '½–½', cls: 'gsc-result--draw' };
  return { label: 'vs', cls: 'gsc-result--draw' };
}

export default function GameSummaryCard({ meta }: { meta: GameMeta | null }) {
  const white = meta?.white ?? null;
  const black = meta?.black ?? null;
  const whiteRating = meta?.whiteRating ?? null;
  const blackRating = meta?.blackRating ?? null;
  const result = meta?.result ?? null;

  const whiteWon = result === '1-0';
  const blackWon = result === '0-1';
  const { label, cls } = resultText(result);

  return (
    <div className="gsc">
      <div className="gsc-players">
        <div className="gsc-player">
          <Avatar username={white} won={whiteWon} lost={blackWon} />
          <div className="gsc-info">
            <div className="gsc-name">{white || 'White'}</div>
            {whiteRating && <div className="gsc-rating">{whiteRating}</div>}
          </div>
        </div>
        <div className={`gsc-result ${cls}`}>{label}</div>
        <div className="gsc-player gsc-player--right">
          <Avatar username={black} won={blackWon} lost={whiteWon} />
          <div className="gsc-info">
            <div className="gsc-name">{black || 'Black'}</div>
            {blackRating && <div className="gsc-rating">{blackRating}</div>}
          </div>
        </div>
      </div>

      {(meta?.timeControl || meta?.moveCount != null || meta?.termination) && (
        <div className="gsc-pills">
          {meta?.timeControl && <span className="gsc-pill">{meta.timeControl}</span>}
          {meta?.moveCount != null && <span className="gsc-pill">{meta.moveCount} moves</span>}
          {meta?.termination && <span className="gsc-pill">{meta.termination}</span>}
        </div>
      )}
    </div>
  );
}
