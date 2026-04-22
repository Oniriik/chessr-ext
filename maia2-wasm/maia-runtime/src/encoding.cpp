#include "encoding.h"

#include <cstring>
#include <cstdio>
#include <cctype>
#include <cstdlib>

// Piece-channel mapping: { type → (white_idx, black_idx) }
// Order matches maia2/utils.py: pawn=0, knight=1, bishop=2, rook=3, queen=4, king=5
static int piece_channel(char p) {
  switch (p) {
    case 'P': return 0;  case 'p': return 6;
    case 'N': return 1;  case 'n': return 7;
    case 'B': return 2;  case 'b': return 8;
    case 'R': return 3;  case 'r': return 9;
    case 'Q': return 4;  case 'q': return 10;
    case 'K': return 5;  case 'k': return 11;
    default:  return -1;
  }
}

bool board_to_tensor(const char* fen, float* out) {
  if (!fen || !out) return false;
  std::memset(out, 0, 18 * 64 * sizeof(float));

  // Parse FEN fields up to en-passant.
  const char* p = fen;
  // Field 1: pieces
  int rank = 7;  // FEN starts at rank 8
  int file = 0;
  while (*p && *p != ' ') {
    char c = *p++;
    if (c == '/') { rank--; file = 0; continue; }
    if (c >= '1' && c <= '8') { file += c - '0'; continue; }
    int ch = piece_channel(c);
    if (ch < 0 || rank < 0 || file > 7) return false;
    // Channel ch, square (rank*8 + file)
    out[ch * 64 + rank * 8 + file] = 1.0f;
    file++;
  }
  if (*p != ' ') return false;
  p++;

  // Field 2: side to move
  if (*p == 'w') {
    for (int i = 0; i < 64; i++) out[12 * 64 + i] = 1.0f;
  } else if (*p != 'b') return false;
  p++;
  if (*p++ != ' ') return false;

  // Field 3: castling rights
  while (*p && *p != ' ') {
    int chan = -1;
    switch (*p) {
      case 'K': chan = 13; break;
      case 'Q': chan = 14; break;
      case 'k': chan = 15; break;
      case 'q': chan = 16; break;
      case '-':              break;
      default:  return false;
    }
    if (chan >= 0) {
      for (int i = 0; i < 64; i++) out[chan * 64 + i] = 1.0f;
    }
    p++;
  }
  if (*p++ != ' ') return false;

  // Field 4: en-passant
  if (*p == '-') {
    p++;
  } else {
    int ep_file = *p++ - 'a';
    int ep_rank = *p++ - '1';
    if (ep_file < 0 || ep_file > 7 || ep_rank < 0 || ep_rank > 7) return false;
    out[17 * 64 + ep_rank * 8 + ep_file] = 1.0f;
  }

  return true;
}

void mirror_move(char* uci) {
  if (!uci) return;
  size_t n = strlen(uci);
  if (n < 4) return;
  // squares are at uci[0..1] and uci[2..3]
  uci[1] = (char)('0' + (9 - (uci[1] - '0')));
  uci[3] = (char)('0' + (9 - (uci[3] - '0')));
}

bool mirror_fen(const char* fen, char* out, size_t out_cap) {
  if (!fen || !out) return false;

  // Find the end of the pieces field.
  const char* slash_end = strchr(fen, ' ');
  if (!slash_end) return false;
  size_t pieces_len = (size_t)(slash_end - fen);
  if (pieces_len + 1 > out_cap) return false;

  // Split pieces by '/', reverse order, swap case.
  char ranks[8][32];
  int n_ranks = 0;
  size_t i = 0;
  while (i < pieces_len && n_ranks < 8) {
    size_t j = i;
    while (j < pieces_len && fen[j] != '/') j++;
    size_t len = j - i;
    if (len >= sizeof(ranks[0])) return false;
    std::memcpy(ranks[n_ranks], fen + i, len);
    ranks[n_ranks][len] = '\0';
    n_ranks++;
    i = (j < pieces_len) ? j + 1 : j;
  }
  if (n_ranks != 8) return false;

  size_t out_pos = 0;
  for (int r = n_ranks - 1; r >= 0; r--) {
    if (out_pos + strlen(ranks[r]) + 2 > out_cap) return false;
    for (size_t k = 0; k < strlen(ranks[r]); k++) {
      char c = ranks[r][k];
      if (c >= 'A' && c <= 'Z') out[out_pos++] = (char)(c + 32);
      else if (c >= 'a' && c <= 'z') out[out_pos++] = (char)(c - 32);
      else out[out_pos++] = c;
    }
    if (r > 0) out[out_pos++] = '/';
  }

  // Continue with rest of FEN (after pieces): swap turn, swap castling case, mirror EP rank.
  const char* rest = slash_end;  // points to ' '
  out[out_pos++] = ' ';
  rest++;

  // Turn
  if (out_pos + 1 >= out_cap) return false;
  out[out_pos++] = (*rest == 'w') ? 'b' : 'w';
  rest++;
  if (*rest != ' ') return false;
  out[out_pos++] = ' ';
  rest++;

  // Castling
  while (*rest && *rest != ' ') {
    if (out_pos + 1 >= out_cap) return false;
    char c = *rest++;
    if (c >= 'A' && c <= 'Z') out[out_pos++] = (char)(c + 32);
    else if (c >= 'a' && c <= 'z') out[out_pos++] = (char)(c - 32);
    else out[out_pos++] = c;
  }
  if (*rest != ' ') return false;
  out[out_pos++] = ' ';
  rest++;

  // En-passant: mirror rank
  if (*rest == '-') {
    out[out_pos++] = '-';
    rest++;
  } else {
    out[out_pos++] = *rest++;       // file
    if (*rest >= '1' && *rest <= '8') {
      out[out_pos++] = (char)('0' + (9 - (*rest - '0')));
      rest++;
    } else return false;
  }

  // Copy rest (halfmove + fullmove)
  while (*rest && out_pos < out_cap - 1) out[out_pos++] = *rest++;
  out[out_pos] = '\0';
  return true;
}
