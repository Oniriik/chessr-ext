"""
Cross-platform mouse automation for auto-move.

Uses Quartz (macOS) with human-like movement: smooth bezier curves,
overshoot, micro-corrections, variable speed, and mid-drag pauses.
"""

import logging
import math
import platform
import random
import subprocess
import time

logger = logging.getLogger("maia-automove")

IS_MACOS = platform.system() == "Darwin"

if IS_MACOS:
    import Quartz

# Flag to distinguish our synthetic events from real user input
_is_automating = False


def check_accessibility() -> bool:
    if not IS_MACOS:
        return True
    try:
        result = subprocess.run(
            ["osascript", "-e", 'tell application "System Events" to return name of first process'],
            capture_output=True, timeout=5,
        )
        return result.returncode == 0
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Smooth human-like path generation
# ---------------------------------------------------------------------------

def _bezier_point(t, p0, p1, p2, p3):
    """Cubic bezier interpolation."""
    u = 1 - t
    return (u**3 * p0 + 3 * u**2 * t * p1 + 3 * u * t**2 * p2 + t**3 * p3)


def _generate_path(sx, sy, ex, ey, num_points=60):
    """Generate a smooth curved path from start to end using cubic bezier with random control points."""
    dist = math.hypot(ex - sx, ey - sy)
    if dist < 3:
        return [(ex, ey)]

    # Control points: offset perpendicular to the line for a natural arc
    dx, dy = ex - sx, ey - sy
    # Perpendicular direction
    perp_x, perp_y = -dy, dx
    perp_len = math.hypot(perp_x, perp_y)
    if perp_len > 0:
        perp_x /= perp_len
        perp_y /= perp_len

    # Random arc: slight curve to one side (like a real hand movement)
    arc_strength = dist * random.uniform(0.05, 0.2) * random.choice([-1, 1])

    # Control point 1: ~30% along the line, offset by arc
    cp1x = sx + dx * 0.3 + perp_x * arc_strength + random.uniform(-3, 3)
    cp1y = sy + dy * 0.3 + perp_y * arc_strength + random.uniform(-3, 3)

    # Control point 2: ~70% along the line, offset by smaller arc
    arc2 = arc_strength * random.uniform(0.3, 0.8)
    cp2x = sx + dx * 0.7 + perp_x * arc2 + random.uniform(-2, 2)
    cp2y = sy + dy * 0.7 + perp_y * arc2 + random.uniform(-2, 2)

    points = []
    for i in range(1, num_points + 1):
        t = i / num_points
        x = _bezier_point(t, sx, cp1x, cp2x, ex)
        y = _bezier_point(t, sy, cp1y, cp2y, ey)
        # Tiny noise (sub-pixel, barely visible — just breaks perfect smoothness)
        x += random.gauss(0, 0.5)
        y += random.gauss(0, 0.5)
        points.append((round(x), round(y)))

    return points


def _overshoot_path(ex, ey, square_size):
    """Generate overshoot: go past the target then come back with micro-corrections."""
    # Overshoot distance: 5-15% of square size
    overshoot_dist = square_size * random.uniform(0.05, 0.15)
    angle = random.uniform(0, 2 * math.pi)
    overshoot_x = ex + math.cos(angle) * overshoot_dist
    overshoot_y = ey + math.sin(angle) * overshoot_dist

    # Path from overshoot back to target (short, precise)
    points = []
    steps = random.randint(6, 12)
    for i in range(1, steps + 1):
        t = i / steps
        # Ease-out: fast start, slow finish
        t = 1 - (1 - t) ** 2
        x = overshoot_x + (ex - overshoot_x) * t + random.gauss(0, 0.3)
        y = overshoot_y + (ey - overshoot_y) * t + random.gauss(0, 0.3)
        points.append((round(x), round(y)))

    return overshoot_x, overshoot_y, points


# ---------------------------------------------------------------------------
# Quartz event helpers
# ---------------------------------------------------------------------------

def _post_move(x, y):
    event = Quartz.CGEventCreateMouseEvent(
        None, Quartz.kCGEventMouseMoved, (x, y), Quartz.kCGMouseButtonLeft)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)


def _post_drag(x, y):
    event = Quartz.CGEventCreateMouseEvent(
        None, Quartz.kCGEventLeftMouseDragged, (x, y), Quartz.kCGMouseButtonLeft)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)


def _post_down(x, y):
    event = Quartz.CGEventCreateMouseEvent(
        None, Quartz.kCGEventLeftMouseDown, (x, y), Quartz.kCGMouseButtonLeft)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)


def _post_up(x, y):
    event = Quartz.CGEventCreateMouseEvent(
        None, Quartz.kCGEventLeftMouseUp, (x, y), Quartz.kCGMouseButtonLeft)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)


def _get_cursor_pos():
    event = Quartz.CGEventCreate(None)
    pos = Quartz.CGEventGetLocation(event)
    return pos.x, pos.y


# ---------------------------------------------------------------------------
# Movement execution with human-like timing
# ---------------------------------------------------------------------------

def _ease_in_out(t):
    """Smooth ease-in-out curve."""
    return t * t * (3 - 2 * t)


def _play_points(points, duration, post_fn):
    """Animate through a list of points with human-like timing."""
    n = len(points)
    if n == 0:
        return

    base_wait = duration / n

    for i, (px, py) in enumerate(points):
        post_fn(px, py)

        t = i / max(n - 1, 1)
        # Variable speed: slow at start and end, fast in middle
        speed_factor = 0.4 + 1.2 * _ease_in_out(t) if t < 0.5 else 0.4 + 1.2 * _ease_in_out(1 - t)
        wait = base_wait / max(speed_factor, 0.3)
        # Small timing variation
        wait *= random.uniform(0.85, 1.15)
        time.sleep(max(0.001, wait))


def _human_move(start_x, start_y, end_x, end_y, duration=0.15, dragging=False, mid_pause_chance=0.25):
    """Move mouse along a smooth curved path."""
    dist = math.hypot(end_x - start_x, end_y - start_y)
    num_points = max(15, min(80, int(dist * 0.3)))

    points = _generate_path(start_x, start_y, end_x, end_y, num_points)
    if not points:
        return

    post_fn = _post_drag if dragging else _post_move

    # Occasionally pause mid-movement (hesitation, like reconsidering)
    if dragging and duration > 0.1 and random.random() < mid_pause_chance:
        pause_idx = random.randint(len(points) // 3, 2 * len(points) // 3)
        first_half = points[:pause_idx]
        second_half = points[pause_idx:]
        _play_points(first_half, duration * 0.45, post_fn)
        time.sleep(random.uniform(0.04, 0.15))
        _play_points(second_half, duration * 0.45, post_fn)
    else:
        _play_points(points, duration, post_fn)


def _mouse_click(x: int, y: int):
    if IS_MACOS:
        _post_down(x, y)
        time.sleep(random.uniform(0.01, 0.03))
        _post_up(x, y)
    else:
        import pyautogui
        pyautogui.click(x, y)


# ---------------------------------------------------------------------------
# Board coordinate helpers
# ---------------------------------------------------------------------------

def _square_to_file_rank(square: str) -> tuple[int, int]:
    file_idx = ord(square[0]) - ord('a')
    rank_idx = int(square[1]) - 1
    return file_idx, rank_idx


def _square_to_screen(file_idx: int, rank_idx: int, board_rect: dict, is_flipped: bool) -> tuple[int, int]:
    """Random point within the square (avoids edges)."""
    square_size = board_rect["width"] / 8

    if is_flipped:
        base_x = board_rect["x"] + (7 - file_idx) * square_size
        base_y = board_rect["y"] + rank_idx * square_size
    else:
        base_x = board_rect["x"] + file_idx * square_size
        base_y = board_rect["y"] + (7 - rank_idx) * square_size

    margin = square_size * 0.15
    x = base_x + margin + random.random() * (square_size - 2 * margin)
    y = base_y + margin + random.random() * (square_size - 2 * margin)

    return int(x), int(y)


# ---------------------------------------------------------------------------
# Main move execution
# ---------------------------------------------------------------------------

def execute_chess_move(move_uci: str, board_rect: dict, is_flipped: bool, move_speed: float = 0.15,
                       use_drag: bool = True, overshoot_chance: float = 0.3,
                       mid_pause_chance: float = 0.25, micro_adjust_chance: float = 0.4):
    if board_rect["width"] < 100 or board_rect["height"] < 100:
        raise ValueError(f"Board rect too small: {board_rect['width']}x{board_rect['height']}")
    if board_rect["x"] < 0 or board_rect["y"] < 0:
        raise ValueError(f"Board rect has negative coordinates: ({board_rect['x']}, {board_rect['y']})")

    src_square = move_uci[0:2]
    dst_square = move_uci[2:4]

    src_file, src_rank = _square_to_file_rank(src_square)
    dst_file, dst_rank = _square_to_file_rank(dst_square)

    src_x, src_y = _square_to_screen(src_file, src_rank, board_rect, is_flipped)
    dst_x, dst_y = _square_to_screen(dst_file, dst_rank, board_rect, is_flipped)
    square_size = board_rect["width"] / 8

    logger.info(f"Move {move_uci}: ({src_x},{src_y}) -> ({dst_x},{dst_y}) drag={use_drag}")

    global _is_automating
    _is_automating = True
    try:
        if use_drag:
            _do_drag_move(src_x, src_y, dst_x, dst_y, move_speed, square_size,
                          overshoot_chance, mid_pause_chance, micro_adjust_chance)
        else:
            _do_click_move(src_x, src_y, dst_x, dst_y, move_speed)
    finally:
        _is_automating = False


def _do_click_move(src_x, src_y, dst_x, dst_y, move_speed):
    """Ultra-fast click-click mode: click source, click destination."""
    if IS_MACOS:
        cur_x, cur_y = _get_cursor_pos()
        # Fast move to source
        _human_move(cur_x, cur_y, src_x, src_y, duration=move_speed * 0.3)
        _mouse_click(src_x, src_y)

        # Tiny pause
        time.sleep(random.uniform(0.01, 0.04))

        # Fast move to destination
        _human_move(src_x, src_y, dst_x, dst_y, duration=move_speed * 0.5)
        _mouse_click(dst_x, dst_y)
    else:
        import pyautogui
        pyautogui.click(src_x, src_y)
        time.sleep(0.02)
        pyautogui.click(dst_x, dst_y)


def _do_drag_move(src_x, src_y, dst_x, dst_y, move_speed, square_size,
                   overshoot_chance, mid_pause_chance, micro_adjust_chance):
    """Human-like drag mode with optional overshoot, pauses, and micro-adjustments."""
    if IS_MACOS:
        # 1. Move to source square
        cur_x, cur_y = _get_cursor_pos()
        _human_move(cur_x, cur_y, src_x, src_y, duration=move_speed * 0.4)

        # 2. Hesitation before grabbing
        time.sleep(random.uniform(0.02, 0.08))

        # 3. Mouse down — grab the piece
        _post_down(src_x, src_y)
        time.sleep(random.uniform(0.03, 0.1))

        # 4. Drag to destination
        if random.random() < overshoot_chance:
            overshoot_x, overshoot_y, correction = _overshoot_path(dst_x, dst_y, square_size)
            _human_move(src_x, src_y, overshoot_x, overshoot_y,
                        duration=move_speed * 0.8, dragging=True,
                        mid_pause_chance=mid_pause_chance)
            _play_points(correction, move_speed * 0.2, _post_drag)
        else:
            _human_move(src_x, src_y, dst_x, dst_y,
                        duration=move_speed, dragging=True,
                        mid_pause_chance=mid_pause_chance)

        # 5. Micro-adjustment before releasing
        if random.random() < micro_adjust_chance:
            adj_x = dst_x + random.randint(-2, 2)
            adj_y = dst_y + random.randint(-2, 2)
            _post_drag(adj_x, adj_y)
            time.sleep(random.uniform(0.01, 0.03))

        # 6. Hesitation before releasing
        time.sleep(random.uniform(0.01, 0.05))

        # 7. Release
        _post_up(dst_x, dst_y)
    else:
        import pyautogui
        pyautogui.moveTo(src_x, src_y, duration=move_speed * 0.3)
        pyautogui.mouseDown()
        pyautogui.moveTo(dst_x, dst_y, duration=move_speed)
        pyautogui.mouseUp()


def fake_think_click(board_rect: dict, is_flipped: bool, move_speed: float = 0.1):
    """Click a random square on the board to simulate thinking."""
    file_idx = random.randint(0, 7)
    rank_idx = random.randint(0, 7)
    x, y = _square_to_screen(file_idx, rank_idx, board_rect, is_flipped)
    logger.debug(f"Fake think click: ({x},{y})")

    global _is_automating
    _is_automating = True
    try:
        if IS_MACOS:
            cur_x, cur_y = _get_cursor_pos()
            _human_move(cur_x, cur_y, x, y, duration=random.uniform(0.1, 0.25))
            time.sleep(random.uniform(0.01, 0.05))
            _mouse_click(x, y)
        else:
            import pyautogui
            pyautogui.moveTo(x, y, duration=random.uniform(0.1, 0.25))
            pyautogui.click()
    finally:
        _is_automating = False


# ---------------------------------------------------------------------------
# User mouse activity monitor
# ---------------------------------------------------------------------------

BROWSER_BUNDLE_IDS = {
    "com.google.Chrome",
    "com.google.Chrome.canary",
    "com.brave.Browser",
    "org.mozilla.firefox",
    "com.apple.Safari",
    "com.microsoft.edgemac",
    "com.operasoftware.Opera",
    "com.vivaldi.Vivaldi",
}


def _is_browser_focused() -> bool:
    try:
        from AppKit import NSWorkspace
        app = NSWorkspace.sharedWorkspace().frontmostApplication()
        return app.bundleIdentifier() in BROWSER_BUNDLE_IDS
    except Exception:
        return True


class UserMouseMonitor:
    """Monitors real user mouse activity and browser focus to pause auto-move."""

    def __init__(self, automove_state, idle_timeout=1.5):
        self._state = automove_state
        self._idle_timeout = idle_timeout
        self._last_user_move = 0.0
        self._user_active = False
        self._browser_focused = True
        self._tap = None
        self._loop_source = None

    def start(self):
        if not IS_MACOS:
            return
        import threading
        threading.Thread(target=self._run_tap, daemon=True).start()
        threading.Thread(target=self._focus_checker, daemon=True).start()
        logger.info("User mouse monitor started")

    def _run_tap(self):
        mask = (
            (1 << Quartz.kCGEventMouseMoved) |
            (1 << Quartz.kCGEventLeftMouseDown) |
            (1 << Quartz.kCGEventLeftMouseDragged)
        )
        tap = Quartz.CGEventTapCreate(
            Quartz.kCGSessionEventTap,
            Quartz.kCGHeadInsertEventTap,
            Quartz.kCGEventTapOptionListenOnly,
            mask,
            self._callback,
            None,
        )
        if not tap:
            logger.warning("Failed to create CGEventTap for mouse monitoring")
            return

        source = Quartz.CFMachPortCreateRunLoopSource(None, tap, 0)
        loop = Quartz.CFRunLoopGetCurrent()
        Quartz.CFRunLoopAddSource(loop, source, Quartz.kCFRunLoopDefaultMode)
        Quartz.CGEventTapEnable(tap, True)
        self._tap = tap
        self._loop_source = source

        import threading
        threading.Thread(target=self._idle_checker, daemon=True).start()

        Quartz.CFRunLoopRun()

    def _callback(self, proxy, event_type, event, refcon):
        if _is_automating:
            return event

        now = time.time()
        self._last_user_move = now

        if not self._user_active:
            self._user_active = True
            self._state.on_user_mouse_active()

        return event

    def _idle_checker(self):
        while True:
            time.sleep(0.3)
            if self._user_active and (time.time() - self._last_user_move > self._idle_timeout):
                self._user_active = False
                if self._browser_focused:
                    self._state.on_user_mouse_idle()

    def _focus_checker(self):
        while True:
            time.sleep(0.5)
            focused = _is_browser_focused()
            if focused != self._browser_focused:
                self._browser_focused = focused
                if not focused:
                    logger.info("Browser lost focus — pausing auto-move")
                    self._state.on_user_mouse_active()
                else:
                    logger.info("Browser focused — resuming auto-move")
                    if not self._user_active:
                        self._state.on_user_mouse_idle()
