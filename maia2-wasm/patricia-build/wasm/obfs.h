#pragma once

#include <cstdint>
#include <cstddef>

// Light string obfuscation. Strings wrapped in OBFS(...) are XORed with a
// constant key at compile time → the literal text never appears in the
// binary's data section. Decoded once at first use into a per-call-site
// static buffer.
//
// Cost: ~50 bytes binary per string + one decode loop per cold start.
// Bypass cost: trivial if the attacker reads the source, near-zero if they
// just decompile and trace the calls. Purpose is to make `strings <wasm>`
// useless for casual reconnaissance.

namespace obfs {

inline constexpr uint8_t KEY[] = {
  0x5a, 0xc3, 0x71, 0xe9, 0x4d, 0x82, 0xb7, 0x6f,
  0x18, 0xa4, 0xfb, 0x29, 0x6c, 0xd0, 0x37, 0x95,
};
inline constexpr size_t KEY_LEN = sizeof(KEY);

template <size_t N>
struct Enc {
  char d[N];
  constexpr Enc(const char (&s)[N]) : d{} {
    for (size_t i = 0; i < N; i++) d[i] = s[i] ^ KEY[i % KEY_LEN];
  }
};

} // namespace obfs

#ifdef DISABLE_OBFS
// Verbose / debug builds: leave the literal in the binary verbatim. Lets
// you read strings in devtools, error messages, and `strings` output.
#define OBFS(literal) (literal)
#else
#define OBFS(literal) ([]() -> const char* {                                   \
  static constexpr ::obfs::Enc<sizeof(literal)> enc(literal);                  \
  static char buf[sizeof(literal)];                                            \
  static bool init = false;                                                    \
  if (!init) {                                                                 \
    for (size_t i = 0; i < sizeof(literal); i++)                               \
      buf[i] = enc.d[i] ^ ::obfs::KEY[i % ::obfs::KEY_LEN];                    \
    init = true;                                                               \
  }                                                                            \
  return buf;                                                                  \
}())
#endif
