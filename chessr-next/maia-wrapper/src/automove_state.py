"""
Auto-move shared state.

Thread-safe singleton coordinating overlay, keybinds, and server.
"""

import json
import logging
import random
import threading
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger("maia-automove")

CONFIG_PATH = Path.home() / ".chessr" / "maia_config.json"

DEFAULT_KEYBINDS = {
    "move_1": "alt+1",
    "move_2": "alt+2",
    "move_3": "alt+3",
    "toggle_auto": "alt+s",
}

# Mode presets: each defines timing, movement style, and features
MODE_PRESETS = {
    "ultrabullet": {
        "delay_min": 0.05,
        "delay_max": 0.3,
        "move_speed_min": 0.01,
        "move_speed_max": 0.04,
        "use_drag": False,
        "fake_thinking": False,
        "overshoot_chance": 0.0,
        "mid_pause_chance": 0.0,
        "micro_adjust_chance": 0.0,
    },
    "bullet": {
        "delay_min": 0.3,
        "delay_max": 1.2,
        "move_speed_min": 0.04,
        "move_speed_max": 0.12,
        "use_drag": True,
        "fake_thinking": False,
        "overshoot_chance": 0.1,
        "mid_pause_chance": 0.1,
        "micro_adjust_chance": 0.2,
    },
    "blitz": {
        "delay_min": 0.5,
        "delay_max": 3.0,
        "move_speed_min": 0.08,
        "move_speed_max": 0.22,
        "use_drag": True,
        "fake_thinking": False,
        "overshoot_chance": 0.25,
        "mid_pause_chance": 0.2,
        "micro_adjust_chance": 0.35,
    },
    "rapid": {
        "delay_min": 1.5,
        "delay_max": 6.0,
        "move_speed_min": 0.12,
        "move_speed_max": 0.35,
        "use_drag": True,
        "fake_thinking": True,
        "overshoot_chance": 0.35,
        "mid_pause_chance": 0.3,
        "micro_adjust_chance": 0.45,
    },
}

DEFAULT_AUTOMOVE_CONFIG = {
    "mode": "blitz",
    "keybinds": DEFAULT_KEYBINDS,
    # Advanced overrides (used when mode == "advanced")
    "delay_min": 0.5,
    "delay_max": 3.0,
    "move_speed_min": 0.08,
    "move_speed_max": 0.25,
    "use_drag": True,
    "fake_thinking": False,
    "overshoot_chance": 0.3,
    "mid_pause_chance": 0.25,
    "micro_adjust_chance": 0.4,
}


def _load_automove_config() -> dict:
    try:
        data = json.loads(CONFIG_PATH.read_text())
        return data.get("automove", DEFAULT_AUTOMOVE_CONFIG.copy())
    except Exception:
        return DEFAULT_AUTOMOVE_CONFIG.copy()


def _save_automove_config(automove_cfg: dict):
    try:
        data = json.loads(CONFIG_PATH.read_text())
    except Exception:
        data = {}
    data["automove"] = automove_cfg
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(data))


class AutoMoveState:
    """Thread-safe shared state for auto-move feature."""

    def __init__(self):
        self.lock = threading.Lock()

        # Board state from extension
        self.suggestions: list[dict] = []
        self.board_rect: Optional[dict] = None
        self.is_flipped: bool = False
        self.is_player_turn: bool = False
        self._last_board_state_time: float = 0

        # Load config
        cfg = _load_automove_config()
        self.mode: str = cfg.get("mode", "blitz")
        self.keybinds: dict = cfg.get("keybinds", DEFAULT_KEYBINDS.copy())
        self.auto_play_enabled: bool = False

        # Apply mode or advanced settings
        self._apply_mode_or_config(cfg)

        # Internal
        self._pending_timer: Optional[threading.Timer] = None
        self._fake_think_timer: Optional[threading.Timer] = None
        self._server = None
        self._last_executed_move: Optional[str] = None
        self._user_mouse_active: bool = False

    def _apply_mode_or_config(self, cfg):
        """Apply preset values from mode, or custom values if advanced."""
        if self.mode in MODE_PRESETS:
            p = MODE_PRESETS[self.mode]
            self.delay_min = p["delay_min"]
            self.delay_max = p["delay_max"]
            self.move_speed_min = p["move_speed_min"]
            self.move_speed_max = p["move_speed_max"]
            self.use_drag = p["use_drag"]
            self.fake_thinking = p["fake_thinking"]
            self.overshoot_chance = p["overshoot_chance"]
            self.mid_pause_chance = p["mid_pause_chance"]
            self.micro_adjust_chance = p["micro_adjust_chance"]
        else:
            # Advanced mode — use custom values
            self.delay_min = cfg.get("delay_min", 0.5)
            self.delay_max = cfg.get("delay_max", 3.0)
            self.move_speed_min = cfg.get("move_speed_min", 0.08)
            self.move_speed_max = cfg.get("move_speed_max", 0.25)
            self.use_drag = cfg.get("use_drag", True)
            self.fake_thinking = cfg.get("fake_thinking", False)
            self.overshoot_chance = cfg.get("overshoot_chance", 0.3)
            self.mid_pause_chance = cfg.get("mid_pause_chance", 0.25)
            self.micro_adjust_chance = cfg.get("micro_adjust_chance", 0.4)

    def set_server(self, server):
        self._server = server

    def set_mode(self, mode: str):
        with self.lock:
            self.mode = mode
            logger.info(f"Mode changed to: {mode}")
            if mode in MODE_PRESETS:
                p = MODE_PRESETS[mode]
                self.delay_min = p["delay_min"]
                self.delay_max = p["delay_max"]
                self.move_speed_min = p["move_speed_min"]
                self.move_speed_max = p["move_speed_max"]
                self.use_drag = p["use_drag"]
                self.fake_thinking = p["fake_thinking"]
                self.overshoot_chance = p["overshoot_chance"]
                self.mid_pause_chance = p["mid_pause_chance"]
                self.micro_adjust_chance = p["micro_adjust_chance"]
                if not self.fake_thinking:
                    self._cancel_fake_think()
        self._persist_config()

    def update_board_state(self, msg: dict):
        with self.lock:
            self.suggestions = msg.get("suggestions", [])
            self.board_rect = msg.get("board")
            self.is_flipped = msg.get("isFlipped", False)
            self.is_player_turn = msg.get("isPlayerTurn", False)
            self._last_board_state_time = time.time()

            if not self.is_player_turn:
                self._cancel_timer()
                if self.fake_thinking and self.board_rect:
                    self._schedule_fake_think()
                return

            self._cancel_fake_think()

            if self.auto_play_enabled and self.is_player_turn and self.suggestions:
                if not self._user_mouse_active:
                    if self._pending_timer is None or not self._pending_timer.is_alive():
                        self._schedule_auto_play()

    def execute_move(self, index: int):
        with self.lock:
            if not self.is_player_turn:
                logger.warning("Cannot execute move: not player's turn")
                return
            if not self.suggestions or index >= len(self.suggestions):
                logger.warning(f"Cannot execute move: invalid index {index}")
                return
            if not self.board_rect:
                logger.warning("Cannot execute move: no board coordinates")
                return
            if time.time() - self._last_board_state_time > 10.0:
                logger.warning("Cannot execute move: board state is stale")
                return

            suggestion = self.suggestions[index]
            move_uci = suggestion["move"]
            board = self.board_rect.copy()
            flipped = self.is_flipped
            speed = random.uniform(self.move_speed_min, self.move_speed_max)
            use_drag = self.use_drag
            overshoot = self.overshoot_chance
            mid_pause = self.mid_pause_chance
            micro_adj = self.micro_adjust_chance

        logger.info(f"Executing move: {move_uci} (speed={speed:.3f}s, drag={use_drag})")
        try:
            from .automove import execute_chess_move
            execute_chess_move(move_uci, board, flipped, speed,
                              use_drag=use_drag,
                              overshoot_chance=overshoot,
                              mid_pause_chance=mid_pause,
                              micro_adjust_chance=micro_adj)
            self._last_executed_move = move_uci
            logger.info(f"Move executed: {move_uci}")

            if self._server:
                self._server.broadcast_sync({"type": "move_executed", "move": move_uci})
        except Exception as e:
            logger.error(f"Failed to execute move {move_uci}: {e}")

    def toggle_auto_play(self):
        with self.lock:
            self.auto_play_enabled = not self.auto_play_enabled
            logger.info(f"Auto-play {'enabled' if self.auto_play_enabled else 'disabled'}")
            if not self.auto_play_enabled:
                self._cancel_timer()
                self._cancel_fake_think()
            elif self.is_player_turn and self.suggestions:
                self._schedule_auto_play()

    def set_delay_range(self, min_val: float, max_val: float):
        with self.lock:
            self.delay_min = max(0.01, min_val)
            self.delay_max = max(self.delay_min, max_val)
        self._persist_config()

    def set_move_speed_range(self, min_val: float, max_val: float):
        with self.lock:
            self.move_speed_min = max(0.01, min_val)
            self.move_speed_max = max(self.move_speed_min, max_val)
        self._persist_config()

    def toggle_fake_thinking(self):
        with self.lock:
            self.fake_thinking = not self.fake_thinking
            logger.info(f"Fake thinking {'enabled' if self.fake_thinking else 'disabled'}")
            if not self.fake_thinking:
                self._cancel_fake_think()
        self._persist_config()

    def set_use_drag(self, val: bool):
        with self.lock:
            self.use_drag = val
        self._persist_config()

    def set_overshoot_chance(self, val: float):
        with self.lock:
            self.overshoot_chance = max(0, min(1, val))
        self._persist_config()

    def set_mid_pause_chance(self, val: float):
        with self.lock:
            self.mid_pause_chance = max(0, min(1, val))
        self._persist_config()

    def set_micro_adjust_chance(self, val: float):
        with self.lock:
            self.micro_adjust_chance = max(0, min(1, val))
        self._persist_config()

    def set_keybind(self, action: str, key_combo: str):
        with self.lock:
            self.keybinds[action] = key_combo
        self._persist_config()
        logger.info(f"Keybind updated: {action} = {key_combo}")

    def on_user_mouse_active(self):
        with self.lock:
            if self._user_mouse_active:
                return
            self._user_mouse_active = True
            logger.info("User mouse detected — pausing auto-move")
            self._cancel_timer()
            self._cancel_fake_think()

    def on_user_mouse_idle(self):
        with self.lock:
            if not self._user_mouse_active:
                return
            self._user_mouse_active = False
            logger.info("User mouse idle — resuming auto-move")
            if self.auto_play_enabled and self.is_player_turn and self.suggestions:
                if self._pending_timer is None or not self._pending_timer.is_alive():
                    self._schedule_auto_play()
            if self.fake_thinking and not self.is_player_turn and self.board_rect:
                self._schedule_fake_think()

    def get_overlay_data(self) -> dict:
        with self.lock:
            countdown = None
            if self._pending_timer and self._pending_timer.is_alive():
                countdown = max(0, self._timer_target - time.time())

            return {
                "suggestions": self.suggestions[:3],
                "isPlayerTurn": self.is_player_turn,
                "autoPlayEnabled": self.auto_play_enabled,
                "mode": self.mode,
                "delayMin": self.delay_min,
                "delayMax": self.delay_max,
                "moveSpeedMin": self.move_speed_min,
                "moveSpeedMax": self.move_speed_max,
                "useDrag": self.use_drag,
                "fakeThinking": self.fake_thinking,
                "overshootChance": self.overshoot_chance,
                "midPauseChance": self.mid_pause_chance,
                "microAdjustChance": self.micro_adjust_chance,
                "keybinds": self.keybinds.copy(),
                "countdown": countdown,
                "lastMove": self._last_executed_move,
                "userMouseActive": self._user_mouse_active,
            }

    def _schedule_auto_play(self):
        self._cancel_timer()
        delay = random.uniform(self.delay_min, self.delay_max)
        self._timer_target = time.time() + delay
        self._pending_timer = threading.Timer(delay, self._auto_play_callback)
        self._pending_timer.daemon = True
        self._pending_timer.start()
        logger.info(f"Auto-play scheduled in {delay:.2f}s")

    def _auto_play_callback(self):
        if self._user_mouse_active:
            logger.info("Auto-play skipped: user mouse active")
            return
        self.execute_move(0)

    def _cancel_timer(self):
        if self._pending_timer:
            self._pending_timer.cancel()
            self._pending_timer = None

    def _schedule_fake_think(self):
        self._cancel_fake_think()
        delay = random.uniform(1.0, 4.0)
        self._fake_think_timer = threading.Timer(delay, self._fake_think_callback)
        self._fake_think_timer.daemon = True
        self._fake_think_timer.start()

    def _cancel_fake_think(self):
        if self._fake_think_timer:
            self._fake_think_timer.cancel()
            self._fake_think_timer = None

    def _fake_think_callback(self):
        with self.lock:
            if not self.fake_thinking or self.is_player_turn or not self.board_rect or self._user_mouse_active:
                return
            board = self.board_rect.copy()
            flipped = self.is_flipped
            speed = random.uniform(self.move_speed_min, self.move_speed_max)

        try:
            from .automove import fake_think_click
            fake_think_click(board, flipped, speed)
        except Exception as e:
            logger.debug(f"Fake think click failed: {e}")

        with self.lock:
            if self.fake_thinking and not self.is_player_turn:
                self._schedule_fake_think()

    def _persist_config(self):
        cfg = {
            "mode": self.mode,
            "delay_min": self.delay_min,
            "delay_max": self.delay_max,
            "move_speed_min": self.move_speed_min,
            "move_speed_max": self.move_speed_max,
            "use_drag": self.use_drag,
            "fake_thinking": self.fake_thinking,
            "overshoot_chance": self.overshoot_chance,
            "mid_pause_chance": self.mid_pause_chance,
            "micro_adjust_chance": self.micro_adjust_chance,
            "keybinds": self.keybinds,
        }
        try:
            _save_automove_config(cfg)
        except Exception as e:
            logger.warning(f"Failed to persist automove config: {e}")
