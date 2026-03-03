"""
Chessr.io Maia — Desktop GUI application.

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
    """Captures log records into a bounded list for the GUI."""

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


# Install the buffer handler on the root logger so all maia-* loggers are captured
_log_buffer = _BufferHandler()
_log_buffer.setLevel(logging.DEBUG)
_log_buffer.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(message)s", datefmt="%H:%M:%S"))
logging.getLogger().addHandler(_log_buffer)
logging.getLogger().setLevel(logging.DEBUG)


def _get_asset_path(filename: str) -> str:
    """Resolve asset path (works both in dev and PyInstaller bundle)."""
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS)
    else:
        base = Path(__file__).parent.parent
    return str(base / "assets" / filename)


def _logo_base64() -> str:
    """Load logo as base64 data URI for embedding in HTML."""
    try:
        logo_path = _get_asset_path("logo.png")
        data = Path(logo_path).read_bytes()
        return f"data:image/png;base64,{base64.b64encode(data).decode()}"
    except Exception:
        return ""


# --- HTML Template ---

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
    background: #0a0a1a;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100vh;
    user-select: none;
    -webkit-user-select: none;
    padding-top: 28px;
    overflow-y: auto;
  }
  .logo { width: 80px; height: 80px; margin-bottom: 8px; }
  .title { font-size: 28px; font-weight: 700; margin-bottom: 2px; }
  .title .accent { color: #38bdf8; }
  .subtitle {
    font-size: 13px;
    color: #64748b;
    font-weight: 500;
    letter-spacing: 1px;
    text-transform: uppercase;
    margin-bottom: 18px;
  }
  .status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: #22c55e;
    transition: background 0.2s;
  }
  .dot.stopped { background: #ef4444; }
  .status-text { font-size: 14px; font-weight: 500; }
  .clients {
    font-size: 12px;
    color: #64748b;
    margin-bottom: 14px;
    min-height: 16px;
  }
  .btn {
    background: #1e293b;
    color: #fff;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 8px 28px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    outline: none;
    margin-bottom: 14px;
  }
  .btn:hover { background: #334155; }
  .btn:active { background: #475569; }
  .logs-label {
    font-size: 11px;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 1px;
    align-self: flex-start;
    margin-left: 20px;
    margin-bottom: 4px;
  }
  .logs {
    width: calc(100% - 40px);
    min-height: 80px;
    height: 110px;
    max-height: 400px;
    resize: vertical;
    background: #111827;
    border: 1px solid #1e293b;
    border-radius: 8px;
    padding: 8px 10px;
    font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
    font-size: 10px;
    line-height: 1.5;
    color: #94a3b8;
    overflow-y: auto;
    overflow-x: hidden;
    word-break: break-all;
    margin-bottom: 8px;
  }
  .logs .log-line { white-space: pre-wrap; }
  .logs .log-line.info { color: #94a3b8; }
  .logs .log-line.warn { color: #f59e0b; }
  .logs .log-line.error { color: #ef4444; }
  .logs .log-line.connect { color: #22c55e; }
  .logs .log-line.disconnect { color: #64748b; }
  .version {
    font-size: 10px;
    color: #334155;
    margin-bottom: 6px;
  }
  .update-bar {
    display: none;
    width: calc(100% - 40px);
    background: #1e3a5f;
    border: 1px solid #38bdf8;
    border-radius: 8px;
    padding: 8px 14px;
    margin-bottom: 12px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .update-bar.visible { display: flex; }
  .update-text { font-size: 12px; color: #e2e8f0; }
  .update-text strong { color: #38bdf8; }
  .update-btn {
    background: #38bdf8;
    color: #0a0a1a;
    border: none;
    border-radius: 6px;
    padding: 5px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .update-btn:hover { background: #7dd3fc; }
  .update-btn.downloading {
    background: #475569;
    color: #94a3b8;
    cursor: wait;
  }
  /* Loading overlay */
  .loading-overlay {
    position: fixed;
    inset: 0;
    background: #0a0a1a;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 100;
    transition: opacity 0.4s ease;
  }
  .loading-overlay.hidden {
    opacity: 0;
    pointer-events: none;
  }
  .loading-spinner {
    width: 32px; height: 32px;
    border: 3px solid #1e293b;
    border-top-color: #38bdf8;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 16px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-text {
    font-size: 13px;
    color: #64748b;
    font-weight: 500;
  }
  .progress-container {
    width: 220px;
    height: 4px;
    background: #1e293b;
    border-radius: 2px;
    overflow: hidden;
    margin-top: 16px;
    margin-bottom: 8px;
  }
  .progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #22d3ee);
    border-radius: 2px;
    width: 0%;
    transition: width 0.6s ease;
  }
  .progress-pct {
    font-size: 11px;
    color: #475569;
    font-weight: 500;
  }
  /* Metrics bar */
  .metrics-bar {
    width: calc(100% - 40px);
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .metric {
    font-size: 11px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 6px;
    background: #111827;
    border: 1px solid #1e293b;
  }
  .metric.green { color: #22c55e; border-color: rgba(34,197,94,0.2); }
  .metric.orange { color: #f59e0b; border-color: rgba(245,158,11,0.2); }
  .metric.red { color: #ef4444; border-color: rgba(239,68,68,0.2); }
  .metric.muted { color: #64748b; }
  /* Engine settings panel */
  .settings-toggle {
    width: calc(100% - 40px);
    background: none;
    border: 1px solid #1e293b;
    border-radius: 8px;
    color: #64748b;
    font-size: 12px;
    font-family: inherit;
    padding: 6px 12px;
    cursor: pointer;
    text-align: left;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: border-color 0.15s, color 0.15s;
  }
  .settings-toggle:hover { border-color: #334155; color: #94a3b8; }
  .settings-toggle .arrow { transition: transform 0.2s; }
  .settings-toggle.open .arrow { transform: rotate(90deg); }
  .settings-panel {
    display: none;
    width: calc(100% - 40px);
    background: #111827;
    border: 1px solid #1e293b;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
    flex-direction: column;
    gap: 10px;
  }
  .settings-panel.open { display: flex; }
  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .settings-label { font-size: 12px; color: #94a3b8; }
  .settings-select {
    background: #0a0a1a;
    border: 1px solid #334155;
    border-radius: 6px;
    color: #fff;
    font-size: 12px;
    font-family: inherit;
    padding: 4px 8px;
    outline: none;
    cursor: pointer;
  }
  .settings-slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .settings-slider {
    flex: 1;
    accent-color: #38bdf8;
  }
  .settings-slider-val {
    font-size: 12px;
    color: #38bdf8;
    font-weight: 600;
    min-width: 20px;
    text-align: right;
  }
  .settings-apply {
    background: linear-gradient(135deg, #3b82f6, #22d3ee);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    align-self: flex-end;
    transition: opacity 0.15s;
  }
  .settings-apply:hover { opacity: 0.9; }
  .settings-apply:disabled { opacity: 0.5; cursor: wait; }
  .settings-status {
    font-size: 11px;
    color: #64748b;
    min-height: 14px;
  }
</style>
</head>
<body>
  <div id="loading-overlay" class="loading-overlay">
    <img class="logo" src="{logo_src}" alt="Chessr.io" style="margin-bottom:12px;">
    <div class="title" style="margin-bottom:4px;">chessr<span class="accent">.io</span></div>
    <div class="subtitle" style="margin-bottom:24px;">maia-2 engine</div>
    <div class="loading-spinner"></div>
    <div class="loading-text" id="loading-text">Initializing...</div>
    <div class="progress-container">
      <div class="progress-bar" id="progress-bar"></div>
    </div>
    <div class="progress-pct" id="progress-pct">0%</div>
  </div>
  <img class="logo" src="{logo_src}" alt="Chessr.io">
  <div class="title">chessr<span class="accent">.io</span></div>
  <div class="subtitle">maia-2 engine</div>
  <div id="update-bar" class="update-bar">
    <span class="update-text">Update <strong id="update-ver"></strong> available</span>
    <button id="update-btn" class="update-btn" onclick="doUpdate()">Update</button>
  </div>
  <div class="status-row">
    <div id="dot" class="dot"></div>
    <span id="status" class="status-text">Listening on port {port}</span>
  </div>
  <div id="clients" class="clients">0 clients connected</div>
  <button id="btn" class="btn" onclick="pywebview.api.toggle()">Stop Server</button>

  <!-- Metrics bar -->
  <div class="metrics-bar" id="metrics-bar"></div>

  <!-- Engine settings -->
  <button class="settings-toggle" id="settings-toggle" onclick="toggleSettings()">
    <span>&#9881; Engine Settings</span>
    <span class="arrow">&#9654;</span>
  </button>
  <div class="settings-panel" id="settings-panel">
    <div class="settings-row">
      <span class="settings-label">Provider</span>
      <select class="settings-select" id="provider-select">
        <option value="auto">Auto (recommended)</option>
        <option value="cpu">CPU only</option>
      </select>
    </div>
    <div class="settings-row">
      <span class="settings-label">CPU Threads</span>
      <div class="settings-slider-row" style="flex:1; margin-left:12px;">
        <input type="range" class="settings-slider" id="threads-slider" min="1" max="16" value="4"
          oninput="document.getElementById('threads-val').textContent = this.value">
        <span class="settings-slider-val" id="threads-val">4</span>
      </div>
    </div>
    <div class="settings-status" id="settings-status"></div>
    <button class="settings-apply" id="settings-apply" onclick="applySettings()">Apply</button>
  </div>

  <div class="logs-label">Logs</div>
  <div id="logs" class="logs"></div>
  <div class="version">v{version}</div>

  <script>
    let lastLogCount = 0;

    function classForLine(text) {
      if (text.includes('ERROR') || text.includes('error')) return 'error';
      if (text.includes('WARNING') || text.includes('warn')) return 'warn';
      if (text.includes('connected:')) return 'connect';
      if (text.includes('disconnected:')) return 'disconnect';
      return 'info';
    }

    function metricClass(pct) {
      if (pct > 80) return 'red';
      if (pct > 50) return 'orange';
      return 'green';
    }

    async function refresh() {
      try {
        const data = JSON.parse(await pywebview.api.get_status());
        const dot = document.getElementById('dot');
        const status = document.getElementById('status');
        const clients = document.getElementById('clients');
        const btn = document.getElementById('btn');

        if (data.running) {
          dot.className = 'dot';
          status.textContent = 'Listening on port ' + data.port;
          clients.textContent = data.clients + (data.clients === 1 ? ' client' : ' clients') + ' connected';
          btn.textContent = 'Stop Server';
        } else {
          dot.className = 'dot stopped';
          status.textContent = 'Server stopped';
          clients.textContent = '';
          btn.textContent = 'Start Server';
        }

        // Metrics bar
        if (data.metrics) {
          var m = data.metrics;
          var bar = document.getElementById('metrics-bar');
          var procCpuClass = metricClass(m.process_cpu_pct);
          var sysCpuClass = metricClass(m.system_cpu_pct);
          var ramClass = metricClass(m.system_ram_pct);
          bar.innerHTML =
            '<span class="metric ' + procCpuClass + '">App CPU: ' + m.process_cpu_pct.toFixed(1) + '%</span>' +
            '<span class="metric ' + sysCpuClass + '">Sys CPU: ' + m.system_cpu_pct.toFixed(1) + '%</span>' +
            '<span class="metric ' + ramClass + '">RAM: ' + Math.round(m.process_ram_mb) + ' MB</span>';
        }

        // Engine info → update settings status line
        if (data.engine_info && data.engine_info.provider) {
          var info = data.engine_info;
          var providerLabel = {coreml: 'CoreML', directml: 'DirectML', cpu: 'CPU'}[info.provider] || info.provider;
          document.getElementById('settings-status').textContent =
            'Active: ' + providerLabel + ' · ' + info.threads + ' thread' + (info.threads > 1 ? 's' : '');
        }

        // Update logs
        const logsEl = document.getElementById('logs');
        const lines = data.logs || [];
        if (lines.length !== lastLogCount) {
          logsEl.innerHTML = lines.map(function(l) {
            var cls = classForLine(l);
            var escaped = l.replace(/&/g,'&amp;').replace(/</g,'&lt;');
            return '<div class="log-line ' + cls + '">' + escaped + '</div>';
          }).join('');
          logsEl.scrollTop = logsEl.scrollHeight;
          lastLogCount = lines.length;
        }
      } catch(e) {}
      setTimeout(refresh, 1500);
    }

    // Check for updates once on load
    async function checkUpdate() {
      try {
        const raw = await pywebview.api.check_update();
        const update = JSON.parse(raw);
        if (update) {
          document.getElementById('update-ver').textContent = 'v' + update.version;
          document.getElementById('update-bar').className = 'update-bar visible';
        }
      } catch(e) {}
    }

    async function doUpdate() {
      var btn = document.getElementById('update-btn');
      btn.textContent = 'Downloading...';
      btn.className = 'update-btn downloading';
      btn.onclick = null;
      try {
        await pywebview.api.do_update();
      } catch(e) {
        btn.textContent = 'Failed';
      }
    }

    function hideLoading() {
      var overlay = document.getElementById('loading-overlay');
      overlay.classList.add('hidden');
      setTimeout(function() { overlay.remove(); }, 500);
    }

    async function waitForEngine() {
      var bar = document.getElementById('progress-bar');
      var pct = document.getElementById('progress-pct');
      var text = document.getElementById('loading-text');
      while (true) {
        try {
          var raw = await pywebview.api.get_loading_progress();
          var p = JSON.parse(raw);
          bar.style.width = p.percent + '%';
          pct.textContent = p.percent + '%';
          text.textContent = p.step;
          if (p.ready) { hideLoading(); refresh(); initSettings(); return; }
        } catch(e) {}
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Settings panel
    function toggleSettings() {
      var toggle = document.getElementById('settings-toggle');
      var panel = document.getElementById('settings-panel');
      toggle.classList.toggle('open');
      panel.classList.toggle('open');
    }

    async function initSettings() {
      try {
        var raw = await pywebview.api.get_engine_config();
        var cfg = JSON.parse(raw);

        // Populate provider options based on available providers
        var sel = document.getElementById('provider-select');
        sel.innerHTML = '<option value="auto">Auto (recommended)</option><option value="cpu">CPU only</option>';
        if (cfg.available.includes('coreml')) {
          sel.innerHTML += '<option value="coreml">CoreML (Apple GPU)</option>';
        }
        if (cfg.available.includes('directml')) {
          sel.innerHTML += '<option value="directml">DirectML (GPU)</option>';
        }
        sel.value = cfg.provider;

        // Thread slider
        var slider = document.getElementById('threads-slider');
        slider.max = cfg.cpu_count;
        slider.value = cfg.threads || Math.max(1, Math.floor(cfg.cpu_count / 2));
        document.getElementById('threads-val').textContent = slider.value;
      } catch(e) {}
    }

    async function applySettings() {
      var btn = document.getElementById('settings-apply');
      var status = document.getElementById('settings-status');
      var provider = document.getElementById('provider-select').value;
      var threads = parseInt(document.getElementById('threads-slider').value);
      btn.disabled = true;
      btn.textContent = 'Applying...';
      status.textContent = '';
      try {
        var raw = await pywebview.api.apply_engine_config(provider, threads);
        var result = JSON.parse(raw);
        var providerLabel = {coreml: 'CoreML', directml: 'DirectML', cpu: 'CPU'}[result.provider] || result.provider;
        status.textContent = 'Active: ' + providerLabel + ' · ' + result.threads + ' thread' + (result.threads > 1 ? 's' : '');
      } catch(e) {
        status.textContent = 'Failed to apply settings';
      }
      btn.disabled = false;
      btn.textContent = 'Apply';
    }

    window.addEventListener('pywebviewready', function() {
      waitForEngine();
      checkUpdate();
    });
  </script>
</body>
</html>
"""


class Api:
    """Python ↔ JS bridge exposed to the webview."""

    def __init__(self, app: "MaiaApp"):
        self._app = app
        self._proc = psutil.Process()
        self._proc.cpu_percent()  # First call initializes the counter

    def toggle(self):
        self._app.toggle_server()

    def get_status(self):
        # Metrics
        try:
            metrics = {
                "process_cpu_pct": round(self._proc.cpu_percent(interval=None), 1),
                "process_ram_mb": round(self._proc.memory_info().rss / 1024 / 1024, 1),
                "system_cpu_pct": round(psutil.cpu_percent(interval=None), 1),
                "system_ram_pct": round(psutil.virtual_memory().percent, 1),
            }
        except Exception:
            metrics = {}

        # Engine info
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
        result = check_for_update()
        return json.dumps(result)

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
        # Persist
        new_cfg = {"provider": provider, "threads": threads}
        self._app._engine_config = new_cfg
        save_config(new_cfg)
        return json.dumps({
            "provider": self._app.engine.active_provider if self._app.engine else provider,
            "threads": self._app.engine.active_threads if self._app.engine else threads,
        })


class MaiaApp:
    """Windowed desktop application for Chessr.io Maia."""

    def __init__(self, model_path: str = None, engine: MaiaEngine = None, port: int = DEFAULT_PORT, engine_config: dict = None):
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
            width=420,
            height=620,
            resizable=False,
            js_api=api,
        )
        threading.Thread(target=self._load_and_start, daemon=True).start()
        webview.start()

    def _set_progress(self, percent: int, step: str):
        self._loading_percent = percent
        self._loading_step = step

    def _load_and_start(self):
        """Load the engine (if needed) then start the WebSocket server."""
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
        self.server = MaiaServer(self.engine, self.port)

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


# Keep backward compat alias
MaiaTray = MaiaApp
