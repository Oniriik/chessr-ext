#include "ops.h"

#include <cmath>
#include <algorithm>
#include <cstring>

#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

namespace ops {

// ─── Linear (matmul) ─────────────────────────────────────────────────────
//
// Input  shape: in    [B, I]     (rank-2)
// Weight shape: weight[I, O]
// Output shape: out   [B, O]
//
// Reference: out[b][o] = sum_i in[b][i] * weight[i][o] + bias[o]
//
// SIMD strategy: vectorise the inner loop over O in chunks of 4 floats
// (wasm v128 = 4 × f32). For each (b, i) pair we broadcast in[b][i] and
// FMA into 4 output cells at a time.

void linear(const Tensor& in, const Tensor& weight, const Tensor* bias,
            Tensor& out) {
  const size_t B = in.shape[0];
  const size_t I = in.shape[1];
  const size_t O = weight.shape[1];

  for (size_t b = 0; b < B; b++) {
    float* out_row = out.data + b * O;
    if (bias) {
      std::memcpy(out_row, bias->data, O * sizeof(float));
    } else {
      std::memset(out_row, 0, O * sizeof(float));
    }
    const float* in_row = in.data + b * I;
    for (size_t i = 0; i < I; i++) {
      const float a = in_row[i];
      const float* w_row = weight.data + i * O;
#ifdef __wasm_simd128__
      const v128_t va = wasm_f32x4_splat(a);
      size_t o = 0;
      for (; o + 4 <= O; o += 4) {
        v128_t vw = wasm_v128_load(w_row + o);
        v128_t vo = wasm_v128_load(out_row + o);
        vo = wasm_f32x4_add(vo, wasm_f32x4_mul(va, vw));
        wasm_v128_store(out_row + o, vo);
      }
      for (; o < O; o++) out_row[o] += a * w_row[o];
#else
      for (size_t o = 0; o < O; o++) out_row[o] += a * w_row[o];
#endif
    }
  }
}

// ─── Activations ─────────────────────────────────────────────────────────

void relu_(Tensor& t) {
#ifdef __wasm_simd128__
  size_t i = 0;
  const v128_t zero = wasm_f32x4_splat(0.f);
  for (; i + 4 <= t.size; i += 4) {
    v128_t v = wasm_v128_load(t.data + i);
    v = wasm_f32x4_max(v, zero);
    wasm_v128_store(t.data + i, v);
  }
  for (; i < t.size; i++) if (t.data[i] < 0.f) t.data[i] = 0.f;
#else
  for (size_t i = 0; i < t.size; i++) if (t.data[i] < 0.f) t.data[i] = 0.f;
#endif
}

void gelu_(Tensor& t) {
  // tanh approximation: 0.5x (1 + tanh(sqrt(2/π) (x + 0.044715 x^3)))
  static constexpr float K0 = 0.7978845608028654f;   // sqrt(2/π)
  static constexpr float K1 = 0.044715f;
  for (size_t i = 0; i < t.size; i++) {
    float x = t.data[i];
    float u = K0 * (x + K1 * x * x * x);
    t.data[i] = 0.5f * x * (1.f + std::tanh(u));
  }
}

// ─── LayerNorm (over last dim) ───────────────────────────────────────────

void layernorm(const Tensor& in, const Tensor& gamma, const Tensor& beta,
               float eps, Tensor& out) {
  const size_t D = in.shape[in.rank - 1];
  const size_t N = in.size / D;
  for (size_t n = 0; n < N; n++) {
    const float* in_row = in.data + n * D;
    float* out_row = out.data + n * D;
    float mean = 0.f;
    for (size_t d = 0; d < D; d++) mean += in_row[d];
    mean /= D;
    float var = 0.f;
    for (size_t d = 0; d < D; d++) {
      float diff = in_row[d] - mean;
      var += diff * diff;
    }
    var /= D;
    const float inv_std = 1.f / std::sqrt(var + eps);
    for (size_t d = 0; d < D; d++) {
      out_row[d] = (in_row[d] - mean) * inv_std * gamma.data[d] + beta.data[d];
    }
  }
}

// ─── Softmax (over last dim, in-place) ───────────────────────────────────

void softmax_lastdim_(Tensor& t) {
  const size_t D = t.shape[t.rank - 1];
  const size_t N = t.size / D;
  for (size_t n = 0; n < N; n++) {
    float* row = t.data + n * D;
    float max_v = row[0];
    for (size_t d = 1; d < D; d++) if (row[d] > max_v) max_v = row[d];
    float sum = 0.f;
    for (size_t d = 0; d < D; d++) {
      row[d] = std::exp(row[d] - max_v);
      sum += row[d];
    }
    const float inv = 1.f / sum;
    for (size_t d = 0; d < D; d++) row[d] *= inv;
  }
}

// ─── Embedding ────────────────────────────────────────────────────────────

void embedding(const float* weight, size_t V, size_t D,
               const int64_t* indices, size_t B,
               Tensor& out) {
  for (size_t b = 0; b < B; b++) {
    int64_t idx = indices[b];
    if (idx < 0) idx = 0;
    if ((size_t)idx >= V) idx = (int64_t)(V - 1);
    std::memcpy(out.data + b * D, weight + (size_t)idx * D, D * sizeof(float));
  }
}

// ─── BatchNorm2d ─────────────────────────────────────────────────────────
// in:  [B, C, H, W]  (we operate over H*W per (b, c))
// out: same

void batchnorm2d(const Tensor& in,
                 const float* gamma, const float* beta,
                 const float* running_mean, const float* running_var,
                 float eps, Tensor& out) {
  const size_t B = in.shape[0];
  const size_t C = in.shape[1];
  const size_t HW = in.shape[2] * in.shape[3];
  for (size_t b = 0; b < B; b++) {
    for (size_t c = 0; c < C; c++) {
      const float inv_std = 1.f / std::sqrt(running_var[c] + eps);
      const float scale = gamma[c] * inv_std;
      const float shift = beta[c] - running_mean[c] * scale;
      const float* in_chan = in.data + (b * C + c) * HW;
      float* out_chan = out.data + (b * C + c) * HW;
#ifdef __wasm_simd128__
      const v128_t vs = wasm_f32x4_splat(scale);
      const v128_t vb = wasm_f32x4_splat(shift);
      size_t i = 0;
      for (; i + 4 <= HW; i += 4) {
        v128_t v = wasm_v128_load(in_chan + i);
        v = wasm_f32x4_add(wasm_f32x4_mul(v, vs), vb);
        wasm_v128_store(out_chan + i, v);
      }
      for (; i < HW; i++) out_chan[i] = in_chan[i] * scale + shift;
#else
      for (size_t i = 0; i < HW; i++) out_chan[i] = in_chan[i] * scale + shift;
#endif
    }
  }
}

// ─── Conv2d 3x3 stride 1 padding 1 (no bias) ─────────────────────────────
//
// Maia's only conv shape. Naive implementation: loop over output positions,
// accumulate the 3x3 window from each input channel into each output channel.
// This is the "direct" form (no im2col); for the tiny board (8x8) it's
// efficient enough — no need for full BLAS GEMM.

void conv2d_3x3_s1_p1(const Tensor& in, const Tensor& weight, Tensor& out) {
  const size_t B    = in.shape[0];
  const size_t Cin  = in.shape[1];
  const size_t H    = in.shape[2];
  const size_t W    = in.shape[3];
  const size_t Cout = weight.shape[0];

  std::memset(out.data, 0, out.size * sizeof(float));

  for (size_t b = 0; b < B; b++) {
    for (size_t cout = 0; cout < Cout; cout++) {
      float* out_chan = out.data + ((b * Cout) + cout) * H * W;
      for (size_t cin = 0; cin < Cin; cin++) {
        const float* in_chan = in.data + ((b * Cin) + cin) * H * W;
        const float* k = weight.data + ((cout * Cin) + cin) * 9;  // 3x3
        for (size_t h = 0; h < H; h++) {
          for (size_t w = 0; w < W; w++) {
            float acc = 0.f;
            // Manually unrolled 3x3 with bounds check
            for (int dy = -1; dy <= 1; dy++) {
              const int yy = (int)h + dy;
              if (yy < 0 || yy >= (int)H) continue;
              for (int dx = -1; dx <= 1; dx++) {
                const int xx = (int)w + dx;
                if (xx < 0 || xx >= (int)W) continue;
                acc += in_chan[yy * W + xx] * k[(dy + 1) * 3 + (dx + 1)];
              }
            }
            out_chan[h * W + w] += acc;
          }
        }
      }
    }
  }
}

// ─── Batched matmul ──────────────────────────────────────────────────────
// A[B,H,M,K] @ B[B,H,K,N] = out[B,H,M,N]

void matmul_batched(const Tensor& A, const Tensor& B, Tensor& out) {
  const size_t b  = A.shape[0];
  const size_t h  = A.shape[1];
  const size_t M  = A.shape[2];
  const size_t K  = A.shape[3];
  const size_t N  = B.shape[3];
  for (size_t bi = 0; bi < b; bi++) {
    for (size_t hi = 0; hi < h; hi++) {
      const float* a_mat = A.data + ((bi * h + hi) * M) * K;
      const float* b_mat = B.data + ((bi * h + hi) * K) * N;
      float* o_mat = out.data + ((bi * h + hi) * M) * N;
      std::memset(o_mat, 0, M * N * sizeof(float));
      for (size_t m = 0; m < M; m++) {
        for (size_t k = 0; k < K; k++) {
          const float a_v = a_mat[m * K + k];
#ifdef __wasm_simd128__
          const v128_t va = wasm_f32x4_splat(a_v);
          size_t n = 0;
          for (; n + 4 <= N; n += 4) {
            v128_t vb = wasm_v128_load(b_mat + k * N + n);
            v128_t vo = wasm_v128_load(o_mat + m * N + n);
            vo = wasm_f32x4_add(vo, wasm_f32x4_mul(va, vb));
            wasm_v128_store(o_mat + m * N + n, vo);
          }
          for (; n < N; n++) o_mat[m * N + n] += a_v * b_mat[k * N + n];
#else
          for (size_t n = 0; n < N; n++) o_mat[m * N + n] += a_v * b_mat[k * N + n];
#endif
        }
      }
    }
  }
}

// ─── Transpose last two dims ─────────────────────────────────────────────

void transpose_last2(const Tensor& in, Tensor& out) {
  const size_t M = in.shape[in.rank - 2];
  const size_t N = in.shape[in.rank - 1];
  const size_t outer = in.size / (M * N);
  for (size_t o = 0; o < outer; o++) {
    const float* in_mat = in.data + o * M * N;
    float* out_mat = out.data + o * N * M;
    for (size_t m = 0; m < M; m++) {
      for (size_t n = 0; n < N; n++) {
        out_mat[n * M + m] = in_mat[m * N + n];
      }
    }
  }
}

// ─── In-place add and scale ──────────────────────────────────────────────

void add_(Tensor& a, const Tensor& b) {
  // Simple element-wise; assumes shapes match.
#ifdef __wasm_simd128__
  size_t i = 0;
  for (; i + 4 <= a.size; i += 4) {
    v128_t va = wasm_v128_load(a.data + i);
    v128_t vb = wasm_v128_load(b.data + i);
    wasm_v128_store(a.data + i, wasm_f32x4_add(va, vb));
  }
  for (; i < a.size; i++) a.data[i] += b.data[i];
#else
  for (size_t i = 0; i < a.size; i++) a.data[i] += b.data[i];
#endif
}

void scale_(Tensor& t, float s) {
#ifdef __wasm_simd128__
  size_t i = 0;
  const v128_t vs = wasm_f32x4_splat(s);
  for (; i + 4 <= t.size; i += 4) {
    v128_t v = wasm_v128_load(t.data + i);
    wasm_v128_store(t.data + i, wasm_f32x4_mul(v, vs));
  }
  for (; i < t.size; i++) t.data[i] *= s;
#else
  for (size_t i = 0; i < t.size; i++) t.data[i] *= s;
#endif
}

} // namespace ops
