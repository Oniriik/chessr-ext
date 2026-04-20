import { usePlatformStore } from '../stores/platformStore';
import './idle-screen.css';

const platformLabels = {
  chesscom: 'Chess.com',
  lichess: 'Lichess',
};

export default function IdleScreen() {
  const { platform } = usePlatformStore();

  return (
    <div className="idle-screen">
      {platform && (
        <div className="idle-platform">
          <span className="idle-platform-dot" />
          <span>Connected to {platformLabels[platform]}</span>
        </div>
      )}

      <div className="idle-waiting">
        <div className="idle-pulse" />
        <p>Waiting for game...</p>
      </div>

      <p className="idle-hint">Start a game and Chessr will activate automatically</p>
    </div>
  );
}
