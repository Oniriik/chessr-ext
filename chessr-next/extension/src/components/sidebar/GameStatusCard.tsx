import { Gamepad2 } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { useGameStore } from '../../stores/gameStore';

interface PieceIndicatorProps {
  color: 'white' | 'black';
  isActive?: boolean;
  size?: 'sm' | 'md';
}

function PieceIndicator({ color, isActive = false, size = 'md' }: PieceIndicatorProps) {
  const sizeClass = size === 'sm' ? 'tw-w-5 tw-h-5' : 'tw-w-6 tw-h-6';
  const bgColor = color === 'white'
    ? 'tw-bg-white'
    : 'tw-bg-zinc-800';
  const ringClass = isActive
    ? 'tw-ring-2 tw-ring-primary tw-ring-offset-1 tw-ring-offset-background'
    : 'tw-ring-1 tw-ring-border';

  return (
    <div
      className={`${sizeClass} ${bgColor} ${ringClass} tw-rounded-sm tw-transition-all tw-duration-200`}
    />
  );
}

export function GameStatusCard() {
  const { isGameStarted, playerColor, currentTurn } = useGameStore();

  // Waiting state - friendly and minimal
  if (!isGameStarted) {
    return (
      <Card className="tw-bg-muted/30 tw-border-dashed">
        <CardContent className="tw-py-4 tw-px-4">
          <div className="tw-flex tw-items-center tw-justify-center tw-gap-3">
            <div className="tw-p-2 tw-rounded-lg tw-bg-primary/10">
              <Gamepad2 className="tw-w-5 tw-h-5 tw-text-primary" />
            </div>
            <div className="tw-text-left">
              <p className="tw-text-sm tw-font-medium tw-text-foreground">
                Ready to play
              </p>
              <p className="tw-text-xs tw-text-muted-foreground">
                Start a game to see analysis
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Active game state - compact horizontal layout
  const isYourTurn = playerColor === currentTurn;

  return (
    <Card className="tw-bg-muted/50">
      <CardContent className="tw-py-3 tw-px-4">
        <div className="tw-flex tw-items-center tw-justify-between">
          {/* Your color */}
          <div className="tw-flex tw-items-center tw-gap-2.5">
            <PieceIndicator
              color={playerColor || 'white'}
              isActive={isYourTurn}
            />
            <div className="tw-leading-tight">
              <p className="tw-text-xs tw-text-muted-foreground">You play</p>
              <p className="tw-text-sm tw-font-semibold">
                {playerColor === 'white' ? 'White' : 'Black'}
              </p>
            </div>
          </div>

          {/* Turn indicator */}
          <div className={`tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-1.5 tw-rounded-full tw-transition-colors ${
            isYourTurn
              ? 'tw-bg-primary/15 tw-text-primary'
              : 'tw-bg-muted tw-text-muted-foreground'
          }`}>
            <div className={`tw-w-2 tw-h-2 tw-rounded-full ${
              isYourTurn ? 'tw-bg-primary tw-animate-pulse' : 'tw-bg-muted-foreground/50'
            }`} />
            <span className="tw-text-xs tw-font-medium">
              {isYourTurn ? 'Your turn' : 'Opponent\'s turn'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
