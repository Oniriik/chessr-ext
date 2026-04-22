#pragma once

#include <cstddef>

// Convert a FEN string into Maia 2's input tensor [18, 8, 8] flattened
// (1152 floats). Layout matches `board_to_tensor` in maia2/utils.py:
//   channels 0-5  : white P/N/B/R/Q/K (1 = piece present at sq)
//   channels 6-11 : black P/N/B/R/Q/K
//   channel  12   : turn (1.0 everywhere if white-to-move)
//   channels 13-16: castling K/Q/k/q (1.0 everywhere if right available)
//   channel  17   : en-passant target square (single 1.0)
//
// Returns true on success. `out` must point to at least 1152 floats.
bool board_to_tensor(const char* fen, float* out);

// Mirror a UCI move string in-place (for black-to-move handling).
// e.g. "e2e4" → "e7e5", "e1g1" → "e8g8". Promotion suffix preserved.
// `uci` must be at least 6 bytes.
void mirror_move(char* uci);

// Mirror a FEN string. Output goes into `out` (must hold at least len(fen)+1).
bool mirror_fen(const char* fen, char* out, size_t out_cap);
