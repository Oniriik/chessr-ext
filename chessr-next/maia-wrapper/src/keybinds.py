"""
Global hotkey listener for auto-move.

Uses pynput for cross-platform keyboard capture.
"""

import logging
import threading

from pynput import keyboard

logger = logging.getLogger("maia-keybinds")


def _parse_combo(combo_str: str) -> tuple[set[str], str | None]:
    """Parse a combo string like 'alt+1' into (modifiers, key)."""
    parts = combo_str.lower().split("+")
    if not parts:
        return set(), None
    key = parts[-1]
    modifiers = set(parts[:-1])
    return modifiers, key


class GlobalKeybindListener:
    """Listens for global hotkeys and triggers auto-move actions."""

    def __init__(self, automove_state):
        self._state = automove_state
        self._state._keybind_listener = self
        self._listener: keyboard.Listener | None = None
        self._lock = threading.Lock()
        self._load_keybinds()

    def _load_keybinds(self):
        """Load keybind config from state."""
        kb = self._state.keybinds
        self._bindings = {}
        for action, combo in kb.items():
            modifiers, key = _parse_combo(combo)
            if key:
                self._bindings[action] = (modifiers, key)

    def reload_keybinds(self):
        """Reload keybinds from state (called when user changes them)."""
        with self._lock:
            self._load_keybinds()
        logger.info("Keybinds reloaded")

    def start(self):
        self._listener = keyboard.Listener(on_press=self._on_press)
        self._listener.daemon = True
        self._listener.start()
        logger.info("Global keybind listener started")

    def stop(self):
        if self._listener:
            self._listener.stop()
            self._listener = None

    def _get_active_modifiers(self, key) -> set[str]:
        """Detect which modifiers are active based on the key event."""
        # pynput doesn't directly tell us modifier state in on_press,
        # but we can track them. For simplicity, check the key itself.
        mods = set()
        if isinstance(key, keyboard.Key):
            if key in (keyboard.Key.alt, keyboard.Key.alt_l, keyboard.Key.alt_r):
                mods.add("alt")
            elif key in (keyboard.Key.ctrl, keyboard.Key.ctrl_l, keyboard.Key.ctrl_r):
                mods.add("ctrl")
            elif key in (keyboard.Key.shift, keyboard.Key.shift_l, keyboard.Key.shift_r):
                mods.add("shift")
            elif key in (keyboard.Key.cmd, keyboard.Key.cmd_l, keyboard.Key.cmd_r):
                mods.add("cmd")
        return mods

    def _on_press(self, key):
        try:
            # Get the character of the pressed key
            if hasattr(key, 'char') and key.char:
                pressed_key = key.char.lower()
            elif hasattr(key, 'name'):
                pressed_key = key.name.lower()
            else:
                return

            with self._lock:
                for action, (modifiers, target_key) in self._bindings.items():
                    if pressed_key != target_key:
                        continue

                    # Check modifiers - for pynput we need to use the controller
                    # to check modifier state. Since pynput's Listener doesn't
                    # directly expose modifier state, we use a simplified approach:
                    # If the binding requires modifiers, check if the key event
                    # includes the vk code for the modified key.
                    # For alt+key combinations, the char is often different.
                    # We handle this by also checking vk codes.
                    if not modifiers:
                        # No modifiers required, direct match
                        self._dispatch(action)
                        return

            # Try matching with modifier detection via vk codes
            # On macOS, alt+1 produces special characters, so we check vk
            if hasattr(key, 'vk') and key.vk is not None:
                vk = key.vk
                # Map vk codes to key names
                vk_map = {}
                # Numbers 0-9: vk 48-57
                for i in range(10):
                    vk_map[48 + i] = str(i)
                # Letters a-z: vk 65-90 (or 0-25 on macOS)
                for i in range(26):
                    vk_map[65 + i] = chr(ord('a') + i)
                    vk_map[i] = chr(ord('a') + i)  # macOS uses 0-25
                # F keys
                for i in range(1, 13):
                    vk_map[111 + i] = f'f{i}'

                actual_key = vk_map.get(vk)
                if actual_key:
                    with self._lock:
                        for action, (modifiers, target_key) in self._bindings.items():
                            if actual_key == target_key and modifiers:
                                # We assume if the char doesn't match but vk does,
                                # a modifier is held (this is the alt+key case)
                                self._dispatch(action)
                                return

        except Exception as e:
            logger.debug(f"Keybind handler error: {e}")

    def _dispatch(self, action: str):
        """Execute the action associated with a keybind."""
        if action == "toggle_auto":
            self._state.toggle_auto_play()
        elif action == "move_1":
            self._state.execute_move(0)
        elif action == "move_2":
            self._state.execute_move(1)
        elif action == "move_3":
            self._state.execute_move(2)
        else:
            logger.warning(f"Unknown keybind action: {action}")
