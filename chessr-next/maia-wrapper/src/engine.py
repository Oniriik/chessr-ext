"""
Maia-2 inference engine using ONNX Runtime.

Handles board encoding, model inference, and move decoding.
"""

import json
import os
import chess
import numpy as np
import onnxruntime as ort


# 11 ELO categories used by Maia-2
ELO_CATEGORIES = [
    (0, 1100),     # 0
    (1100, 1200),  # 1
    (1200, 1300),  # 2
    (1300, 1400),  # 3
    (1400, 1500),  # 4
    (1500, 1600),  # 5
    (1600, 1700),  # 6
    (1700, 1800),  # 7
    (1800, 1900),  # 8
    (1900, 2000),  # 9
    (2000, 9999),  # 10
]


def _elo_to_category(elo: int) -> int:
    if elo < 1100:
        return 0
    if elo >= 2000:
        return 10
    return (elo - 1100) // 100 + 1


def _load_move_vocab() -> list[str]:
    """Load the 1880-move vocabulary used by Maia-2 from the bundled JSON file."""
    vocab_path = os.path.join(os.path.dirname(__file__), "move_vocab.json")
    with open(vocab_path) as f:
        return json.load(f)


def _board_to_tensor(board: chess.Board) -> np.ndarray:
    """Convert a chess.Board to an [18, 8, 8] float32 tensor.

    Channels:
      0-5:   White P, N, B, R, Q, K
      6-11:  Black P, N, B, R, Q, K
      12:    Turn (all 1s if white)
      13-16: Castling rights (WK, WQ, BK, BQ)
      17:    En passant square
    """
    tensor = np.zeros((18, 8, 8), dtype=np.float32)

    piece_map = {
        chess.PAWN: 0, chess.KNIGHT: 1, chess.BISHOP: 2,
        chess.ROOK: 3, chess.QUEEN: 4, chess.KING: 5,
    }

    for sq, piece in board.piece_map().items():
        rank = chess.square_rank(sq)
        file = chess.square_file(sq)
        offset = 0 if piece.color == chess.WHITE else 6
        tensor[piece_map[piece.piece_type] + offset, rank, file] = 1.0

    if board.turn == chess.WHITE:
        tensor[12, :, :] = 1.0

    if board.has_kingside_castling_rights(chess.WHITE):
        tensor[13, :, :] = 1.0
    if board.has_queenside_castling_rights(chess.WHITE):
        tensor[14, :, :] = 1.0
    if board.has_kingside_castling_rights(chess.BLACK):
        tensor[15, :, :] = 1.0
    if board.has_queenside_castling_rights(chess.BLACK):
        tensor[16, :, :] = 1.0

    if board.ep_square is not None:
        rank = chess.square_rank(board.ep_square)
        file = chess.square_file(board.ep_square)
        tensor[17, rank, file] = 1.0

    return tensor


def _mirror_move(move_uci: str) -> str:
    """Mirror a UCI move vertically (for black positions)."""
    def mirror_sq(sq_name):
        file = sq_name[0]
        rank = str(9 - int(sq_name[1]))
        return file + rank

    from_sq = move_uci[:2]
    to_sq = move_uci[2:4]
    promo = move_uci[4:] if len(move_uci) > 4 else ""
    return mirror_sq(from_sq) + mirror_sq(to_sq) + promo


def _softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - np.max(x))
    return e / e.sum()


class MaiaEngine:
    def __init__(self, model_path: str):
        """Initialize the Maia-2 ONNX engine.

        Args:
            model_path: Path to the .onnx model file.
        """
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model not found: {model_path}")

        self.session = ort.InferenceSession(
            model_path,
            providers=["CPUExecutionProvider"],
        )
        self.all_moves = _load_move_vocab()
        self.move_to_idx = {m: i for i, m in enumerate(self.all_moves)}
        self.idx_to_move = {i: m for i, m in enumerate(self.all_moves)}

    def predict(self, fen: str, elo_self: int, elo_oppo: int, top_n: int = 5) -> dict:
        """Run Maia-2 inference on a position.

        Args:
            fen: FEN string of the position.
            elo_self: ELO of the player to move.
            elo_oppo: ELO of the opponent.
            top_n: Number of top moves to return.

        Returns:
            dict with keys:
                - moves: list of {move, probability} sorted by probability desc
                - win_prob: win probability for the player to move
                - fen: the input FEN
        """
        board = chess.Board(fen)
        is_black = board.turn == chess.BLACK

        # Mirror board if black to move (model always sees white's perspective)
        if is_black:
            board = board.mirror()

        tensor = _board_to_tensor(board)
        elo_self_cat = np.array([_elo_to_category(elo_self)], dtype=np.int64)
        elo_oppo_cat = np.array([_elo_to_category(elo_oppo)], dtype=np.int64)

        # Add batch dimension
        boards = tensor[np.newaxis, ...]  # [1, 18, 8, 8]

        outputs = self.session.run(
            None,
            {
                "boards": boards,
                "elos_self": elo_self_cat,
                "elos_oppo": elo_oppo_cat,
            },
        )

        logits_maia = outputs[0][0]    # [1880]
        logits_value = outputs[2][0]   # scalar

        # Get legal moves and build mask
        original_board = chess.Board(fen)
        legal_moves_uci = [m.uci() for m in original_board.legal_moves]

        if is_black:
            # Mirror legal moves to match model's white perspective
            legal_mirrored = [_mirror_move(m) for m in legal_moves_uci]
        else:
            legal_mirrored = legal_moves_uci

        legal_mask = np.zeros(len(self.all_moves), dtype=np.float32)
        for m in legal_mirrored:
            if m in self.move_to_idx:
                legal_mask[self.move_to_idx[m]] = 1.0

        # Mask illegal moves and compute probabilities
        masked = np.where(legal_mask > 0, logits_maia, -1e9)
        probs = _softmax(masked)

        # Build move list, un-mirror if needed
        move_probs = []
        for m_mirrored in legal_mirrored:
            if m_mirrored not in self.move_to_idx:
                continue
            idx = self.move_to_idx[m_mirrored]
            prob = float(probs[idx])
            # Un-mirror move back to original orientation
            original_move = _mirror_move(m_mirrored) if is_black else m_mirrored
            move_probs.append({"move": original_move, "probability": round(prob, 4)})

        move_probs.sort(key=lambda x: x["probability"], reverse=True)

        # Win probability (model outputs white's perspective)
        win_prob_white = float(np.clip(logits_value / 2 + 0.5, 0, 1))
        win_prob = (1 - win_prob_white) if is_black else win_prob_white

        return {
            "moves": move_probs[:top_n],
            "win_prob": round(win_prob, 4),
            "fen": fen,
        }
