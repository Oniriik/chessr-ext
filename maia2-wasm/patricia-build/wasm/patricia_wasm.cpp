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

#include <emscripten/emscripten.h>
#include <memory>
#include <string>

// ─── Fathom stubs ─────────────────────────────────────────────────────────

extern "C" {

unsigned TB_LARGEST = 0;

bool tb_init_impl(const char * /*path*/) { return false; }
bool tb_init(const char * /*path*/)      { return false; }
void tb_free()                            { /* no-op */ }

unsigned tb_probe_wdl_impl(
    uint64_t, uint64_t, uint64_t, uint64_t, uint64_t,
    uint64_t, uint64_t, uint64_t, unsigned, bool) {
  return TB_RESULT_FAILED;
}

unsigned tb_probe_root_impl(
    uint64_t, uint64_t, uint64_t, uint64_t, uint64_t,
    uint64_t, uint64_t, uint64_t,
    unsigned, unsigned, bool, unsigned *) {
  return TB_RESULT_FAILED;
}

} // extern "C"

// ─── Engine state ─────────────────────────────────────────────────────────

namespace {
Position*    g_position    = nullptr;
ThreadInfo*  g_thread_info = nullptr;
std::thread  g_dummy_thread;
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
void wasm_command(const char* cmd) {
  if (!g_position) wasm_init();
  std::string line(cmd);
  process_uci_command(line, *g_position, *g_thread_info, g_dummy_thread);
}

} // extern "C"
