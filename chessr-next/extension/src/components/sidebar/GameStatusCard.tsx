import { RefreshCw } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { useGameStore } from '../../stores/gameStore';
import { detectPlayerColor, detectCurrentTurn } from '../../platforms/chesscom';

interface ColorIndicatorProps {
  color: 'white' | 'black';
}

function ColorIndicator({ color }: ColorIndicatorProps) {
  const bgColor = color === 'white' ? 'tw-bg-white' : 'tw-bg-zinc-900';

  return (
    <div className={`tw-w-6 tw-h-6 ${bgColor} tw-border tw-border-border tw-rounded-sm`} />
  );
}

function colorLabel(color: 'white' | 'black' | null) {
  if (!color) return '?';
  return color === 'white' ? 'White' : 'Black';
}

export function GameStatusCard() {
  const { isGameStarted, playerColor, currentTurn, setPlayerColor, setCurrentTurn } = useGameStore();

  const handleRefreshColor = () => {
    const color = detectPlayerColor();
    setPlayerColor(color);
  };

  const handleRefreshTurn = () => {
    const turn = detectCurrentTurn();
    setCurrentTurn(turn);
  };

  if (!isGameStarted) {
    return (
      <Card className="tw-bg-muted/50 tw-p-4">
        <CardContent>
          <p className="tw-text-sm tw-text-muted-foreground tw-text-center">
            Waiting for game to start...
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="tw-bg-muted/50 tw-p-4">
      <CardContent>
        <div className="tw-grid tw-grid-cols-2 tw-gap-4">
          {/* My Color */}
          <div className="tw-flex tw-flex-col tw-items-center tw-gap-2">
            <span className="tw-text-sm tw-text-muted-foreground">My color</span>
            <div className="tw-flex tw-items-center tw-gap-2">
              {playerColor && <ColorIndicator color={playerColor} />}
              <span className="tw-font-medium">{colorLabel(playerColor)}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefreshColor}
                className="tw-h-6 tw-w-6"
              >
                <RefreshCw className="tw-w-3 tw-h-3" />
              </Button>
            </div>
          </div>

          {/* Turn */}
          <div className="tw-flex tw-flex-col tw-items-center tw-gap-2">
            <span className="tw-text-sm tw-text-muted-foreground">Turn</span>
            <div className="tw-flex tw-items-center tw-gap-2">
              <ColorIndicator color={currentTurn} />
              <span className="tw-font-medium">{colorLabel(currentTurn)}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefreshTurn}
                className="tw-h-6 tw-w-6"
              >
                <RefreshCw className="tw-w-3 tw-h-3" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
