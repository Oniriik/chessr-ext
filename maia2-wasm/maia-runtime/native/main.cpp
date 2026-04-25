// Native CLI wrapper around the Maia 2 forward-pass runtime. Same model code
// (src/{ops,model,encoding}.cpp) used for the WASM build, just compiled to
// a regular Linux x86_64 ELF with `g++` instead of `em++`. Weights are
// statically baked via wasm/weights_data.cpp (~80 MB blob).
//
// Designed to be spawned as a child_process by the Node serveur and driven
// over stdin/stdout. Long-running, no startup cost per request.
//
// Protocol (line-based UTF-8) ───────────────────────────────────────────
//   stderr (banner once at boot)
//     READY                          ← weights loaded, ready for input
//
//   stdin commands (one per line, '|'-separated)
//     predict|<fen>|<eloSelfBucket>|<eloOppoBucket>
//     quit
//
//   stdout responses (one line per request)
//     result <value> <logit0> <logit1> ... <logit1879>
//     err <reason>                  ← bad request / encode fail / mirror fail
//
//   ELO buckets are 0..10 (see eloBucketIndex in the extension client).
//
// Keep stdout uncluttered — each line is a complete response, no extra
// chatter. Diagnostic messages go to stderr.

#include "../src/model.h"
#include "../src/encoding.h"

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <string>

// Weights are linked in via `ld -r -b binary -o weights.o weights.bin`,
// which auto-generates these three symbols (start, end, size). Bypasses
// the cc1plus parser memory blowup we'd hit if we tried to compile the
// 5 M-line wasm/weights_data.cpp natively.
extern "C" const unsigned char _binary_weights_bin_start[];
extern "C" const unsigned char _binary_weights_bin_end[];
namespace {
const unsigned char* const g_maia_weights = _binary_weights_bin_start;
const size_t g_maia_weights_size = static_cast<size_t>(
    _binary_weights_bin_end - _binary_weights_bin_start);
}

namespace {

maia::ModelWeights g_weights{};
bool   g_loaded   = false;
float  g_board_buf[18 * 64];
float  g_logits_buf[maia::NUM_MOVES];
float  g_value_buf = 0.f;

bool ensure_loaded() {
  if (g_loaded) return true;
  const float* blob = reinterpret_cast<const float*>(g_maia_weights);
  const size_t blob_floats = g_maia_weights_size / sizeof(float);
  const size_t consumed = maia::load_weights(blob, blob_floats, g_weights);
  if (consumed == 0) return false;
  g_loaded = true;
  return true;
}

void emit_error(const std::string& reason) {
  std::cout << "err " << reason << "\n";
  std::cout.flush();
}

bool run_predict(const std::string& fen, int64_t elo_self, int64_t elo_oppo) {
  // Maia is white-POV only — mirror FEN if black-to-move (caller mirrors
  // output moves back).
  const char* effective_fen = fen.c_str();
  char mirrored[128];
  const auto sp = fen.find(' ');
  if (sp != std::string::npos && sp + 1 < fen.size() && fen[sp + 1] == 'b') {
    if (!mirror_fen(fen.c_str(), mirrored, sizeof(mirrored))) {
      emit_error("mirror_fail");
      return false;
    }
    effective_fen = mirrored;
  }

  if (!board_to_tensor(effective_fen, g_board_buf)) {
    emit_error("encode_fail");
    return false;
  }
  if (!maia::forward(g_weights, g_board_buf, elo_self, elo_oppo,
                     g_logits_buf, &g_value_buf)) {
    emit_error("forward_fail");
    return false;
  }
  return true;
}

void emit_result() {
  // Single-line: "result <value> <logits>".
  std::cout << "result " << g_value_buf;
  for (int i = 0; i < maia::NUM_MOVES; ++i) {
    std::cout << ' ' << g_logits_buf[i];
  }
  std::cout << '\n';
  std::cout.flush();
}

} // namespace

int main() {
  // Larger I/O buffers — 1880 floats per response is ~10 KB of text.
  std::ios::sync_with_stdio(false);
  std::cin.tie(nullptr);

  if (!ensure_loaded()) {
    std::cerr << "ERR weights_load_fail\n";
    return 1;
  }
  std::cerr << "READY\n";
  std::cerr.flush();

  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    if (line == "quit" || line == "exit") break;

    // Parse: predict|<fen>|<eloSelf>|<eloOppo>
    const auto p1 = line.find('|');
    if (p1 == std::string::npos) { emit_error("bad_request"); continue; }
    const std::string cmd = line.substr(0, p1);
    if (cmd != "predict") { emit_error("unknown_cmd"); continue; }

    const auto p2 = line.find('|', p1 + 1);
    if (p2 == std::string::npos) { emit_error("bad_request"); continue; }
    const std::string fen = line.substr(p1 + 1, p2 - p1 - 1);

    const auto p3 = line.find('|', p2 + 1);
    if (p3 == std::string::npos) { emit_error("bad_request"); continue; }

    int64_t elo_self = 0, elo_oppo = 0;
    try {
      elo_self = std::stoll(line.substr(p2 + 1, p3 - p2 - 1));
      elo_oppo = std::stoll(line.substr(p3 + 1));
    } catch (...) {
      emit_error("bad_elo");
      continue;
    }

    if (run_predict(fen, elo_self, elo_oppo)) {
      emit_result();
    }
  }
  return 0;
}
