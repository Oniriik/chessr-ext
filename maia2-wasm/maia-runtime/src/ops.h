#pragma once

#include "tensor.h"

// All ops are out-of-place: caller passes the destination tensor.
// Shapes documented in comments — the caller is responsible for sizing.

namespace ops {

// Linear: out[B,O] = in[B,I] @ weight[I,O] + (bias ? bias[O] : 0)
void linear(const Tensor& in, const Tensor& weight, const Tensor* bias,
            Tensor& out);

// Element-wise activations
void relu_(Tensor& t);                       // in-place
void gelu_(Tensor& t);                       // in-place, tanh approximation

// LayerNorm over last dim:
//   For each row, normalize to mean=0 var=1, then * gamma + beta.
//   eps standard 1e-5.
void layernorm(const Tensor& in, const Tensor& gamma, const Tensor& beta,
               float eps, Tensor& out);

// Softmax over last dim, in-place.
void softmax_lastdim_(Tensor& t);

// Embedding lookup: weight[V,D], indices[B], out[B,D].
void embedding(const float* weight, size_t V, size_t D,
               const int64_t* indices, size_t B,
               Tensor& out);

// BatchNorm2d: in/out [B,C,H,W]; per-channel scale/shift after
// (in - mean) / sqrt(var + eps).
void batchnorm2d(const Tensor& in,
                 const float* gamma, const float* beta,
                 const float* running_mean, const float* running_var,
                 float eps, Tensor& out);

// Conv2d (3x3, stride 1, padding 1, no bias) — Maia's only conv shape.
//   in:     [B, Cin, H, W]
//   weight: [Cout, Cin, 3, 3]
//   out:    [B, Cout, H, W]
void conv2d_3x3_s1_p1(const Tensor& in, const Tensor& weight, Tensor& out);

// Matmul (4D batched): A[B,H,M,K] @ B[B,H,K,N] = out[B,H,M,N]
void matmul_batched(const Tensor& A, const Tensor& B, Tensor& out);

// Transpose last two dims: [..., M, N] -> [..., N, M]
void transpose_last2(const Tensor& in, Tensor& out);

// Add in-place: a += b (broadcast over batch dims allowed if shapes match
// after squeeze-1).
void add_(Tensor& a, const Tensor& b);

// Multiply by scalar in-place.
void scale_(Tensor& t, float s);

} // namespace ops
