import { useState, useEffect } from 'react';
import './game-summary-card.css';

interface Props {
  whiteName: string | null;
  blackName: string | null;
  whiteRating: string | null;
  blackRating: string | null;
  result: string | null;
  playerColor?: 'white' | 'black' | null;
  timeControl?: string | null;
  moveCount?: number | null;
  termination?: string | null;
}

const avatarCache = new Map<string, string | null>();

function useAvatar(username: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(
    username ? (avatarCache.get(username) ?? null) : null,
  );

  useEffect(() => {
    if (!username) return;
    if (avatarCache.has(username)) { setUrl(avatarCache.get(username)!); return; }
    let cancelled = false;
    fetch(`https://api.chess.com/pub/player/${username.toLowerCase()}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const av = data.avatar || null;
        avatarCache.set(username, av);
        setUrl(av);
      })
      .catch(() => { if (!cancelled) { avatarCache.set(username!, null); setUrl(null); } });
    return () => { cancelled = true; };
  }, [username]);

  return url;
}

function Avatar({ username, won, lost }: { username: string | null; won?: boolean; lost?: boolean }) {
  const url = useAvatar(username);
  const wrapCls = `gsc-avatar-wrap${won ? ' gsc-avatar-wrap--winner' : ''}${lost ? ' gsc-avatar-wrap--loser' : ''}`;

  return (
    <div className={wrapCls}>
      <div className="gsc-avatar">
        {url ? (
          <img src={url} alt={username || ''} />
        ) : (
          <span>{(username || '?').charAt(0).toUpperCase()}</span>
        )}
      </div>
    </div>
  );
}

function resultText(result: string | null, playerColor?: 'white' | 'black' | null): { label: string; cls: string } {
  if (result === '1/2-1/2') return { label: 'Draw', cls: 'gsc-result--draw' };
  const whiteWon = result === '1-0';
  const blackWon = result === '0-1';
  if (!whiteWon && !blackWon) return { label: '—', cls: 'gsc-result--draw' };
  const playerWon = (playerColor === 'white' && whiteWon) || (playerColor === 'black' && blackWon);
  return { label: playerWon ? 'Win' : 'Loss', cls: playerWon ? 'gsc-result--win' : 'gsc-result--loss' };
}

export default function GameSummaryCard({
  whiteName, blackName, whiteRating, blackRating,
  result, playerColor, timeControl, moveCount, termination,
}: Props) {
  const whiteWon = result === '1-0';
  const blackWon = result === '0-1';
  const { label, cls: resultCls } = resultText(result, playerColor);

  return (
    <div className="gsc">
      <div className="gsc-players">
        <div className="gsc-player">
          <Avatar username={whiteName} won={whiteWon} lost={blackWon} />
          <div className="gsc-info">
            <div className="gsc-name">{whiteName || 'White'}</div>
            {whiteRating && <div className="gsc-rating">{whiteRating}</div>}
          </div>
        </div>
        <div className={`gsc-result ${resultCls}`}>{label}</div>
        <div className="gsc-player gsc-player--right">
          <Avatar username={blackName} won={blackWon} lost={whiteWon} />
          <div className="gsc-info">
            <div className="gsc-name">{blackName || 'Black'}</div>
            {blackRating && <div className="gsc-rating">{blackRating}</div>}
          </div>
        </div>
      </div>

      <div className="gsc-pills">
        {timeControl && <span className="gsc-pill">{timeControl}</span>}
        {moveCount != null && <span className="gsc-pill">{moveCount} moves</span>}
        {termination && <span className="gsc-pill">{termination}</span>}
      </div>
    </div>
  );
}
