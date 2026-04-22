#pragma once

#include "tensor.h"
#include <cstdint>

// Maia 2 model config (matches the official config.yaml shipped with each
// pretrained .onnx). All values fixed at build time — we pre-allocate
// activation buffers accordingly.
namespace maia {

constexpr size_t INPUT_CHANNELS  = 18;
constexpr size_t DIM_CNN         = 256;
constexpr size_t DIM_VIT         = 1024;
constexpr size_t NUM_BLOCKS_CNN  = 5;
constexpr size_t NUM_BLOCKS_VIT  = 2;
constexpr size_t VIT_LENGTH      = 8;
constexpr size_t ELO_DIM         = 128;
constexpr size_t HEADS           = 16;
constexpr size_t DIM_HEAD        = 64;
constexpr size_t INNER_DIM       = HEADS * DIM_HEAD; // 1024
constexpr size_t NUM_MOVES       = 1880;
constexpr size_t NUM_ELO_BUCKETS = 11;

constexpr float LAYERNORM_EPS = 1e-5f;
constexpr float BATCHNORM_EPS = 1e-5f;

// Side info head dims: NUM_MOVES + 6 + 6 + 1 + 64 + 64 = 2021 (we don't use it
// but it's part of the graph; we skip computing it entirely).

// Indexed view into the loaded weights blob. Each pointer is offset into
// the contiguous fp32 buffer that was extracted from the .onnx by the
// Python `extract_weights.py` script.
struct ModelWeights {
  // ChessResNet
  const float* cnn_conv1_w;        // [DIM_CNN, INPUT_CHANNELS, 3, 3]
  const float* cnn_bn1_g;          // [DIM_CNN]
  const float* cnn_bn1_b;
  const float* cnn_bn1_rm;
  const float* cnn_bn1_rv;

  struct {
    const float* conv1_w;          // [DIM_CNN, DIM_CNN, 3, 3]
    const float* bn1_g, *bn1_b, *bn1_rm, *bn1_rv;
    const float* conv2_w;
    const float* bn2_g, *bn2_b, *bn2_rm, *bn2_rv;
  } cnn_blocks[NUM_BLOCKS_CNN];

  const float* cnn_conv_last_w;    // [VIT_LENGTH, DIM_CNN, 3, 3]
  const float* cnn_bn_last_g;      // [VIT_LENGTH]
  const float* cnn_bn_last_b;
  const float* cnn_bn_last_rm;
  const float* cnn_bn_last_rv;

  // Patch embedding: [DIM_VIT, 64] linear + LayerNorm [DIM_VIT]
  const float* patch_w;            // [64, DIM_VIT] (we store transposed)
  const float* patch_b;            // [DIM_VIT]
  const float* patch_ln_g;
  const float* patch_ln_b;

  // pos_embedding [VIT_LENGTH, DIM_VIT]
  const float* pos_emb;

  // Elo embedding [NUM_ELO_BUCKETS, ELO_DIM]
  const float* elo_emb;

  // Transformer blocks
  struct {
    // Attention
    const float* attn_norm_g, *attn_norm_b;          // [DIM_VIT]
    const float* attn_qkv_w;                          // [DIM_VIT, INNER_DIM*3]
    const float* attn_elo_query_w;                    // [ELO_DIM*2, INNER_DIM]
    const float* attn_to_out_w, *attn_to_out_b;       // [INNER_DIM, DIM_VIT], [DIM_VIT]
    // FFN
    const float* ffn_ln_g, *ffn_ln_b;                 // [DIM_VIT]
    const float* ffn_fc1_w, *ffn_fc1_b;               // [DIM_VIT, MLP_DIM=DIM_VIT], [DIM_VIT]
    const float* ffn_fc2_w, *ffn_fc2_b;               // [MLP_DIM, DIM_VIT], [DIM_VIT]
  } vit_blocks[NUM_BLOCKS_VIT];

  // Transformer outer LN (applied after all blocks, before mean pool)
  const float* transformer_ln_g, *transformer_ln_b;

  // Final LN + heads
  const float* last_ln_g, *last_ln_b;
  const float* fc_1_w, *fc_1_b;        // [DIM_VIT, NUM_MOVES]
  const float* fc_3_1_w, *fc_3_1_b;    // [DIM_VIT, 128]
  const float* fc_3_w, *fc_3_b;        // [128, 1]
};

// Load weights from a flat fp32 binary file into a ModelWeights struct.
// Returns the total size consumed, or 0 on size mismatch.
size_t load_weights(const float* blob, size_t blob_floats, ModelWeights& out);

// Forward pass.
//   board:   [INPUT_CHANNELS, 8, 8] = 1152 floats
//   elo_self / elo_oppo: scalar bucket indices in [0, NUM_ELO_BUCKETS)
//   logits_out: [NUM_MOVES] (1880)
//   value_out:  scalar in [-1, 1] before clamp; caller does (v/2 + 0.5)
//
// Returns true on success.
bool forward(const ModelWeights& w,
             const float* board,
             int64_t elo_self, int64_t elo_oppo,
             float* logits_out,
             float* value_out);

} // namespace maia
