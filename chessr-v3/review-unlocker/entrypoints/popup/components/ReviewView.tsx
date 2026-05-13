import { useEffect, useState } from 'react';
import { useReviewStore } from '../stores/reviewStore';
import { getActiveTabGameId } from '../lib/gameId';
import { APP_REVIEW_URL } from '../lib/config';
import { fetchChesscomGameMeta, type GameMeta } from '../lib/chesscomMeta';
import ReviewSummary from './ReviewSummary';
import GameSummaryCard from './GameSummaryCard';

export default function ReviewView() {
  const { gameId, loading, checking, progress, analysis, headers, error, quota, checkCache, requestReview, reset } = useReviewStore();
  const [tabUrl, setTabUrl] = useState<string | null>(null);
  const [detectedId, setDetectedId] = useState<string | null>(null);
  const [meta, setMeta] = useState<GameMeta | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { gameId: id, url } = await getActiveTabGameId();
      if (cancelled) return;
      setTabUrl(url);
      setDetectedId(id);
      if (!id) { reset(); return; }
      checkCache(id);
      const m = await fetchChesscomGameMeta(id);
      if (!cancelled) setMeta(m);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!headers || !meta) return;
    if (meta.result && meta.white && meta.black) return;
    setMeta({
      ...meta,
      white: meta.white ?? headers.White ?? null,
      black: meta.black ?? headers.Black ?? null,
      result: meta.result ?? headers.Result ?? null,
    });
  }, [headers]);

  if (!detectedId) {
    return (
      <div className="empty-state">
        <div className="empty-icon">♟︎</div>
        <h2>No game detected</h2>
        <p>
          Open a finished chess.com game or its analysis page, then reopen
          the Chessr icon.
        </p>
        {tabUrl && (
          <div className="empty-url">
            <span className="empty-url-label">Current tab</span>
            <code>{shortUrl(tabUrl)}</code>
          </div>
        )}
      </div>
    );
  }

  const idle = !loading && !analysis && !error && !checking;
  const showQuotaBadge = quota && !quota.isPremium && quota.dailyLimit != null && quota.dailyUsage != null;
  const remaining = showQuotaBadge ? Math.max(0, (quota!.dailyLimit ?? 0) - (quota!.dailyUsage ?? 0)) : 0;
  const limitReachedProactively = idle && showQuotaBadge && remaining === 0;

  return (
    <div className="review-screen">
      <GameSummaryCard meta={meta} />

      {checking && (
        <div className="review-loading">
          <div className="review-progress-track"><div className="review-progress-fill" style={{ width: '20%' }} /></div>
          <span className="review-progress-text">Checking cache…</span>
        </div>
      )}

      {loading && (
        <div className="review-loading">
          <div className="review-progress-track"><div className="review-progress-fill" style={{ width: `${progress}%` }} /></div>
          <span className="review-progress-text">Analyzing… {progress}%</span>
        </div>
      )}

      {/* Proactive upgrade CTA — fires from the cache_miss quota snapshot so
       *  the user doesn't waste a click on Unlock review just to get rejected. */}
      {limitReachedProactively && (
        <>
          <span className="review-upsell-text">Upgrade to Premium for unlimited reviews</span>
          <a className="review-cta review-cta--upgrade" href="https://chessr.io/#pricing" target="_blank" rel="noreferrer">
            Upgrade to Premium
          </a>
        </>
      )}

      {idle && !limitReachedProactively && (
        <>
          <button className="review-cta" onClick={() => requestReview(detectedId)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Unlock review
          </button>
          {showQuotaBadge && (
            <span className="review-quota-badge">
              {quota!.dailyUsage}/{quota!.dailyLimit} reviews used today — {remaining} left
            </span>
          )}
        </>
      )}

      {/* Post-click rejection — server returned daily_limit. Mirrors the
       *  proactive CTA above. */}
      {error === 'daily_limit' && (
        <a className="review-cta review-cta--upgrade" href="https://chessr.io/#pricing" target="_blank" rel="noreferrer">
          Upgrade to Premium
        </a>
      )}

      {error && error !== 'daily_limit' && (
        <div className="review-error">{error}</div>
      )}

      {analysis && gameId === detectedId && (
        <>
          <ReviewSummary analysis={analysis} headers={headers} />
          <a className="review-cta review-cta--ghost" href={APP_REVIEW_URL(detectedId)} target="_blank" rel="noreferrer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            See full review
          </a>
        </>
      )}
    </div>
  );
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname;
  } catch {
    return url;
  }
}
