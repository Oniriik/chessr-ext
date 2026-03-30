"""
Auto-move overlay window.

Always-on-top, frameless, draggable floating control panel with Chessr branding.
"""

import json
import logging

logger = logging.getLogger("maia-overlay")

OVERLAY_HTML = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
    background: rgba(10, 10, 26, 0.96);
    color: #fff;
    user-select: none;
    -webkit-user-select: none;
    display: flex;
    flex-direction: column;
    border-radius: 12px;
    border: 1px solid rgba(56,189,248,0.12);
    box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset;
  }

  /* Header */
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 9px 12px;
    background: linear-gradient(180deg, rgba(30,41,59,0.6) 0%, rgba(15,23,42,0.4) 100%);
    border-bottom: 1px solid rgba(255,255,255,0.06);
    cursor: move;
    -webkit-app-region: drag;
    flex-shrink: 0;
  }
  .header-brand {
    display: flex; align-items: center; gap: 6px;
  }
  .brand-name { font-size: 11px; font-weight: 700; color: #e2e8f0; letter-spacing: 0.3px; }
  .brand-name .accent { color: #38bdf8; }
  .header-sep { width: 1px; height: 12px; background: #334155; }
  .header-label { font-size: 10px; font-weight: 600; color: #64748b; letter-spacing: 0.5px; text-transform: uppercase; }
  .header-actions { display: flex; gap: 4px; align-items: center; -webkit-app-region: no-drag; }
  .header-btn {
    background: none; border: none; color: #475569; cursor: pointer;
    font-size: 13px; padding: 2px 4px; line-height: 1; transition: color 0.15s; border-radius: 4px;
  }
  .header-btn:hover { color: #94a3b8; background: rgba(255,255,255,0.05); }
  .header-btn.close:hover { color: #f87171; background: rgba(248,113,113,0.1); }

  /* Scrollable content */
  .scroll-wrap {
    flex: 1; overflow-y: auto; overflow-x: hidden;
    padding: 10px 12px;
    -webkit-app-region: no-drag;
  }
  .scroll-wrap::-webkit-scrollbar { width: 4px; }
  .scroll-wrap::-webkit-scrollbar-track { background: transparent; }
  .scroll-wrap::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
  .scroll-wrap::-webkit-scrollbar-thumb:hover { background: #334155; }

  /* Suggestions */
  .suggestions { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .suggestion {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 8px; background: #0f172a; border: 1px solid #1e293b;
    border-radius: 8px; font-size: 12px; cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .suggestion:hover { border-color: rgba(56,189,248,0.3); background: #1e293b; }
  .suggestion .move { font-weight: 600; color: #e2e8f0; font-family: 'SF Mono', 'Menlo', monospace; }
  .suggestion .confidence { color: #64748b; font-size: 11px; }
  .suggestion .keybind { color: #475569; font-size: 10px; font-family: 'SF Mono', monospace; }

  /* Status */
  .status { font-size: 11px; color: #64748b; text-align: center; margin-bottom: 8px; min-height: 16px; }
  .status.active { color: #22c55e; }
  .status.waiting { color: #f59e0b; }

  /* Controls */
  .controls { display: flex; gap: 6px; margin-bottom: 10px; }
  .toggle-btn {
    flex: 1; padding: 7px; border-radius: 8px; font-size: 11px; font-weight: 600;
    font-family: inherit; cursor: pointer; border: 1px solid; transition: all 0.15s;
  }
  .toggle-btn.start { background: rgba(34,197,94,0.1); border-color: rgba(34,197,94,0.25); color: #22c55e; }
  .toggle-btn.start:hover { background: rgba(34,197,94,0.2); }
  .toggle-btn.stop { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.25); color: #ef4444; }
  .toggle-btn.stop:hover { background: rgba(239,68,68,0.2); }

  /* Mode dropdown */
  .mode-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .mode-label { font-size: 11px; color: #94a3b8; font-weight: 500; }
  .mode-select {
    background: #0f172a; border: 1px solid #1e293b; border-radius: 6px;
    color: #38bdf8; font-size: 11px; font-weight: 600; font-family: inherit;
    padding: 4px 8px; outline: none; cursor: pointer; transition: border-color 0.15s;
  }
  .mode-select:hover { border-color: #334155; }
  .mode-select:focus { border-color: #38bdf8; }

  /* Section titles */
  .section-title {
    font-size: 9px; font-weight: 600; color: #475569; text-transform: uppercase;
    letter-spacing: 0.8px; margin: 10px 0 6px; padding-bottom: 4px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }

  /* Dual range slider */
  .slider-group { margin-bottom: 8px; }
  .slider-label {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 10px; color: #64748b; margin-bottom: 4px;
  }
  .slider-val { color: #38bdf8; font-weight: 600; font-size: 10px; }
  .range-slider { position: relative; height: 22px; width: 100%; }
  .range-slider input[type="range"] {
    position: absolute; left: 0; top: 0; width: 100%; height: 22px; margin: 0;
    pointer-events: none; -webkit-appearance: none; background: transparent; outline: none;
  }
  .range-slider input[type="range"]::-webkit-slider-runnable-track {
    height: 3px; border-radius: 2px; background: transparent;
  }
  .range-slider input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%;
    background: #fff; border: 2px solid #38bdf8; cursor: pointer; pointer-events: auto;
    margin-top: -5.5px; box-shadow: 0 1px 4px rgba(0,0,0,0.4); position: relative; z-index: 2;
  }
  .range-slider input[type="range"]::-webkit-slider-thumb:hover { background: #e0f2fe; transform: scale(1.1); }
  .range-track {
    position: absolute; top: 9.5px; left: 0; right: 0; height: 3px;
    border-radius: 2px; background: #1e293b; pointer-events: none;
  }
  .range-fill {
    position: absolute; top: 9.5px; height: 3px; border-radius: 2px;
    background: linear-gradient(90deg, #3b82f6, #22d3ee); pointer-events: none;
  }
  .range-labels { display: flex; justify-content: space-between; font-size: 9px; color: #334155; margin-top: 1px; }

  /* Single slider */
  .single-slider { margin-bottom: 6px; }
  .single-slider input[type="range"] {
    width: 100%; height: 3px; -webkit-appearance: none; background: #1e293b;
    border-radius: 2px; outline: none;
  }
  .single-slider input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%;
    background: #fff; border: 2px solid #38bdf8; cursor: pointer;
    box-shadow: 0 1px 3px rgba(0,0,0,0.4);
  }

  /* Option row + toggle */
  .option-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 4px 0; font-size: 11px; color: #94a3b8;
  }
  .switch { position: relative; width: 32px; height: 16px; cursor: pointer; flex-shrink: 0; }
  .switch input { display: none; }
  .switch .track {
    position: absolute; inset: 0; background: #334155; border-radius: 8px; transition: background 0.2s;
  }
  .switch .track::after {
    content: ''; position: absolute; left: 2px; top: 2px; width: 12px; height: 12px;
    background: #fff; border-radius: 50%; transition: transform 0.2s;
  }
  .switch input:checked + .track { background: #38bdf8; }
  .switch input:checked + .track::after { transform: translateX(16px); }

  /* Keybinds */
  .keybind-row {
    display: flex; align-items: center; justify-content: space-between; padding: 3px 0; font-size: 11px;
  }
  .keybind-label { color: #64748b; }
  .keybind-input {
    background: #0f172a; border: 1px solid #1e293b; border-radius: 4px; color: #38bdf8;
    font-size: 10px; font-family: 'SF Mono', monospace; padding: 3px 8px; min-width: 65px;
    text-align: center; cursor: pointer; outline: none; transition: border-color 0.15s;
  }
  .keybind-input:focus { border-color: #38bdf8; }
  .keybind-input.recording { border-color: #f59e0b; color: #f59e0b; }

  .no-data { text-align: center; color: #475569; font-size: 11px; padding: 12px 0; }
</style>
</head>
<body>
  <div class="header">
    <div class="header-brand">
      <span class="brand-name">chessr<span class="accent">.io</span></span>
      <span class="header-sep"></span>
      <span class="header-label">Auto-Move</span>
    </div>
    <div class="header-actions">
      <button class="header-btn close" onclick="closeOverlay()" title="Close">&#10005;</button>
    </div>
  </div>

  <div class="scroll-wrap">
    <div id="suggestions" class="suggestions">
      <div class="no-data">Waiting for game...</div>
    </div>
    <div id="status" class="status">Idle</div>
    <div class="controls">
      <button id="toggle-btn" class="toggle-btn start" onclick="toggleAutoPlay()">
        &#9654; Start Auto-Play
      </button>
    </div>

    <div class="mode-row">
      <span class="mode-label">Preset</span>
      <select class="mode-select" id="mode-select" onchange="setMode(this.value)">
        <option value="ultrabullet">Ultra Bullet</option>
        <option value="bullet">Bullet</option>
        <option value="blitz" selected>Blitz</option>
        <option value="rapid">Rapid</option>
        <option value="advanced">Custom</option>
      </select>
    </div>

    <div class="section-title">Timing</div>
    <div class="slider-group">
      <div class="slider-label">
        <span>Time to move</span>
        <span class="slider-val" id="delay-val">0.5s - 3.0s</span>
      </div>
      <div class="range-slider">
        <div class="range-track"></div>
        <div class="range-fill" id="delay-fill"></div>
        <input type="range" id="delay-min" min="0.01" max="10" step="0.01" value="0.5"
          oninput="clampDelay(); updateDelay(); onSettingChanged()">
        <input type="range" id="delay-max" min="0.01" max="10" step="0.01" value="3.0"
          oninput="clampDelay(); updateDelay(); onSettingChanged()">
      </div>
      <div class="range-labels"><span>0</span><span>10s</span></div>
    </div>
    <div class="slider-group">
      <div class="slider-label">
        <span>Move speed</span>
        <span class="slider-val" id="speed-val">0.05s - 0.25s</span>
      </div>
      <div class="range-slider">
        <div class="range-track"></div>
        <div class="range-fill" id="speed-fill"></div>
        <input type="range" id="speed-min" min="0.01" max="1" step="0.01" value="0.05"
          oninput="clampSpeed(); updateSpeed(); onSettingChanged()">
        <input type="range" id="speed-max" min="0.01" max="1" step="0.01" value="0.25"
          oninput="clampSpeed(); updateSpeed(); onSettingChanged()">
      </div>
      <div class="range-labels"><span>0</span><span>1s</span></div>
    </div>

    <div class="section-title">Movement</div>
    <div class="option-row">
      <span>Drag pieces</span>
      <label class="switch">
        <input type="checkbox" id="use-drag" checked onchange="setUseDrag(this.checked); onSettingChanged()">
        <span class="track"></span>
      </label>
    </div>
    <div class="single-slider">
      <div class="slider-label"><span>Overshoot</span><span class="slider-val" id="overshoot-val">30%</span></div>
      <input type="range" id="overshoot" min="0" max="100" step="1" value="30"
        oninput="setOvershoot(this.value); onSettingChanged()">
    </div>
    <div class="single-slider">
      <div class="slider-label"><span>Mid-drag pause</span><span class="slider-val" id="midpause-val">25%</span></div>
      <input type="range" id="midpause" min="0" max="100" step="1" value="25"
        oninput="setMidPause(this.value); onSettingChanged()">
    </div>
    <div class="single-slider">
      <div class="slider-label"><span>Micro-adjust</span><span class="slider-val" id="microadj-val">40%</span></div>
      <input type="range" id="microadj" min="0" max="100" step="1" value="40"
        oninput="setMicroAdj(this.value); onSettingChanged()">
    </div>

    <div class="section-title">Behavior</div>
    <div class="option-row">
      <span>Fake thinking</span>
      <label class="switch">
        <input type="checkbox" id="fake-thinking" onchange="onSettingChanged(); toggleFakeThinking()">
        <span class="track"></span>
      </label>
    </div>

    <div class="section-title">Keybinds</div>
    <div class="keybind-row">
      <span class="keybind-label">Play move 1</span>
      <input class="keybind-input" id="kb-move_1" value="alt+1" readonly onclick="startRecording(this, 'move_1')">
    </div>
    <div class="keybind-row">
      <span class="keybind-label">Play move 2</span>
      <input class="keybind-input" id="kb-move_2" value="alt+2" readonly onclick="startRecording(this, 'move_2')">
    </div>
    <div class="keybind-row">
      <span class="keybind-label">Play move 3</span>
      <input class="keybind-input" id="kb-move_3" value="alt+3" readonly onclick="startRecording(this, 'move_3')">
    </div>
    <div class="keybind-row">
      <span class="keybind-label">Toggle auto-play</span>
      <input class="keybind-input" id="kb-toggle_auto" value="alt+s" readonly onclick="startRecording(this, 'toggle_auto')">
    </div>
  </div>

  <script>
    var recordingEl = null, recordingAction = null, currentMode = 'blitz';

    function closeOverlay() { pywebview.api.close_overlay(); }

    function startRecording(el, action) {
      if (recordingEl) { recordingEl.classList.remove('recording'); recordingEl.value = recordingEl.dataset.original; }
      recordingEl = el; recordingAction = action;
      el.dataset.original = el.value; el.value = 'Press key...'; el.classList.add('recording');
    }

    document.addEventListener('keydown', function(e) {
      if (!recordingEl) return;
      e.preventDefault(); e.stopPropagation();
      var parts = [];
      if (e.altKey) parts.push('alt');
      if (e.ctrlKey) parts.push('ctrl');
      if (e.shiftKey) parts.push('shift');
      if (e.metaKey) parts.push('cmd');
      var key = e.key.toLowerCase();
      if (!['alt','control','shift','meta'].includes(key)) parts.push(key);
      if (parts.length > 0 && !['alt','control','shift','meta'].includes(parts[parts.length-1])) {
        recordingEl.value = parts.join('+');
        recordingEl.classList.remove('recording');
        pywebview.api.set_keybind(recordingAction, parts.join('+'));
        recordingEl = null; recordingAction = null;
      }
    });

    async function setMode(mode) {
      currentMode = mode;
      document.getElementById('mode-select').value = mode;
      await pywebview.api.set_mode(mode);
      window._init = false;
    }
    function onSettingChanged() {
      if (currentMode !== 'advanced') {
        currentMode = 'advanced';
        document.getElementById('mode-select').value = 'advanced';
        pywebview.api.set_mode('advanced');
      }
    }

    function updateFill(a, b, f, mn, mx) {
      var l = ((parseFloat(a.value)-mn)/(mx-mn))*100, r = ((parseFloat(b.value)-mn)/(mx-mn))*100;
      f.style.left = l+'%'; f.style.width = (r-l)+'%';
    }
    function clampDelay() { var a=document.getElementById('delay-min'),b=document.getElementById('delay-max'); if(parseFloat(a.value)>parseFloat(b.value)) a.value=b.value; }
    function clampSpeed() { var a=document.getElementById('speed-min'),b=document.getElementById('speed-max'); if(parseFloat(a.value)>parseFloat(b.value)) a.value=b.value; }
    function updateDelay() {
      var mn=parseFloat(document.getElementById('delay-min').value), mx=parseFloat(document.getElementById('delay-max').value);
      document.getElementById('delay-val').textContent=mn.toFixed(2)+'s - '+mx.toFixed(2)+'s';
      updateFill(document.getElementById('delay-min'),document.getElementById('delay-max'),document.getElementById('delay-fill'),0.01,10);
      pywebview.api.set_delay_range(mn,mx);
    }
    function updateSpeed() {
      var mn=parseFloat(document.getElementById('speed-min').value), mx=parseFloat(document.getElementById('speed-max').value);
      document.getElementById('speed-val').textContent=mn.toFixed(2)+'s - '+mx.toFixed(2)+'s';
      updateFill(document.getElementById('speed-min'),document.getElementById('speed-max'),document.getElementById('speed-fill'),0.01,1);
      pywebview.api.set_move_speed_range(mn,mx);
    }
    function setUseDrag(v) { pywebview.api.set_use_drag(v); }
    function setOvershoot(v) { document.getElementById('overshoot-val').textContent=v+'%'; pywebview.api.set_overshoot_chance(parseInt(v)/100); }
    function setMidPause(v) { document.getElementById('midpause-val').textContent=v+'%'; pywebview.api.set_mid_pause_chance(parseInt(v)/100); }
    function setMicroAdj(v) { document.getElementById('microadj-val').textContent=v+'%'; pywebview.api.set_micro_adjust_chance(parseInt(v)/100); }

    async function toggleFakeThinking() { await pywebview.api.toggle_fake_thinking(); }
    async function toggleAutoPlay() { await pywebview.api.toggle_auto_play(); }
    async function playMove(i) { await pywebview.api.play_move(i); }

    async function refresh() {
      try {
        var d = JSON.parse(await pywebview.api.get_state());
        var sugEl = document.getElementById('suggestions');
        if (d.suggestions && d.suggestions.length > 0) {
          var kb = d.keybinds || {};
          sugEl.innerHTML = d.suggestions.map(function(s,i) {
            var conf = s.confidence ? (s.confidence*100).toFixed(0)+'%' : '';
            var k = '';
            if (i===0 && kb.move_1) k=kb.move_1;
            if (i===1 && kb.move_2) k=kb.move_2;
            if (i===2 && kb.move_3) k=kb.move_3;
            return '<div class="suggestion" onclick="playMove('+i+')">' +
              '<span class="move">'+s.move+'</span>' +
              '<span class="confidence">'+conf+'</span>' +
              '<span class="keybind">'+k+'</span></div>';
          }).join('');
        } else {
          sugEl.innerHTML = '<div class="no-data">'+(d.isPlayerTurn?'Calculating...':'Waiting for game...')+'</div>';
        }

        var st = document.getElementById('status');
        if (d.userMouseActive) { st.textContent='User moving — paused'; st.className='status waiting'; }
        else if (d.autoPlayEnabled) {
          if (d.countdown!=null) { st.textContent='Playing in '+d.countdown.toFixed(1)+'s...'; st.className='status waiting'; }
          else if (d.isPlayerTurn) { st.textContent='Auto-play active'; st.className='status active'; }
          else { st.textContent='Waiting for turn...'; st.className='status'; }
        } else { st.textContent=d.isPlayerTurn?'Your turn':'Idle'; st.className='status'+(d.isPlayerTurn?' active':''); }

        var btn = document.getElementById('toggle-btn');
        if (d.autoPlayEnabled) { btn.className='toggle-btn stop'; btn.innerHTML='&#9632; Stop Auto-Play'; }
        else { btn.className='toggle-btn start'; btn.innerHTML='&#9654; Start Auto-Play'; }

        if (d.mode !== currentMode) { currentMode=d.mode; document.getElementById('mode-select').value=d.mode; }

        if (!window._init) {
          document.getElementById('delay-min').value=d.delayMin;
          document.getElementById('delay-max').value=d.delayMax;
          document.getElementById('speed-min').value=d.moveSpeedMin;
          document.getElementById('speed-max').value=d.moveSpeedMax;
          document.getElementById('delay-val').textContent=d.delayMin.toFixed(2)+'s - '+d.delayMax.toFixed(2)+'s';
          document.getElementById('speed-val').textContent=d.moveSpeedMin.toFixed(2)+'s - '+d.moveSpeedMax.toFixed(2)+'s';
          updateFill(document.getElementById('delay-min'),document.getElementById('delay-max'),document.getElementById('delay-fill'),0.01,10);
          updateFill(document.getElementById('speed-min'),document.getElementById('speed-max'),document.getElementById('speed-fill'),0.01,1);
          document.getElementById('use-drag').checked=d.useDrag;
          document.getElementById('fake-thinking').checked=d.fakeThinking;
          document.getElementById('overshoot').value=Math.round(d.overshootChance*100);
          document.getElementById('overshoot-val').textContent=Math.round(d.overshootChance*100)+'%';
          document.getElementById('midpause').value=Math.round(d.midPauseChance*100);
          document.getElementById('midpause-val').textContent=Math.round(d.midPauseChance*100)+'%';
          document.getElementById('microadj').value=Math.round(d.microAdjustChance*100);
          document.getElementById('microadj-val').textContent=Math.round(d.microAdjustChance*100)+'%';
          if (d.keybinds) { for (var a in d.keybinds) { var el=document.getElementById('kb-'+a); if(el) el.value=d.keybinds[a]; } }
          window._init = true;
        }
      } catch(e) {}
      setTimeout(refresh, 500);
    }
    window.addEventListener('pywebviewready', function() { refresh(); });
  </script>
</body>
</html>
"""


class OverlayApi:
    """Python <-> JS bridge for the overlay window."""

    def __init__(self, automove_state):
        self._state = automove_state
        self._window = None  # Set by tray.py after window creation

    def get_state(self):
        return json.dumps(self._state.get_overlay_data())

    def close_overlay(self):
        if self._window:
            try:
                self._window.hide()
            except Exception:
                pass

    def toggle_auto_play(self):
        self._state.toggle_auto_play()

    def play_move(self, index: int):
        self._state.execute_move(index)

    def set_mode(self, mode: str):
        self._state.set_mode(mode)

    def set_delay_range(self, min_val: float, max_val: float):
        self._state.set_delay_range(min_val, max_val)

    def set_move_speed_range(self, min_val: float, max_val: float):
        self._state.set_move_speed_range(min_val, max_val)

    def set_use_drag(self, val: bool):
        self._state.set_use_drag(val)

    def set_overshoot_chance(self, val: float):
        self._state.set_overshoot_chance(val)

    def set_mid_pause_chance(self, val: float):
        self._state.set_mid_pause_chance(val)

    def set_micro_adjust_chance(self, val: float):
        self._state.set_micro_adjust_chance(val)

    def toggle_fake_thinking(self):
        self._state.toggle_fake_thinking()

    def set_keybind(self, action: str, key_combo: str):
        self._state.set_keybind(action, key_combo)
        if hasattr(self._state, '_keybind_listener') and self._state._keybind_listener:
            self._state._keybind_listener.reload_keybinds()
