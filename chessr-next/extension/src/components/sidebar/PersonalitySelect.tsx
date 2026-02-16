import { Card, CardContent } from '../ui/card';
import {
  useEngineStore,
  PERSONALITIES,
  PERSONALITY_INFO,
  type Personality,
} from '../../stores/engineStore';

export function PersonalitySelect() {
  const { personality, setPersonality } = useEngineStore();
  const info = PERSONALITY_INFO[personality];

  return (
    <Card className="tw-bg-muted/50">
      <CardContent className="tw-p-4 tw-space-y-2">
        <div className="tw-flex tw-items-center tw-justify-between">
          <span className="tw-text-sm tw-font-medium">PERSONALITY</span>
          <select
            value={personality}
            onChange={(e) => setPersonality(e.target.value as Personality)}
            className="tw-w-[140px] tw-h-9 tw-px-3 tw-py-1 tw-text-sm tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-foreground tw-shadow-sm focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring tw-cursor-pointer tw-appearance-none tw-bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m2%204%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] tw-bg-[length:12px] tw-bg-[right_8px_center] tw-bg-no-repeat tw-pr-8"
          >
            {PERSONALITIES.map((p) => (
              <option key={p} value={p}>
                {PERSONALITY_INFO[p].label}
              </option>
            ))}
          </select>
        </div>
        <p className="tw-text-xs tw-text-muted-foreground">{info.description}</p>
      </CardContent>
    </Card>
  );
}
