// patricia_wasm.cpp — WebAssembly entrypoint for Patricia.
//
// Replaces patricia.cpp's main() with two C-callable functions exposed to JS:
//   - wasm_init():     allocate Position + ThreadInfo, run engine init.
//   - wasm_command(c): feed one UCI command line. printf output flows to
//                      Module.print on the JS side.
//
// Also provides stubs for the Fathom (Syzygy tablebase) symbols Patricia
// references, since we don't compile tbprobe.c (no filesystem in the
// browser sandbox). Probes always return TB_RESULT_FAILED → search ignores
// tablebases entirely.

#include "../src/engine/src/search.h"
#include "../src/engine/src/uci.h"
#include "license.h"
#include "obfs.h"

#include <emscripten/emscripten.h>
#include <memory>
#include <string>

// ─── Fathom stubs ─────────────────────────────────────────────────────────
// These satisfy the linker for the tb_init / tb_probe_wdl inline wrappers in
// fathom/src/tbprobe.h, which call out to the *_impl symbols normally
// defined in tbprobe.c.

extern "C" {

unsigned TB_LARGEST = 0;

bool tb_init_impl(const char * /*path*/) {
  return false;
}

bool tb_init(const char * /*path*/) {
  return false;
}

void tb_free() {
  // no-op
}

unsigned tb_probe_wdl_impl(
    uint64_t /*white*/, uint64_t /*black*/, uint64_t /*kings*/,
    uint64_t /*queens*/, uint64_t /*rooks*/, uint64_t /*bishops*/,
    uint64_t /*knights*/, uint64_t /*pawns*/,
    unsigned /*ep*/, bool /*turn*/) {
  return TB_RESULT_FAILED;
}

unsigned tb_probe_root_impl(
    uint64_t /*white*/, uint64_t /*black*/, uint64_t /*kings*/,
    uint64_t /*queens*/, uint64_t /*rooks*/, uint64_t /*bishops*/,
    uint64_t /*knights*/, uint64_t /*pawns*/,
    unsigned /*rule50*/, unsigned /*ep*/, bool /*turn*/,
    unsigned * /*results*/) {
  return TB_RESULT_FAILED;
}

} // extern "C"

// ─── Engine state ─────────────────────────────────────────────────────────

namespace {
Position*    g_position    = nullptr;
ThreadInfo*  g_thread_info = nullptr;
std::thread  g_dummy_thread;   // never started in WASM (run_thread is inline)
} // namespace

// ─── JS-callable entrypoints ──────────────────────────────────────────────

extern "C" {

EMSCRIPTEN_KEEPALIVE
void wasm_init() {
  if (g_position) return;
  g_position    = new Position();
  g_thread_info = new ThreadInfo();
  init_LMR();
  init_bbs();
  new_game(*g_thread_info, TT);
  set_board(*g_position, *g_thread_info,
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  printf("Patricia Chess Engine, written by Adam Kulju\n");
}

EMSCRIPTEN_KEEPALIVE
void wasm_set_auth_token(const char* token) {
  license_set_auth_token(token);
}

static bool is_go_command(const char* cmd) {
  if (!cmd) return false;
  if (cmd[0] != 'g' || cmd[1] != 'o') return false;
  return cmd[2] == '\0' || cmd[2] == ' ' || cmd[2] == '\t' || cmd[2] == '\n';
}

EMSCRIPTEN_KEEPALIVE
void wasm_command(const char* cmd) {
  if (!g_position) wasm_init();

  if (is_go_command(cmd)) {
    if (!license_verify(OBFS("patricia"))) return;
  }

  std::string line(cmd);
  process_uci_command(line, *g_position, *g_thread_info, g_dummy_thread);
}

} // extern "C"
