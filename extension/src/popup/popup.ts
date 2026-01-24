import { Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/defaults';

class PopupController {
  private settings: Settings = DEFAULT_SETTINGS;

  async init() {
    await this.loadSettings();
    this.renderValues();
    this.setupEventListeners();
    this.listenForUpdates();
  }

  private async loadSettings() {
    const result = await chrome.storage.sync.get('settings');
    this.settings = { ...DEFAULT_SETTINGS, ...result.settings };
  }

  private async saveSettings(partial: Partial<Settings>) {
    this.settings = { ...this.settings, ...partial };
    await chrome.storage.sync.set({ settings: this.settings });
  }

  private renderValues() {
    // Enabled toggle
    const enabledEl = document.getElementById('enabled') as HTMLInputElement;
    enabledEl.checked = this.settings.enabled;

    // ELO slider
    const eloSlider = document.getElementById('elo-slider') as HTMLInputElement;
    const eloValue = document.getElementById('elo-value')!;
    eloSlider.value = this.settings.targetElo.toString();
    eloValue.textContent = this.settings.targetElo.toString();

    // Mode buttons
    const safeModeBtn = document.getElementById('mode-safe')!;
    const aggressiveModeBtn = document.getElementById('mode-aggressive')!;
    safeModeBtn.classList.toggle('active', this.settings.mode === 'safe');
    aggressiveModeBtn.classList.toggle('active', this.settings.mode === 'aggressive');

    // Time/Depth slider
    const timeSlider = document.getElementById('time-slider') as HTMLInputElement;
    const timeValue = document.getElementById('time-value')!;
    const searchModeLabel = document.getElementById('search-mode-label')!;
    const searchTimeBtn = document.getElementById('search-time')!;
    const searchDepthBtn = document.getElementById('search-depth')!;

    if (this.settings.searchMode === 'time') {
      timeSlider.min = '200';
      timeSlider.max = '5000';
      timeSlider.step = '100';
      timeSlider.value = this.settings.moveTime.toString();
      timeValue.textContent = (this.settings.moveTime / 1000).toFixed(1) + 's';
      searchModeLabel.textContent = 'Temps fixe';
      searchTimeBtn.classList.add('active');
      searchDepthBtn.classList.remove('active');
    } else {
      timeSlider.min = '8';
      timeSlider.max = '30';
      timeSlider.step = '1';
      timeSlider.value = this.settings.depth.toString();
      timeValue.textContent = 'D' + this.settings.depth;
      searchModeLabel.textContent = 'Profondeur';
      searchTimeBtn.classList.remove('active');
      searchDepthBtn.classList.add('active');
    }

    // Display toggles
    const showArrows = document.getElementById('show-arrows') as HTMLInputElement;
    const showEvalBar = document.getElementById('show-eval-bar') as HTMLInputElement;
    showArrows.checked = this.settings.showArrows;
    showEvalBar.checked = this.settings.showEvalBar;

    // Arrow colors
    const colorBest = document.getElementById('color-best') as HTMLInputElement;
    const colorSecond = document.getElementById('color-second') as HTMLInputElement;
    const colorOther = document.getElementById('color-other') as HTMLInputElement;
    colorBest.value = this.settings.arrowColors.best;
    colorSecond.value = this.settings.arrowColors.second;
    colorOther.value = this.settings.arrowColors.other;
  }

  private setupEventListeners() {
    // Enabled toggle
    document.getElementById('enabled')?.addEventListener('change', (e) => {
      const enabled = (e.target as HTMLInputElement).checked;
      this.saveSettings({ enabled });
    });

    // ELO slider
    const eloSlider = document.getElementById('elo-slider') as HTMLInputElement;
    const eloValue = document.getElementById('elo-value')!;

    eloSlider.addEventListener('input', () => {
      eloValue.textContent = eloSlider.value;
    });

    eloSlider.addEventListener('change', () => {
      this.saveSettings({ targetElo: parseInt(eloSlider.value) });
    });

    // ELO presets
    document.querySelectorAll('[data-elo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const elo = parseInt((btn as HTMLElement).dataset.elo!);
        eloSlider.value = elo.toString();
        eloValue.textContent = elo.toString();
        this.saveSettings({ targetElo: elo });
      });
    });

    // Mode buttons
    document.getElementById('mode-safe')?.addEventListener('click', () => {
      this.setMode('safe');
    });

    document.getElementById('mode-aggressive')?.addEventListener('click', () => {
      this.setMode('aggressive');
    });

    // Time/Depth slider
    const timeSlider = document.getElementById('time-slider') as HTMLInputElement;
    const timeValue = document.getElementById('time-value')!;

    timeSlider.addEventListener('input', () => {
      if (this.settings.searchMode === 'time') {
        timeValue.textContent = (parseInt(timeSlider.value) / 1000).toFixed(1) + 's';
      } else {
        timeValue.textContent = 'D' + timeSlider.value;
      }
    });

    timeSlider.addEventListener('change', () => {
      if (this.settings.searchMode === 'time') {
        this.saveSettings({ moveTime: parseInt(timeSlider.value) });
      } else {
        this.saveSettings({ depth: parseInt(timeSlider.value) });
      }
    });

    // Search mode buttons
    document.getElementById('search-time')?.addEventListener('click', () => {
      this.setSearchMode('time');
    });

    document.getElementById('search-depth')?.addEventListener('click', () => {
      this.setSearchMode('depth');
    });

    // Display toggles
    document.getElementById('show-arrows')?.addEventListener('change', (e) => {
      this.saveSettings({ showArrows: (e.target as HTMLInputElement).checked });
    });

    document.getElementById('show-eval-bar')?.addEventListener('change', (e) => {
      this.saveSettings({ showEvalBar: (e.target as HTMLInputElement).checked });
    });

    // Opening selector
    const openingSelect = document.getElementById('opening-select') as HTMLSelectElement;
    openingSelect.value = this.settings.selectedOpening;
    openingSelect.addEventListener('change', () => {
      this.saveSettings({ selectedOpening: openingSelect.value });
    });

    // Arrow color pickers
    document.getElementById('color-best')?.addEventListener('change', (e) => {
      const color = (e.target as HTMLInputElement).value;
      this.saveSettings({ arrowColors: { ...this.settings.arrowColors, best: color } });
    });

    document.getElementById('color-second')?.addEventListener('change', (e) => {
      const color = (e.target as HTMLInputElement).value;
      this.saveSettings({ arrowColors: { ...this.settings.arrowColors, second: color } });
    });

    document.getElementById('color-other')?.addEventListener('change', (e) => {
      const color = (e.target as HTMLInputElement).value;
      this.saveSettings({ arrowColors: { ...this.settings.arrowColors, other: color } });
    });
  }

  private setSearchMode(mode: 'depth' | 'time') {
    const timeSlider = document.getElementById('time-slider') as HTMLInputElement;
    const timeValue = document.getElementById('time-value')!;
    const searchModeLabel = document.getElementById('search-mode-label')!;
    const searchTimeBtn = document.getElementById('search-time')!;
    const searchDepthBtn = document.getElementById('search-depth')!;

    if (mode === 'time') {
      timeSlider.min = '200';
      timeSlider.max = '5000';
      timeSlider.step = '100';
      timeSlider.value = this.settings.moveTime.toString();
      timeValue.textContent = (this.settings.moveTime / 1000).toFixed(1) + 's';
      searchModeLabel.textContent = 'Temps fixe';
      searchTimeBtn.classList.add('active');
      searchDepthBtn.classList.remove('active');
    } else {
      timeSlider.min = '8';
      timeSlider.max = '30';
      timeSlider.step = '1';
      timeSlider.value = this.settings.depth.toString();
      timeValue.textContent = 'D' + this.settings.depth;
      searchModeLabel.textContent = 'Profondeur';
      searchTimeBtn.classList.remove('active');
      searchDepthBtn.classList.add('active');
    }

    this.saveSettings({ searchMode: mode });
  }

  private setMode(mode: 'safe' | 'aggressive') {
    const safeModeBtn = document.getElementById('mode-safe')!;
    const aggressiveModeBtn = document.getElementById('mode-aggressive')!;

    safeModeBtn.classList.toggle('active', mode === 'safe');
    aggressiveModeBtn.classList.toggle('active', mode === 'aggressive');

    this.saveSettings({ mode });
  }

  private listenForUpdates() {
    // Listen for analysis updates from content script
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'ANALYSIS_UPDATE') {
        this.updateStats(message.data);
      } else if (message.type === 'CONNECTION_STATUS') {
        this.updateConnectionStatus(message.connected);
      }
    });

    // Request current status from active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }).catch(() => {
          // Tab might not have content script
        });
      }
    });
  }

  private updateStats(data: { evaluation: number; bestMove: string; mate?: number }) {
    const evalValue = document.getElementById('eval-value')!;
    const bestMove = document.getElementById('best-move')!;

    if (data.mate !== undefined) {
      evalValue.textContent = `M${data.mate}`;
      evalValue.className = 'stat-value ' + (data.mate > 0 ? 'positive' : 'negative');
    } else {
      const evalNum = data.evaluation;
      evalValue.textContent = evalNum >= 0 ? `+${evalNum.toFixed(1)}` : evalNum.toFixed(1);
      evalValue.className = 'stat-value ' + (evalNum >= 0 ? 'positive' : 'negative');
    }

    bestMove.textContent = data.bestMove || '--';
  }

  private updateConnectionStatus(connected: boolean) {
    const statusEl = document.getElementById('status')!;
    statusEl.classList.toggle('connected', connected);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupController().init();
});
