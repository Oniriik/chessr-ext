import { useState } from 'react';

const LOGO = '/icons/icon48.png';
const DISCORD_URL = 'https://discord.gg/72j4dUadTu';

const PLATFORMS = [
  {
    name: 'Chess.com',
    url: 'https://www.chess.com/',
    img: '/icons/platforms/chesscom.png',
    bg: '#ffffff',
  },
  {
    name: 'Lichess',
    url: 'https://lichess.org/',
    img: '/icons/platforms/lichess.jpg',
    bg: '#ffffff',
  },
  {
    name: 'World Chess',
    url: 'https://worldchess.com/',
    img: '/icons/platforms/worldchess.webp',
    // Logo is light gray on transparent — needs a dark backdrop.
    bg: '#1a1b26',
  },
];

function open(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

interface CardProps {
  name: string;
  img: string;
  bg: string;
  onClick: () => void;
}

function PlatformCard({ name, img, bg, onClick }: CardProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`Open ${name}`}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 56,
        borderRadius: 12,
        background: bg,
        border: '1px solid #2a2b3d',
        transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease',
        transform: hover ? 'translateY(-1px)' : 'none',
        boxShadow: hover ? '0 4px 18px rgba(59, 130, 246, 0.25)' : 'none',
        borderColor: hover ? 'rgba(59, 130, 246, 0.55)' : '#2a2b3d',
        boxSizing: 'border-box',
      }}
    >
      <img src={img} alt={name} style={{ maxHeight: 32, maxWidth: '85%', objectFit: 'contain' }} />
    </button>
  );
}

function DiscordIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function DiscordButton() {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={() => open(DISCORD_URL)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: '100%',
        height: 40,
        borderRadius: 12,
        background: hover ? 'rgba(88, 101, 242, 0.18)' : 'rgba(255, 255, 255, 0.04)',
        border: `1px solid ${hover ? 'rgba(88, 101, 242, 0.55)' : '#2a2b3d'}`,
        color: hover ? '#fff' : '#a1a1aa',
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: 0.2,
        transition: 'background 160ms ease, color 160ms ease, border-color 160ms ease',
        boxSizing: 'border-box',
      }}
    >
      <DiscordIcon />
      Join our Discord
    </button>
  );
}

export default function Popup() {
  return (
    <div
      style={{
        width: 300,
        padding: '20px 18px 18px',
        background: '#0a0a0f',
        color: '#e4e4e7',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <img src={LOGO} alt="" width={28} height={28} style={{ objectFit: 'contain' }} />
        <span style={{ fontWeight: 700, fontSize: 17, color: '#fff', letterSpacing: 0.2 }}>
          Chessr.io
        </span>
      </div>

      {/* Tagline */}
      <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5, color: '#a1a1aa' }}>
        Chessr loads directly into your game. Open one of these to start:
      </p>

      {/* Platforms */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {PLATFORMS.map((p) => (
          <PlatformCard
            key={p.name}
            name={p.name}
            img={p.img}
            bg={p.bg}
            onClick={() => open(p.url)}
          />
        ))}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: '#2a2b3d', margin: '14px 0', opacity: 0.7 }} />

      {/* Discord */}
      <DiscordButton />
    </div>
  );
}
