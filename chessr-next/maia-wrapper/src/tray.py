"""
Chessr.io — Desktop GUI application.

Uses pywebview for a native window with the Chessr.io branding.
"""

import asyncio
import base64
import json
import logging
import os
import platform
import sys
import threading
from pathlib import Path

import psutil
import webview
import onnxruntime as ort

from . import __version__
from .engine import MaiaEngine, EngineConfig, _resolve_provider
from .server import MaiaServer, DEFAULT_PORT
from .updater import check_for_update, download_and_open
from .automove_state import AutoMoveState
from .overlay import OVERLAY_HTML, OverlayApi
from .keybinds import GlobalKeybindListener
from .automove import UserMouseMonitor

logger = logging.getLogger("maia-gui")

MAX_LOG_LINES = 200
CONFIG_PATH = Path.home() / ".chessr" / "maia_config.json"


def load_config() -> dict:
    try:
        return json.loads(CONFIG_PATH.read_text())
    except Exception:
        return {"provider": "auto", "threads": 0}


def save_config(config: dict):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(config))


class _BufferHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self._lines: list[str] = []

    def emit(self, record):
        try:
            line = self.format(record)
            self._lines.append(line)
            if len(self._lines) > MAX_LOG_LINES:
                self._lines = self._lines[-MAX_LOG_LINES:]
        except Exception:
            pass

    def get_lines(self) -> list[str]:
        return list(self._lines)


_log_buffer = _BufferHandler()
_log_buffer.setLevel(logging.DEBUG)
_log_buffer.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(message)s", datefmt="%H:%M:%S"))
logging.getLogger().addHandler(_log_buffer)
logging.getLogger().setLevel(logging.DEBUG)


def _get_asset_path(filename: str) -> str:
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS)
    else:
        base = Path(__file__).parent.parent
    return str(base / "assets" / filename)


def _logo_base64() -> str:
    try:
        logo_path = _get_asset_path("logo.png")
        data = Path(logo_path).read_bytes()
        return f"data:image/png;base64,{base64.b64encode(data).decode()}"
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Main Window HTML
# ---------------------------------------------------------------------------

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
    background: linear-gradient(180deg, #0a0a1a 0%, #0d1117 100%);
    color: #fff;
    display: flex;
    flex-direction: column;
    height: 100vh;
    user-select: none;
    -webkit-user-select: none;
    padding-top: 28px;
  }

  /* Header (fixed) */
  .app-header {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 20px 12px;
  }
  .logo { width: 56px; height: 56px; margin-bottom: 6px; }
  .title { font-size: 24px; font-weight: 700; margin-bottom: 1px; }
  .title .accent { color: #38bdf8; }
  .subtitle {
    font-size: 10px; color: #475569; font-weight: 600;
    letter-spacing: 1.5px; text-transform: uppercase;
  }

  /* Scrollable middle */
  .main-scroll {
    flex: 1; overflow-y: auto; overflow-x: hidden;
    padding: 0 16px 12px;
  }
  .main-scroll::-webkit-scrollbar { width: 5px; }
  .main-scroll::-webkit-scrollbar-track { background: transparent; }
  .main-scroll::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
  .main-scroll::-webkit-scrollbar-thumb:hover { background: #334155; }

  /* Cards */
  .card {
    background: #111827;
    border: 1px solid #1e293b;
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 10px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.02);
  }

  /* Section headers */
  .section-label {
    font-size: 9px; font-weight: 600; color: #475569;
    text-transform: uppercase; letter-spacing: 1px;
    margin-bottom: 8px;
  }

  /* Update bar */
  .update-bar {
    display: none; margin-bottom: 10px;
    background: rgba(56,189,248,0.08);
    border: 1px solid rgba(56,189,248,0.2);
    border-radius: 10px; padding: 8px 14px;
    align-items: center; justify-content: space-between; gap: 8px;
  }
  .update-bar.visible { display: flex; }
  .update-text { font-size: 12px; color: #e2e8f0; }
  .update-text strong { color: #38bdf8; }
  .update-btn {
    background: #38bdf8; color: #0a0a1a; border: none; border-radius: 6px;
    padding: 5px 14px; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap;
  }
  .update-btn:hover { background: #7dd3fc; }
  .update-btn.downloading { background: #475569; color: #94a3b8; cursor: wait; }

  /* Server status card */
  .status-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #22c55e; flex-shrink: 0;
    box-shadow: 0 0 6px rgba(34,197,94,0.4);
  }
  .dot.stopped { background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,0.4); }
  .status-text { font-size: 13px; font-weight: 500; }
  .clients { font-size: 11px; color: #64748b; margin-bottom: 8px; }
  .metrics-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  .metric {
    font-size: 10px; font-weight: 500; padding: 3px 7px;
    border-radius: 5px; background: rgba(255,255,255,0.03); border: 1px solid #1e293b;
  }
  .metric.green { color: #22c55e; }
  .metric.orange { color: #f59e0b; }
  .metric.red { color: #ef4444; }
  .btn-sm {
    background: #1e293b; color: #fff; border: 1px solid #334155;
    border-radius: 6px; padding: 5px 16px; font-size: 11px; font-weight: 600;
    cursor: pointer; transition: background 0.15s; font-family: inherit;
  }
  .btn-sm:hover { background: #334155; }

  /* Engine cards */
  .engine-card {
    background: rgba(255,255,255,0.02);
    border: 1px solid #1e293b;
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 6px;
  }
  .engine-card.disabled { opacity: 0.4; pointer-events: none; }
  .engine-header {
    display: flex; align-items: center; justify-content: space-between;
  }
  .engine-info { display: flex; flex-direction: column; gap: 1px; }
  .engine-name { font-size: 13px; font-weight: 600; color: #e2e8f0; }
  .engine-detail { font-size: 10px; color: #64748b; }
  .engine-badge {
    font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
    padding: 2px 8px; border-radius: 4px;
  }
  .engine-badge.active { background: rgba(34,197,94,0.12); color: #22c55e; }
  .engine-badge.soon { background: rgba(100,116,139,0.12); color: #64748b; }

  .engine-settings { margin-top: 10px; display: none; }
  .engine-settings.open { display: block; }
  .engine-toggle {
    background: none; border: none; color: #475569; cursor: pointer;
    font-size: 10px; font-family: inherit; padding: 4px 0; margin-top: 6px;
    transition: color 0.15s; display: flex; align-items: center; gap: 4px;
  }
  .engine-toggle:hover { color: #94a3b8; }
  .engine-toggle .arrow { transition: transform 0.2s; font-size: 8px; }
  .engine-toggle.open .arrow { transform: rotate(90deg); }
  .settings-row {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin-bottom: 8px;
  }
  .settings-label { font-size: 11px; color: #94a3b8; }
  .settings-select {
    background: #0a0a1a; border: 1px solid #334155; border-radius: 5px;
    color: #fff; font-size: 11px; font-family: inherit; padding: 3px 6px;
    outline: none; cursor: pointer;
  }
  .settings-slider-row { display: flex; align-items: center; gap: 8px; }
  .settings-slider { flex: 1; accent-color: #38bdf8; }
  .settings-slider-val { font-size: 11px; color: #38bdf8; font-weight: 600; min-width: 16px; text-align: right; }
  .settings-apply {
    background: linear-gradient(135deg, #3b82f6, #22d3ee);
    color: #fff; border: none; border-radius: 6px; padding: 5px 14px;
    font-size: 11px; font-weight: 600; font-family: inherit; cursor: pointer;
    transition: opacity 0.15s;
  }
  .settings-apply:hover { opacity: 0.9; }
  .settings-apply:disabled { opacity: 0.5; cursor: wait; }
  .settings-status { font-size: 10px; color: #64748b; min-height: 14px; margin-top: 4px; }

  /* CTA Button */
  .cta-btn {
    display: block; width: 100%; padding: 10px;
    background: linear-gradient(135deg, #3b82f6, #22d3ee);
    color: #fff; border: none; border-radius: 10px;
    font-size: 13px; font-weight: 700; font-family: inherit;
    cursor: pointer; transition: opacity 0.15s, transform 0.1s;
    margin-bottom: 10px;
    box-shadow: 0 2px 12px rgba(56,189,248,0.2);
    letter-spacing: 0.3px;
  }
  .cta-btn:hover { opacity: 0.92; }
  .cta-btn:active { transform: scale(0.98); }

  /* Logs */
  .logs {
    width: 100%; min-height: 60px; height: 100px; max-height: 300px; resize: vertical;
    background: #0a0a1a; border: 1px solid #1e293b; border-radius: 8px;
    padding: 6px 8px;
    font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
    font-size: 9px; line-height: 1.5; color: #94a3b8;
    overflow-y: auto; overflow-x: hidden; word-break: break-all;
  }
  .logs .log-line { white-space: pre-wrap; }
  .logs .log-line.warn { color: #f59e0b; }
  .logs .log-line.error { color: #ef4444; }
  .logs .log-line.connect { color: #22c55e; }
  .logs .log-line.disconnect { color: #64748b; }

  /* Footer */
  .footer {
    flex-shrink: 0; text-align: center;
    font-size: 9px; color: #1e293b; padding: 4px 0 6px;
  }

  /* Loading overlay */
  .loading-overlay {
    position: fixed; inset: 0;
    background: linear-gradient(180deg, #0a0a1a 0%, #0d1117 100%);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 100; transition: opacity 0.4s ease;
  }
  .loading-overlay.hidden { opacity: 0; pointer-events: none; }
  .loading-spinner {
    width: 28px; height: 28px;
    border: 2.5px solid #1e293b; border-top-color: #38bdf8;
    border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 14px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-text { font-size: 12px; color: #64748b; font-weight: 500; }
  .progress-container {
    width: 200px; height: 3px; background: #1e293b;
    border-radius: 2px; overflow: hidden; margin-top: 14px; margin-bottom: 6px;
  }
  .progress-bar {
    height: 100%; background: linear-gradient(90deg, #3b82f6, #22d3ee);
    border-radius: 2px; width: 0%; transition: width 0.6s ease;
  }
  .progress-pct { font-size: 10px; color: #475569; font-weight: 500; }
</style>
</head>
<body>
  <!-- Loading Overlay -->
  <div id="loading-overlay" class="loading-overlay">
    <img class="logo" src="{logo_src}" alt="Chessr.io" style="margin-bottom:10px; width:64px; height:64px;">
    <div class="title" style="margin-bottom:2px; font-size:22px;">chessr<span class="accent">.io</span></div>
    <div class="subtitle" style="margin-bottom:20px;">Desktop Assistant</div>
    <div class="loading-spinner"></div>
    <div class="loading-text" id="loading-text">Initializing...</div>
    <div class="progress-container"><div class="progress-bar" id="progress-bar"></div></div>
    <div class="progress-pct" id="progress-pct">0%</div>
  </div>

  <!-- Header -->
  <div class="app-header">
    <img class="logo" src="{logo_src}" alt="Chessr.io">
    <div class="title">chessr<span class="accent">.io</span></div>
    <div class="subtitle">Desktop Assistant</div>
  </div>

  <!-- Scrollable Content -->
  <div class="main-scroll">
    <!-- Update bar -->
    <div id="update-bar" class="update-bar">
      <span class="update-text">Update <strong id="update-ver"></strong> available</span>
      <button id="update-btn" class="update-btn" onclick="doUpdate()">Update</button>
    </div>

    <!-- Server Status -->
    <div class="section-label">Server</div>
    <div class="card">
      <div class="status-row">
        <div id="dot" class="dot"></div>
        <span id="status" class="status-text">Listening on port {port}</span>
      </div>
      <div id="clients" class="clients">0 clients connected</div>
      <div id="metrics-bar" class="metrics-row"></div>
      <button id="btn" class="btn-sm" onclick="pywebview.api.toggle()">Stop Server</button>
    </div>

    <!-- Engines -->
    <div class="section-label">Engines</div>

    <!-- Maia-2 Engine Card -->
    <div class="engine-card" id="maia-card">
      <div class="engine-header">
        <div class="engine-info">
          <span class="engine-name">Maia-2</span>
          <span class="engine-detail" id="engine-detail">Loading...</span>
        </div>
        <span class="engine-badge active" id="engine-badge">Active</span>
      </div>
      <button class="engine-toggle" id="engine-toggle" onclick="toggleEngineSettings()">
        <span class="arrow">&#9654;</span> Settings
      </button>
      <div class="engine-settings" id="engine-settings">
        <div class="settings-row">
          <span class="settings-label">Provider</span>
          <select class="settings-select" id="provider-select">
            <option value="auto">Auto</option>
            <option value="cpu">CPU</option>
          </select>
        </div>
        <div class="settings-row">
          <span class="settings-label">Threads</span>
          <div class="settings-slider-row" style="flex:1; margin-left:8px;">
            <input type="range" class="settings-slider" id="threads-slider" min="1" max="16" value="4"
              oninput="document.getElementById('threads-val').textContent=this.value">
            <span class="settings-slider-val" id="threads-val">4</span>
          </div>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span class="settings-status" id="settings-status"></span>
          <button class="settings-apply" id="settings-apply" onclick="applySettings()">Apply</button>
        </div>
      </div>
    </div>

    <!-- Stockfish placeholder -->
    <div class="engine-card disabled">
      <div class="engine-header">
        <div class="engine-info">
          <span class="engine-name">Stockfish 17</span>
          <span class="engine-detail">UCI engine</span>
        </div>
        <span class="engine-badge soon">Coming Soon</span>
      </div>
    </div>

    <!-- Auto-Move CTA -->
    <button class="cta-btn" onclick="openOverlay()">Open Auto-Move</button>

    <!-- Logs -->
    <div class="section-label">Logs</div>
    <div id="logs" class="logs"></div>
  </div>

  <!-- Footer -->
  <div class="footer">v{version}</div>

  <script>
    var lastLogCount = 0;

    function classForLine(t) {
      if (t.includes('ERROR')||t.includes('error')) return 'error';
      if (t.includes('WARNING')||t.includes('warn')) return 'warn';
      if (t.includes('connected:')) return 'connect';
      if (t.includes('disconnected:')) return 'disconnect';
      return 'info';
    }
    function metricClass(p) { return p>80?'red':p>50?'orange':'green'; }

    var engineSettingsOpen = false;
    function toggleEngineSettings() {
      engineSettingsOpen = !engineSettingsOpen;
      document.getElementById('engine-settings').className = 'engine-settings'+(engineSettingsOpen?' open':'');
      document.getElementById('engine-toggle').className = 'engine-toggle'+(engineSettingsOpen?' open':'');
    }

    async function openOverlay() { await pywebview.api.open_overlay(); }

    async function refresh() {
      try {
        var d = JSON.parse(await pywebview.api.get_status());
        var dot = document.getElementById('dot');
        var status = document.getElementById('status');
        var clients = document.getElementById('clients');
        var btn = document.getElementById('btn');

        if (d.running) {
          dot.className='dot'; status.textContent='Listening on port '+d.port;
          clients.textContent=d.clients+(d.clients===1?' client':' clients')+' connected';
          btn.textContent='Stop Server';
        } else {
          dot.className='dot stopped'; status.textContent='Server stopped';
          clients.textContent=''; btn.textContent='Start Server';
        }

        if (d.metrics) {
          var m=d.metrics;
          document.getElementById('metrics-bar').innerHTML=
            '<span class="metric '+metricClass(m.process_cpu_pct)+'">CPU '+m.process_cpu_pct.toFixed(1)+'%</span>'+
            '<span class="metric '+metricClass(m.system_cpu_pct)+'">Sys '+m.system_cpu_pct.toFixed(1)+'%</span>'+
            '<span class="metric '+metricClass(m.system_ram_pct)+'">RAM '+Math.round(m.process_ram_mb)+' MB</span>';
        }

        if (d.engine_info && d.engine_info.provider) {
          var i=d.engine_info;
          var pLabel={coreml:'CoreML',directml:'DirectML',cpu:'CPU'}[i.provider]||i.provider;
          document.getElementById('engine-detail').textContent=pLabel+' · '+i.threads+' thread'+(i.threads>1?'s':'');
          document.getElementById('settings-status').textContent='Active: '+pLabel+' · '+i.threads+' thread'+(i.threads>1?'s':'');
          document.getElementById('engine-badge').textContent='Active';
          document.getElementById('engine-badge').className='engine-badge active';
        }

        var logsEl=document.getElementById('logs');
        var lines=d.logs||[];
        if(lines.length!==lastLogCount){
          logsEl.innerHTML=lines.map(function(l){
            return '<div class="log-line '+classForLine(l)+'">'+l.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</div>';
          }).join('');
          logsEl.scrollTop=logsEl.scrollHeight;
          lastLogCount=lines.length;
        }
      } catch(e) {}
      setTimeout(refresh, 1500);
    }

    async function checkUpdate() {
      try {
        var raw=await pywebview.api.check_update();
        var u=JSON.parse(raw);
        if(u){ document.getElementById('update-ver').textContent='v'+u.version;
          document.getElementById('update-bar').className='update-bar visible'; }
      } catch(e) {}
    }

    async function doUpdate() {
      var btn=document.getElementById('update-btn');
      btn.textContent='Downloading...'; btn.className='update-btn downloading'; btn.onclick=null;
      try { await pywebview.api.do_update(); } catch(e) { btn.textContent='Failed'; }
    }

    function hideLoading() {
      var o=document.getElementById('loading-overlay');
      o.classList.add('hidden'); setTimeout(function(){o.remove();},500);
    }

    async function waitForEngine() {
      var bar=document.getElementById('progress-bar');
      var pct=document.getElementById('progress-pct');
      var txt=document.getElementById('loading-text');
      while(true){
        try{
          var p=JSON.parse(await pywebview.api.get_loading_progress());
          bar.style.width=p.percent+'%'; pct.textContent=p.percent+'%'; txt.textContent=p.step;
          if(p.ready){ hideLoading(); refresh(); initSettings(); return; }
        }catch(e){}
        await new Promise(r=>setTimeout(r,200));
      }
    }

    async function initSettings() {
      try {
        var c=JSON.parse(await pywebview.api.get_engine_config());
        var sel=document.getElementById('provider-select');
        sel.innerHTML='<option value="auto">Auto</option><option value="cpu">CPU</option>';
        if(c.available.includes('coreml')) sel.innerHTML+='<option value="coreml">CoreML</option>';
        if(c.available.includes('directml')) sel.innerHTML+='<option value="directml">DirectML</option>';
        sel.value=c.provider;
        var sl=document.getElementById('threads-slider');
        sl.max=c.cpu_count; sl.value=c.threads||Math.max(1,Math.floor(c.cpu_count/2));
        document.getElementById('threads-val').textContent=sl.value;
      } catch(e) {}
    }

    async function applySettings() {
      var btn=document.getElementById('settings-apply');
      var st=document.getElementById('settings-status');
      var prov=document.getElementById('provider-select').value;
      var threads=parseInt(document.getElementById('threads-slider').value);
      btn.disabled=true; btn.textContent='Applying...'; st.textContent='';
      try {
        var r=JSON.parse(await pywebview.api.apply_engine_config(prov,threads));
        var pl={coreml:'CoreML',directml:'DirectML',cpu:'CPU'}[r.provider]||r.provider;
        st.textContent='Active: '+pl+' · '+r.threads+' thread'+(r.threads>1?'s':'');
      } catch(e) { st.textContent='Failed'; }
      btn.disabled=false; btn.textContent='Apply';
    }

    window.addEventListener('pywebviewready', function() { waitForEngine(); checkUpdate(); });
  </script>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# API Bridge
# ---------------------------------------------------------------------------

class Api:
    """Python <-> JS bridge exposed to the webview."""

    def __init__(self, app: "MaiaApp"):
        self._app = app
        self._proc = psutil.Process()
        self._proc.cpu_percent()

    def toggle(self):
        self._app.toggle_server()

    def open_overlay(self):
        try:
            self._app._overlay_window.show()
        except Exception:
            pass

    def get_status(self):
        try:
            metrics = {
                "process_cpu_pct": round(self._proc.cpu_percent(interval=None), 1),
                "process_ram_mb": round(self._proc.memory_info().rss / 1024 / 1024, 1),
                "system_cpu_pct": round(psutil.cpu_percent(interval=None), 1),
                "system_ram_pct": round(psutil.virtual_memory().percent, 1),
            }
        except Exception:
            metrics = {}

        engine_info = None
        if self._app.engine:
            engine_info = {
                "provider": self._app.engine.active_provider,
                "threads": self._app.engine.active_threads,
            }

        return json.dumps({
            "running": self._app._is_running,
            "port": self._app.port,
            "clients": self._app.server.client_count if self._app._is_running and self._app.server else 0,
            "logs": _log_buffer.get_lines(),
            "metrics": metrics,
            "engine_info": engine_info,
        })

    def check_update(self):
        return json.dumps(check_for_update())

    def do_update(self):
        result = check_for_update()
        if result:
            logger.info(f"Downloading update v{result['version']}")
            download_and_open(result["download_url"])
            logger.info("Update downloaded — opening installer")

    def is_engine_ready(self):
        return self._app._engine_ready

    def get_loading_progress(self):
        return json.dumps({
            "percent": self._app._loading_percent,
            "step": self._app._loading_step,
            "ready": self._app._engine_ready,
        })

    def get_engine_config(self):
        cfg = self._app._engine_config
        available = ort.get_available_providers()
        available_simple = []
        if "CoreMLExecutionProvider" in available:
            available_simple.append("coreml")
        if "DmlExecutionProvider" in available:
            available_simple.append("directml")
        return json.dumps({
            "provider": cfg.get("provider", "auto"),
            "threads": cfg.get("threads", 0),
            "cpu_count": os.cpu_count() or 2,
            "available": available_simple,
        })

    def apply_engine_config(self, provider: str, threads: int):
        config = EngineConfig(provider=provider, threads=threads)
        if self._app.engine:
            logger.info(f"Reconfiguring engine: provider={provider}, threads={threads}")
            self._app.engine.reconfigure(config)
            logger.info(f"Engine reconfigured: active_provider={self._app.engine.active_provider}, threads={self._app.engine.active_threads}")
        new_cfg = {"provider": provider, "threads": threads}
        self._app._engine_config = new_cfg
        save_config(new_cfg)
        return json.dumps({
            "provider": self._app.engine.active_provider if self._app.engine else provider,
            "threads": self._app.engine.active_threads if self._app.engine else threads,
        })


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

class MaiaApp:
    """Windowed desktop application for Chessr.io."""

    def __init__(self, model_path: str = None, engine: MaiaEngine = None, port: int = DEFAULT_PORT, engine_config: dict = None, automove_state: AutoMoveState = None):
        self.port = port
        self._model_path = model_path
        self.engine = engine
        self._loop: asyncio.AbstractEventLoop | None = None
        self._is_running = False
        self._engine_ready = engine is not None
        self._loading_percent = 0
        self._loading_step = "Initializing..."
        self._engine_config = engine_config or {"provider": "auto", "threads": 0}
        self.server = None
        self.automove_state = automove_state or AutoMoveState()
        self._keybind_listener = None

    def run(self):
        """Launch the GUI (blocking)."""
        html = (HTML_TEMPLATE
            .replace("{logo_src}", _logo_base64())
            .replace("{port}", str(self.port))
            .replace("{version}", __version__)
        )

        api = Api(self)
        window = webview.create_window(
            "Chessr.io",
            html=html,
            width=440,
            height=680,
            resizable=False,
            js_api=api,
        )

        # Auto-move overlay — hidden, opened on demand
        overlay_api = OverlayApi(self.automove_state)
        overlay_window = webview.create_window(
            "Chessr Auto-Move",
            html=OVERLAY_HTML,
            width=290,
            height=440,
            on_top=True,
            frameless=True,
            easy_drag=False,
            transparent=True,
            js_api=overlay_api,
            hidden=True,
        )
        overlay_api._window = overlay_window
        self._overlay_window = overlay_window

        # Start keybind listener
        self._keybind_listener = GlobalKeybindListener(self.automove_state)
        self._keybind_listener.start()

        # Start user mouse monitor
        self._mouse_monitor = UserMouseMonitor(self.automove_state)
        self._mouse_monitor.start()

        # Check accessibility permissions
        threading.Thread(target=self._check_accessibility, daemon=True).start()

        threading.Thread(target=self._load_and_start, daemon=True).start()
        webview.start()

    def _check_accessibility(self):
        from .automove import check_accessibility
        if not check_accessibility():
            logger.warning("Accessibility permission not granted — auto-move mouse control will not work")
            logger.warning("Go to System Settings > Privacy & Security > Accessibility and enable Chessr.io")

    def _set_progress(self, percent: int, step: str):
        self._loading_percent = percent
        self._loading_step = step

    def _load_and_start(self):
        if not self.engine and self._model_path:
            self._set_progress(5, "Detecting hardware...")
            logger.info(f"Loading Maia-2 model from {self._model_path}")
            try:
                config = EngineConfig(
                    provider=self._engine_config.get("provider", "auto"),
                    threads=self._engine_config.get("threads", 0),
                )
                self._set_progress(15, "Loading ONNX model...")
                self.engine = MaiaEngine(self._model_path, config)
                self._set_progress(80, "Model loaded")
                logger.info(f"Model loaded — provider: {self.engine.active_provider}, threads: {self.engine.active_threads}")
            except FileNotFoundError:
                self._set_progress(0, "Model file not found")
                logger.error(f"Model not found at {self._model_path}")
                return
            except Exception as e:
                self._set_progress(0, f"Failed: {e}")
                logger.error(f"Failed to load model: {e}")
                return

        self._set_progress(90, "Starting server...")
        self.server = MaiaServer(self.engine, self.port, automove_state=self.automove_state)

        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self.server.start())
        self._is_running = True
        self._set_progress(100, "Ready")
        self._engine_ready = True
        logger.info(f"Server listening on port {self.port}")
        self._loop.run_forever()

    def toggle_server(self):
        if not self.server or not self._loop:
            return
        if self._is_running:
            future = asyncio.run_coroutine_threadsafe(self.server.stop(), self._loop)
            future.result(timeout=5)
            self._is_running = False
            logger.info("Server stopped by user")
        else:
            future = asyncio.run_coroutine_threadsafe(self.server.start(), self._loop)
            future.result(timeout=5)
            self._is_running = True
            logger.info("Server started by user")


MaiaTray = MaiaApp
