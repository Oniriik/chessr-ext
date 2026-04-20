import { useRef, useLayoutEffect } from 'react';
import gsap from 'gsap';
import { useSettingsStore } from '../stores/settingsStore';
import './tab-bar.css';

interface TabBarProps<T extends string> {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}

export default function TabBar<T extends string>({ tabs, active, onChange }: TabBarProps<T>) {
  const barRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const ind = indicatorRef.current;
    if (!bar || !ind) return;
    const activeBtn = bar.querySelector<HTMLButtonElement>(`[data-tab="${active}"]`);
    if (!activeBtn) return;

    const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = activeBtn;
    const disable = useSettingsStore.getState().disableAnimations;

    if (firstRender.current || disable) {
      gsap.set(ind, { x: offsetLeft, y: offsetTop, width: offsetWidth, height: offsetHeight, opacity: 1 });
      firstRender.current = false;
    } else {
      gsap.to(ind, {
        x: offsetLeft,
        y: offsetTop,
        width: offsetWidth,
        height: offsetHeight,
        duration: 0.28,
        ease: 'power3.out',
      });
    }
  }, [active, tabs.length]);

  return (
    <div className="tab-bar" ref={barRef}>
      <div className="tab-bar-indicator" ref={indicatorRef} />
      {tabs.map((tab) => (
        <button
          key={tab.id}
          data-tab={tab.id}
          className={`tab-bar-item ${active === tab.id ? 'tab-bar-item--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
