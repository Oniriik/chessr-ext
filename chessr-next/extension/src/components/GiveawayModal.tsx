import { Gift, ExternalLink, X } from 'lucide-react';
import { useDiscordStore } from '../stores/discordStore';
import { Card } from './ui/card';

const DISCORD_INVITE_URL = 'https://discord.gg/chessr';

export function GiveawayModal() {
  const { activeGiveaway, dismissGiveaway } = useDiscordStore();

  if (!activeGiveaway) return null;

  const endsAt = new Date(activeGiveaway.ends_at);
  const now = new Date();
  const daysLeft = Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  return (
    <div className="tw-fixed tw-inset-0 tw-z-[999999] tw-flex tw-items-center tw-justify-center tw-bg-black/60 tw-backdrop-blur-sm">
      <Card className="tw-w-[340px] tw-max-w-[90vw] tw-overflow-hidden tw-shadow-2xl tw-border-indigo-500/30">
        {/* Header */}
        <div className="tw-bg-gradient-to-b tw-from-indigo-500/30 tw-to-transparent tw-p-5 tw-text-center tw-relative">
          <button
            onClick={dismissGiveaway}
            className="tw-absolute tw-top-3 tw-right-3 tw-text-muted-foreground hover:tw-text-foreground tw-transition-colors"
          >
            <X className="tw-w-4 tw-h-4" />
          </button>
          <Gift className="tw-w-10 tw-h-10 tw-mx-auto tw-mb-2 tw-text-indigo-400" />
          <h2 className="tw-text-lg tw-font-bold tw-text-foreground">
            {activeGiveaway.name}
          </h2>
          <p className="tw-text-xs tw-text-muted-foreground tw-mt-1">
            {daysLeft > 0 ? `${daysLeft} day${daysLeft > 1 ? 's' : ''} left` : 'Ends soon!'}
          </p>
        </div>

        {/* Prizes */}
        {activeGiveaway.prizes && (
          <div className="tw-px-5 tw-pb-3">
            <div className="tw-bg-indigo-500/10 tw-border tw-border-indigo-500/20 tw-rounded-lg tw-p-3">
              <p className="tw-text-xs tw-font-semibold tw-text-indigo-400 tw-mb-1.5">Prizes</p>
              <p className="tw-text-sm tw-text-foreground tw-whitespace-pre-wrap tw-leading-relaxed">
                {activeGiveaway.prizes}
              </p>
            </div>
          </div>
        )}

        {/* Description */}
        <div className="tw-px-5 tw-pb-3">
          <p className="tw-text-xs tw-text-muted-foreground tw-leading-relaxed">
            Join our Discord server to participate. Every member gets a ticket — invite friends for bonus tickets!
          </p>
        </div>

        {/* CTA */}
        <div className="tw-px-5 tw-pb-5 tw-space-y-2">
          <a
            href={DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="tw-flex tw-items-center tw-justify-center tw-gap-2 tw-w-full tw-py-2.5 tw-px-4 tw-rounded-lg tw-bg-[#5865F2] hover:tw-bg-[#4752C4] tw-text-white tw-font-semibold tw-text-sm tw-transition-colors tw-no-underline"
          >
            <svg className="tw-w-5 tw-h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
            </svg>
            Join Discord
            <ExternalLink className="tw-w-3.5 tw-h-3.5" />
          </a>
          <button
            onClick={dismissGiveaway}
            className="tw-w-full tw-py-2 tw-text-xs tw-text-muted-foreground hover:tw-text-foreground tw-transition-colors"
          >
            Maybe later
          </button>
        </div>
      </Card>
    </div>
  );
}
