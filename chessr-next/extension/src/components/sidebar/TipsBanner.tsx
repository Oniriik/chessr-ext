import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, Sparkles, X } from 'lucide-react';
import { useMaintenanceStore } from '../../stores/maintenanceStore';
import { useDiscordStore } from '../../stores/discordStore';
import { useSidebarStore } from '../../stores/sidebarStore';

const STORAGE_KEY = 'chessr-last-tip-id';

interface Tip {
  id: string;
  icon: typeof Cpu;
  titleKey: string;
  subtitleKey: string;
  action: 'settings' | null;
}

const TIPS: Tip[] = [
  {
    id: 'maia-engine',
    icon: Cpu,
    titleKey: 'tipMaiaTitle',
    subtitleKey: 'tipMaiaDesc',
    action: 'settings',
  },
  {
    id: 'move-explanations',
    icon: Sparkles,
    titleKey: 'tipExplanationsTitle',
    subtitleKey: 'tipExplanationsDesc',
    action: null,
  },
];

function getNextTip(): Tip {
  const lastId = localStorage.getItem(STORAGE_KEY);
  if (!lastId) return TIPS[0];
  const lastIndex = TIPS.findIndex((t) => t.id === lastId);
  return TIPS[(lastIndex + 1) % TIPS.length];
}

export function TipsBanner() {
  const scheduledAt = useMaintenanceStore((s) => s.scheduledAt);
  const isLinked = useDiscordStore((s) => s.isLinked);
  const inGuild = useDiscordStore((s) => s.inGuild);
  const [dismissed, setDismissed] = useState(false);
  const [tip] = useState(getNextTip);
  const { t } = useTranslation('banners');

  if (scheduledAt || !isLinked || !inGuild || dismissed) return null;

  const Icon = tip.icon;

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    localStorage.setItem(STORAGE_KEY, tip.id);
    setDismissed(true);
  };

  const handleClick = () => {
    if (tip.action === 'settings') {
      useSidebarStore.getState().setShowSettings(true);
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`tw-flex tw-items-center tw-gap-3 tw-px-3 tw-py-2.5 tw-rounded-lg tw-border tw-bg-violet-500/15 tw-border-violet-500/30 tw-text-violet-200 tw-w-full ${tip.action ? 'tw-cursor-pointer hover:tw-brightness-110' : ''} tw-transition-colors`}
    >
      <div className="tw-w-8 tw-h-8 tw-rounded-full tw-bg-violet-500/20 tw-flex tw-items-center tw-justify-center tw-flex-shrink-0">
        <Icon className="tw-w-4 tw-h-4 tw-text-violet-400" />
      </div>
      <div className="tw-flex-1 tw-min-w-0">
        <p className="tw-text-xs tw-font-semibold">{t(tip.titleKey)}</p>
        <p className="tw-text-[10px] tw-text-violet-300/70 tw-leading-tight">{t(tip.subtitleKey)}</p>
      </div>
      <button
        onClick={handleDismiss}
        className="tw-flex-shrink-0 tw-p-0.5 tw-rounded hover:tw-bg-white/10 tw-transition-colors tw-text-violet-200/60"
      >
        <X className="tw-w-3.5 tw-h-3.5" />
      </button>
    </div>
  );
}
