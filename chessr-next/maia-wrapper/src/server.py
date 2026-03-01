"""
WebSocket server for Maia-2 inference.

Listens on localhost for requests from the Chessr extension.
"""

import asyncio
import json
import logging
import time
from typing import Callable

import websockets

from .engine import MaiaEngine
from . import auth as chessr_auth

logger = logging.getLogger("maia-server")
logging.getLogger("websockets.server").setLevel(logging.WARNING)

DEFAULT_PORT = 8765


class MaiaServer:
    def __init__(
        self,
        engine: MaiaEngine,
        port: int = DEFAULT_PORT,
        get_session: Callable[[], dict | None] = lambda: None,
        set_session: Callable[[dict | None], None] = lambda s: None,
    ):
        self.engine = engine
        self.port = port
        self._server = None
        self._clients: set = set()
        self._get_session = get_session
        self._set_session = set_session

    async def _handle_client(self, websocket):
        self._clients.add(websocket)
        remote = websocket.remote_address
        logger.info(f"Client connected: {remote}")

        try:
            async for raw in websocket:
                try:
                    msg = json.loads(raw)
                    response = self._process(msg)
                    await websocket.send(json.dumps(response))
                except json.JSONDecodeError:
                    await websocket.send(json.dumps({
                        "type": "error",
                        "message": "Invalid JSON",
                    }))
                except Exception as e:
                    logger.exception("Error processing request")
                    await websocket.send(json.dumps({
                        "type": "error",
                        "message": str(e),
                        "requestId": msg.get("requestId"),
                    }))
        finally:
            self._clients.discard(websocket)
            logger.info(f"Client disconnected: {remote}")

    def _process(self, msg: dict) -> dict:
        msg_type = msg.get("type")

        if msg_type == "ping":
            return {"type": "pong"}

        if msg_type == "get_auth":
            return self._handle_get_auth()

        if msg_type == "login_with_token":
            return self._handle_login_with_token(msg)

        if msg_type == "analyze":
            # Gate behind auth
            session = self._get_session()
            if not session:
                return {
                    "type": "auth_required",
                    "requestId": msg.get("requestId"),
                }
            if session.get("plan", "free") == "free":
                return {
                    "type": "upgrade_required",
                    "requestId": msg.get("requestId"),
                }
            return self._handle_analyze(msg)

        return {
            "type": "error",
            "message": f"Unknown message type: {msg_type}",
        }

    def _handle_get_auth(self) -> dict:
        session = self._get_session()
        if session:
            return {
                "type": "auth_status",
                "logged_in": True,
                "email": session.get("email", ""),
                "plan": session.get("plan", "free"),
            }
        return {"type": "auth_status", "logged_in": False}

    def _handle_login_with_token(self, msg: dict) -> dict:
        access_token = msg.get("access_token", "")
        refresh_token = msg.get("refresh_token", "")

        if not access_token:
            return {"type": "auth_status", "logged_in": False, "error": "Missing token"}

        try:
            session = chessr_auth.login_with_token(access_token, refresh_token)
            self._set_session(session)
            return {
                "type": "auth_status",
                "logged_in": True,
                "email": session["email"],
                "plan": session["plan"],
            }
        except Exception as e:
            logger.warning(f"Token login failed: {e}")
            return {"type": "auth_status", "logged_in": False, "error": str(e)}

    def _handle_analyze(self, msg: dict) -> dict:
        request_id = msg.get("requestId", "?")
        fen = msg.get("fen")
        if not fen:
            logger.warning(f"[{request_id}] Missing 'fen' field")
            return {"type": "error", "message": "Missing 'fen' field"}

        elo_self = msg.get("elo_self", 1500)
        elo_oppo = msg.get("elo_oppo", 1500)
        top_n = msg.get("top_n", 5)

        # Short FEN for logging (just pieces + turn)
        short_fen = fen.split(" ")[0][:20] + "..."
        logger.info(f"[{request_id}] Analyze: elo={elo_self}v{elo_oppo} fen={short_fen}")

        t0 = time.perf_counter()
        result = self.engine.predict(
            fen=fen,
            elo_self=elo_self,
            elo_oppo=elo_oppo,
            top_n=top_n,
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000

        top_move = result["moves"][0] if result["moves"] else None
        top_str = f"{top_move['move']} ({top_move['probability']*100:.1f}%)" if top_move else "none"
        logger.info(f"[{request_id}] Result: top={top_str} winProb={result['win_prob']:.2f} ({elapsed_ms:.1f}ms)")

        return {
            "type": "analysis_result",
            "requestId": request_id,
            **result,
        }

    async def start(self):
        self._server = await websockets.serve(
            self._handle_client,
            "127.0.0.1",
            self.port,
        )
        logger.info(f"Maia server listening on ws://127.0.0.1:{self.port}")

    async def stop(self):
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            logger.info("Maia server stopped")

    @property
    def client_count(self) -> int:
        return len(self._clients)

    @property
    def is_running(self) -> bool:
        return self._server is not None and self._server.is_serving()
