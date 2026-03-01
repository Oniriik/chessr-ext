"""
Chessr.io Maia — Desktop GUI application.

Uses pywebview for a native window with the Chessr.io branding.
"""

import asyncio
import base64
import json
import logging
import platform
import sys
import threading
from pathlib import Path

import webview

from . import __version__
from .engine import MaiaEngine
from .server import MaiaServer, DEFAULT_PORT
from .updater import check_for_update, download_and_open
from . import auth as chessr_auth

logger = logging.getLogger("maia-gui")

MAX_LOG_LINES = 200


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
    flex: 1;
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
  /* Auth section */
  .auth-section {
    width: calc(100% - 40px);
    margin-bottom: 14px;
  }
  .auth-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .auth-input {
    background: #111827;
    border: 1px solid #1e293b;
    border-radius: 6px;
    padding: 8px 12px;
    color: #fff;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }
  .auth-input:focus { border-color: #38bdf8; }
  .auth-input::placeholder { color: #475569; }
  .auth-submit {
    background: linear-gradient(135deg, #3b82f6, #22d3ee);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .auth-submit:hover { opacity: 0.9; }
  .auth-submit:disabled { opacity: 0.5; cursor: wait; }
  .auth-error {
    font-size: 11px;
    color: #ef4444;
    min-height: 14px;
  }
  .auth-connected {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .auth-email {
    font-size: 12px;
    color: #94a3b8;
  }
  .plan-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 9999px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .plan-free { background: #1e293b; color: #64748b; }
  .plan-freetrial { background: #1e293b; color: #22d3ee; }
  .plan-premium { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
  .plan-lifetime { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
  .plan-beta { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
  .auth-logout {
    font-size: 11px;
    color: #475569;
    cursor: pointer;
    background: none;
    border: none;
    font-family: inherit;
    text-decoration: underline;
    transition: color 0.15s;
  }
  .auth-logout:hover { color: #94a3b8; }
  .upgrade-bar {
    display: none;
    width: calc(100% - 40px);
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 8px;
    padding: 8px 14px;
    margin-bottom: 12px;
    text-align: center;
  }
  .upgrade-bar.visible { display: block; }
  .upgrade-bar p {
    font-size: 12px;
    color: #f59e0b;
    font-weight: 500;
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
</style>
</head>
<body>
  <div id="loading-overlay" class="loading-overlay">
    <img class="logo" src="{logo_src}" alt="Chessr.io" style="margin-bottom:12px;">
    <div class="title" style="margin-bottom:4px;">chessr<span class="accent">.io</span></div>
    <div class="subtitle" style="margin-bottom:24px;">maia-2 engine</div>
    <div class="loading-spinner"></div>
    <div class="loading-text" id="loading-text">Loading engine...</div>
  </div>
  <img class="logo" src="{logo_src}" alt="Chessr.io">
  <div class="title">chessr<span class="accent">.io</span></div>
  <div class="subtitle">maia-2 engine</div>
  <div id="auth-section" class="auth-section">
    <div id="auth-form" class="auth-form">
      <input id="auth-email" class="auth-input" type="email" placeholder="Email" autocomplete="email">
      <input id="auth-pass" class="auth-input" type="password" placeholder="Password" autocomplete="current-password">
      <button id="auth-submit" class="auth-submit" onclick="doLogin()">Sign in</button>
      <div id="auth-error" class="auth-error"></div>
    </div>
    <div id="auth-connected" class="auth-connected" style="display:none;">
      <span id="auth-email-display" class="auth-email"></span>
      <span id="auth-plan" class="plan-badge plan-free"></span>
      <button class="auth-logout" onclick="doLogout()">Sign out</button>
    </div>
  </div>
  <div id="upgrade-bar" class="upgrade-bar">
    <p>Upgrade your plan to use Maia-2 engine</p>
  </div>
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

        // Sync auth state (picks up token login from extension via WS)
        var authData = data.auth;
        var newEmail = authData ? authData.email : null;
        if (newEmail !== currentAuthEmail) {
          showAuth(authData);
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

    let currentAuthEmail = null;
    let currentAuthPlan = null;

    function showAuth(data) {
      var form = document.getElementById('auth-form');
      var connected = document.getElementById('auth-connected');
      var upgradeBar = document.getElementById('upgrade-bar');
      if (data && data.email) {
        form.style.display = 'none';
        connected.style.display = 'flex';
        document.getElementById('auth-email-display').textContent = data.email;
        var badge = document.getElementById('auth-plan');
        var plan = data.plan || 'free';
        badge.textContent = plan;
        badge.className = 'plan-badge plan-' + plan;
        currentAuthEmail = data.email;
        currentAuthPlan = plan;
        // Show upgrade banner for free users
        upgradeBar.className = plan === 'free' ? 'upgrade-bar visible' : 'upgrade-bar';
      } else {
        form.style.display = 'flex';
        connected.style.display = 'none';
        upgradeBar.className = 'upgrade-bar';
        currentAuthEmail = null;
        currentAuthPlan = null;
      }
    }

    async function doLogin() {
      var email = document.getElementById('auth-email').value.trim();
      var pass = document.getElementById('auth-pass').value;
      var errEl = document.getElementById('auth-error');
      var btn = document.getElementById('auth-submit');
      if (!email || !pass) { errEl.textContent = 'Enter email and password'; return; }
      errEl.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Signing in...';
      try {
        var raw = await pywebview.api.login(email, pass);
        var result = JSON.parse(raw);
        if (result.error) {
          errEl.textContent = result.error;
        } else {
          showAuth(result);
        }
      } catch(e) {
        errEl.textContent = 'Connection error';
      }
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }

    async function doLogout() {
      await pywebview.api.logout();
      showAuth(null);
    }

    // Allow Enter key to submit login
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && document.getElementById('auth-form').style.display !== 'none') {
        doLogin();
      }
    });

    async function restoreAuth() {
      try {
        var raw = await pywebview.api.get_auth();
        var data = JSON.parse(raw);
        if (data) showAuth(data);
      } catch(e) {}
    }

    function hideLoading() {
      var overlay = document.getElementById('loading-overlay');
      overlay.classList.add('hidden');
      setTimeout(function() { overlay.remove(); }, 500);
    }

    async function waitForEngine() {
      while (true) {
        try {
          var ready = await pywebview.api.is_engine_ready();
          if (ready) { hideLoading(); refresh(); return; }
        } catch(e) {}
        await new Promise(r => setTimeout(r, 300));
      }
    }

    window.addEventListener('pywebviewready', function() {
      waitForEngine();
      checkUpdate();
      restoreAuth();
    });
  </script>
</body>
</html>
"""


class Api:
    """Python ↔ JS bridge exposed to the webview."""

    def __init__(self, app: "MaiaApp"):
        self._app = app

    def toggle(self):
        self._app.toggle_server()

    def get_status(self):
        session = self._app._session
        auth = None
        if session:
            auth = {"email": session.get("email", ""), "plan": session.get("plan", "free")}
        return json.dumps({
            "running": self._app._is_running,
            "port": self._app.port,
            "clients": self._app.server.client_count if self._app._is_running and self._app.server else 0,
            "logs": _log_buffer.get_lines(),
            "auth": auth,
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

    def login(self, email, password):
        try:
            session = chessr_auth.login(email, password)
            self._app._session = session
            return json.dumps({"email": session["email"], "plan": session["plan"]})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def logout(self):
        chessr_auth.logout()
        self._app._session = None
        logger.info("User signed out")

    def is_engine_ready(self):
        return self._app._engine_ready

    def get_auth(self):
        session = self._app._session
        if session:
            return json.dumps({"email": session["email"], "plan": session.get("plan", "free")})
        return json.dumps(None)


class MaiaApp:
    """Windowed desktop application for Chessr.io Maia."""

    def __init__(self, model_path: str = None, engine: MaiaEngine = None, port: int = DEFAULT_PORT):
        self.port = port
        self._model_path = model_path
        self.engine = engine
        self._loop: asyncio.AbstractEventLoop | None = None
        self._is_running = False
        self._engine_ready = engine is not None
        self._session = chessr_auth.load_session()
        self.server = None

    def run(self):
        """Launch the GUI (blocking)."""
        # Build HTML (use replace instead of .format to avoid CSS brace conflicts)
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
            height=560,
            resizable=False,
            js_api=api,
        )
        # Start engine loading + server in background after window is created
        threading.Thread(target=self._load_and_start, daemon=True).start()
        webview.start()

    def _load_and_start(self):
        """Load the engine (if needed) then start the WebSocket server."""
        if not self.engine and self._model_path:
            logger.info(f"Loading Maia-2 model from {self._model_path}")
            try:
                self.engine = MaiaEngine(self._model_path)
                logger.info("Model loaded successfully")
            except FileNotFoundError:
                logger.error(f"Model not found at {self._model_path}")
                return
            except Exception as e:
                logger.error(f"Failed to load model: {e}")
                return

        self.server = MaiaServer(
            self.engine, self.port,
            get_session=lambda: self._session,
            set_session=lambda s: setattr(self, '_session', s),
        )
        self._engine_ready = True

        # Start WebSocket server
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self.server.start())
        self._is_running = True
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
