#include "../src/model.h"
#include "../src/encoding.h"
#include "../../patricia-build/wasm/license.h"
#include "../../patricia-build/wasm/obfs.h"

#include <emscripten/emscripten.h>

#include <cstdint>
#include <cstdlib>
#include <cstring>

extern "C" {
extern const unsigned char g_maia_weights[];
extern const unsigned int  g_maia_weights_size;
}

namespace {

maia::ModelWeights g_weights{};
bool         g_loaded = false;

float        g_board_buf[18 * 64];
float        g_logits_buf[maia::NUM_MOVES];
float        g_value_buf = 0.f;

bool ensure_loaded() {
  if (g_loaded) return true;
  const float* blob = reinterpret_cast<const float*>(g_maia_weights);
  size_t blob_floats = g_maia_weights_size / sizeof(float);
  size_t consumed = maia::load_weights(blob, blob_floats, g_weights);
  if (consumed == 0) return false;
  g_loaded = true;
  return true;
}

}

extern "C" {

EMSCRIPTEN_KEEPALIVE
void wasm_init() {
  ensure_loaded();
}

EMSCRIPTEN_KEEPALIVE
void wasm_set_auth_token(const char* token) {
  license_set_auth_token(token);
}

EMSCRIPTEN_KEEPALIVE
int wasm_predict(const char* fen, int64_t elo_self, int64_t elo_oppo) {
  if (!ensure_loaded()) return 0;
  if (!license_verify(OBFS("maia2"))) return 0;

  // Maia 2 is white-POV only. If it's black-to-move, mirror the FEN before
  // encoding. The caller (JS) is responsible for mirroring output moves back
  // to the original frame.
  const char* effective_fen = fen;
  char mirrored[128];
  if (fen) {
    const char* sp = fen;
    while (*sp && *sp != ' ') sp++;
    if (*sp == ' ' && sp[1] == 'b') {
      if (!mirror_fen(fen, mirrored, sizeof(mirrored))) return 0;
      effective_fen = mirrored;
    }
  }

  if (!board_to_tensor(effective_fen, g_board_buf)) return 0;
  if (!maia::forward(g_weights, g_board_buf, elo_self, elo_oppo,
                     g_logits_buf, &g_value_buf)) return 0;
  return 1;
}

EMSCRIPTEN_KEEPALIVE
const float* wasm_logits_ptr() { return g_logits_buf; }

EMSCRIPTEN_KEEPALIVE
int wasm_logits_count() { return (int)maia::NUM_MOVES; }

EMSCRIPTEN_KEEPALIVE
float wasm_value() { return g_value_buf; }

}
