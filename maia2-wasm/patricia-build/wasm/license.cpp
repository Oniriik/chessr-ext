#include "license.h"
#include "monocypher/monocypher.h"
#include "obfs.h"

#include <emscripten/fetch.h>
#include <emscripten/emscripten.h>

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>

#ifndef LICENSE_URL_OVERRIDE
#define LICENSE_URL_OVERRIDE "https://engine.chessr.io/api/license/verify"
#endif

#ifdef LICENSE_DEBUG
#define LIC_LOG(...) do { fprintf(stderr, "[license] " __VA_ARGS__); fputc('\n', stderr); } while(0)
#else
#define LIC_LOG(...) do {} while(0)
#endif

static const unsigned char MASTER_PUBLIC_KEY[32] = {
  /*MASTER_PUBLIC_KEY_PLACEHOLDER*/
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
};

static char g_auth_token[4096] = {0};
static size_t g_auth_token_len = 0;

void license_set_auth_token(const char* token) {
  if (!token) { g_auth_token[0] = '\0'; g_auth_token_len = 0; return; }
  size_t n = strnlen(token, sizeof(g_auth_token) - 1);
  memcpy(g_auth_token, token, n);
  g_auth_token[n] = '\0';
  g_auth_token_len = n;
}

static void random_bytes(uint8_t* out, size_t n) {
  EM_ASM({
    const view = new Uint8Array(HEAPU8.buffer, $0, $1);
    crypto.getRandomValues(view);
  }, out, n);
}

static void to_hex(char* out, const uint8_t* in, size_t n) {
  static const char H[] = "0123456789abcdef";
  for (size_t i = 0; i < n; i++) {
    out[i * 2]     = H[in[i] >> 4];
    out[i * 2 + 1] = H[in[i] & 0xF];
  }
  out[n * 2] = '\0';
}

static double unix_ms_now() {
  return EM_ASM_DOUBLE({ return Date.now(); });
}

static int b64url_decode(const char* src, size_t src_len, uint8_t* dst, size_t dst_cap) {
  static int8_t table[256];
  static bool init = false;
  if (!init) {
    for (int i = 0; i < 256; i++) table[i] = -1;
    for (int i = 0; i < 26; i++) table['A' + i] = i;
    for (int i = 0; i < 26; i++) table['a' + i] = 26 + i;
    for (int i = 0; i < 10; i++) table['0' + i] = 52 + i;
    table['-'] = 62;
    table['_'] = 63;
    init = true;
  }

  size_t out = 0;
  uint32_t buf = 0;
  int bits = 0;
  for (size_t i = 0; i < src_len; i++) {
    char c = src[i];
    if (c == '\n' || c == '\r' || c == ' ' || c == '=') continue;
    int8_t v = table[(uint8_t)c];
    if (v < 0) return -1;
    buf = (buf << 6) | (uint32_t)v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (out >= dst_cap) return -1;
      dst[out++] = (uint8_t)((buf >> bits) & 0xFF);
    }
  }
  return (int)out;
}

static bool extract_str(const char* json, size_t json_len,
                        const char* key,
                        char* out, size_t out_cap) {
  size_t key_len = strlen(key);
  for (size_t i = 0; i + key_len + 2 < json_len; i++) {
    if (json[i] != '"') continue;
    if (memcmp(json + i + 1, key, key_len) != 0) continue;
    if (json[i + 1 + key_len] != '"') continue;
    size_t p = i + key_len + 2;
    while (p < json_len && (json[p] == ' ' || json[p] == ':')) p++;
    if (p >= json_len || json[p] != '"') continue;
    p++;
    size_t start = p;
    while (p < json_len && json[p] != '"') p++;
    size_t len = p - start;
    if (len + 1 > out_cap) return false;
    memcpy(out, json + start, len);
    out[len] = '\0';
    return true;
  }
  return false;
}

static bool extract_int(const char* json, size_t json_len,
                        const char* key,
                        long long* out) {
  size_t key_len = strlen(key);
  for (size_t i = 0; i + key_len + 2 < json_len; i++) {
    if (json[i] != '"') continue;
    if (memcmp(json + i + 1, key, key_len) != 0) continue;
    if (json[i + 1 + key_len] != '"') continue;
    size_t p = i + key_len + 2;
    while (p < json_len && (json[p] == ' ' || json[p] == ':')) p++;
    if (p >= json_len) continue;
    char* endp = nullptr;
    long long v = strtoll(json + p, &endp, 10);
    if (endp == json + p) continue;
    *out = v;
    return true;
  }
  return false;
}

bool license_verify(const char* engine) {
#ifdef LICENSE_TEST_MODE
  (void)engine;
  LIC_LOG("verify: TEST_MODE bypass");
  return true;
#endif
  LIC_LOG("verify: engine=%s url=%s", engine ? engine : "(null)", LICENSE_URL_OVERRIDE);
  if (!engine || !engine[0]) { LIC_LOG("verify: missing engine"); return false; }
  if (g_auth_token_len == 0) { LIC_LOG("verify: no auth token set"); return false; }

  uint8_t nonce_bytes[16];
  random_bytes(nonce_bytes, 16);
  char nonce_hex[33];
  to_hex(nonce_hex, nonce_bytes, 16);

  double ts_ms = unix_ms_now();

  char body[512];
  int body_len = snprintf(body, sizeof(body),
    OBFS("{\"engine\":\"%s\",\"nonce\":\"%s\",\"timestamp\":%.0f}"),
    engine, nonce_hex, ts_ms);
  if (body_len <= 0 || body_len >= (int)sizeof(body)) return false;

  char auth_header[4128];
  int auth_header_len = snprintf(auth_header, sizeof(auth_header),
    OBFS("Bearer %s"), g_auth_token);
  if (auth_header_len <= 0 || auth_header_len >= (int)sizeof(auth_header)) return false;

  emscripten_fetch_attr_t attr;
  emscripten_fetch_attr_init(&attr);
  strcpy(attr.requestMethod, OBFS("POST"));
  attr.attributes = EMSCRIPTEN_FETCH_LOAD_TO_MEMORY
                  | EMSCRIPTEN_FETCH_SYNCHRONOUS
                  | EMSCRIPTEN_FETCH_REPLACE;
  attr.requestData = body;
  attr.requestDataSize = (size_t)body_len;

  const char* headers[] = {
    OBFS("Authorization"), auth_header,
    OBFS("Content-Type"),  OBFS("application/json"),
    nullptr,
  };
  attr.requestHeaders = headers;

  LIC_LOG("verify: POST %s", LICENSE_URL_OVERRIDE);
  emscripten_fetch_t* resp = emscripten_fetch(&attr, OBFS(LICENSE_URL_OVERRIDE));
  if (!resp) { LIC_LOG("verify: emscripten_fetch returned null"); return false; }

  bool ok = false;

  do {
    LIC_LOG("verify: status=%d bytes=%llu", (int)resp->status, (unsigned long long)resp->numBytes);
    if (resp->status != 200) { LIC_LOG("verify: non-200 → fail"); break; }
    if (resp->numBytes == 0 || resp->numBytes > 8192) { LIC_LOG("verify: bad body size"); break; }

    char b64_cert[3072], b64_grant[3072];
    if (!extract_str(resp->data, (size_t)resp->numBytes,
                     OBFS("certificate"), b64_cert, sizeof(b64_cert))) {
      LIC_LOG("verify: missing 'certificate' in response");
      break;
    }
    if (!extract_str(resp->data, (size_t)resp->numBytes,
                     OBFS("signed_response"), b64_grant, sizeof(b64_grant))) {
      LIC_LOG("verify: missing 'signed_response' in response");
      break;
    }

    uint8_t cert_decoded[2048];
    int cert_len = b64url_decode(b64_cert, strlen(b64_cert), cert_decoded, sizeof(cert_decoded));
    if (cert_len < 64 + 16) { LIC_LOG("verify: cert too short (%d)", cert_len); break; }
    const uint8_t* master_sig = cert_decoded;
    const uint8_t* cert_payload = cert_decoded + 64;
    size_t cert_payload_len = (size_t)cert_len - 64;
    if (crypto_eddsa_check(master_sig, MASTER_PUBLIC_KEY,
                           cert_payload, cert_payload_len) != 0) {
      LIC_LOG("verify: master signature on cert FAILED");
      break;
    }

    char b64_employee_pub[64];
    long long valid_from = 0, valid_to = 0;
    if (!extract_str((const char*)cert_payload, cert_payload_len,
                     OBFS("pubkey"), b64_employee_pub, sizeof(b64_employee_pub))) {
      LIC_LOG("verify: cert missing 'pubkey'"); break;
    }
    if (!extract_int((const char*)cert_payload, cert_payload_len,
                     OBFS("from"), &valid_from)) { LIC_LOG("verify: cert missing 'from'"); break; }
    if (!extract_int((const char*)cert_payload, cert_payload_len,
                     OBFS("to"), &valid_to)) { LIC_LOG("verify: cert missing 'to'"); break; }

    uint8_t employee_pub[32];
    int emp_pub_len = b64url_decode(b64_employee_pub, strlen(b64_employee_pub),
                                     employee_pub, sizeof(employee_pub));
    if (emp_pub_len != 32) { LIC_LOG("verify: employee pubkey wrong length (%d)", emp_pub_len); break; }

    double now = unix_ms_now();
    if (now < (double)valid_from || now >= (double)valid_to) {
      LIC_LOG("verify: cert outside validity window now=%.0f from=%lld to=%lld",
              now, valid_from, valid_to);
      break;
    }

    uint8_t grant_decoded[2048];
    int grant_len = b64url_decode(b64_grant, strlen(b64_grant), grant_decoded, sizeof(grant_decoded));
    if (grant_len < 64 + 16) { LIC_LOG("verify: grant too short (%d)", grant_len); break; }
    const uint8_t* employee_sig = grant_decoded;
    const uint8_t* grant_payload = grant_decoded + 64;
    size_t grant_payload_len = (size_t)grant_len - 64;
    if (crypto_eddsa_check(employee_sig, employee_pub,
                           grant_payload, grant_payload_len) != 0) {
      LIC_LOG("verify: employee signature on grant FAILED");
      break;
    }

    char claim_engine[32], claim_nonce[64];
    long long claim_exp = 0;
    if (!extract_str((const char*)grant_payload, grant_payload_len,
                     OBFS("engine"), claim_engine, sizeof(claim_engine))) {
      LIC_LOG("verify: grant missing 'engine'"); break;
    }
    if (!extract_str((const char*)grant_payload, grant_payload_len,
                     OBFS("nonce"), claim_nonce, sizeof(claim_nonce))) {
      LIC_LOG("verify: grant missing 'nonce'"); break;
    }
    if (!extract_int((const char*)grant_payload, grant_payload_len,
                     OBFS("exp"), &claim_exp)) { LIC_LOG("verify: grant missing 'exp'"); break; }

    if (strcmp(claim_engine, engine) != 0) {
      LIC_LOG("verify: engine mismatch (claim=%s want=%s)", claim_engine, engine);
      break;
    }
    if (strcmp(claim_nonce, nonce_hex) != 0) {
      LIC_LOG("verify: nonce mismatch");
      break;
    }
    if ((double)claim_exp * 1000.0 < now) {
      LIC_LOG("verify: grant expired (exp=%lld now=%.0f)", claim_exp, now);
      break;
    }

    ok = true;
    LIC_LOG("verify: OK (engine=%s, expires in %.0fs)",
            engine, ((double)claim_exp * 1000.0 - now) / 1000.0);
  } while (false);

  emscripten_fetch_close(resp);
  return ok;
}
