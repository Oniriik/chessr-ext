#include "model.h"
#include "ops.h"

#include <cstring>
#include <cmath>

namespace maia {

// ─── Weight-blob layout ───────────────────────────────────────────────────
//
// `extract_weights.py` produces a single fp32 blob with tensors written in a
// fixed order. `load_weights` walks the blob and stores pointers into the
// ModelWeights struct. Order MUST match the Python script verbatim.

static inline const float* take(const float*& p, size_t n) {
  const float* r = p; p += n; return r;
}

size_t load_weights(const float* blob, size_t blob_floats, ModelWeights& w) {
  const float* p = blob;
  const float* end = blob + blob_floats;

  // ChessResNet — input conv
  w.cnn_conv1_w = take(p, DIM_CNN * INPUT_CHANNELS * 9);
  w.cnn_bn1_g   = take(p, DIM_CNN);
  w.cnn_bn1_b   = take(p, DIM_CNN);
  w.cnn_bn1_rm  = take(p, DIM_CNN);
  w.cnn_bn1_rv  = take(p, DIM_CNN);

  // 5 ResNet blocks
  for (size_t i = 0; i < NUM_BLOCKS_CNN; i++) {
    w.cnn_blocks[i].conv1_w = take(p, DIM_CNN * DIM_CNN * 9);
    w.cnn_blocks[i].bn1_g   = take(p, DIM_CNN);
    w.cnn_blocks[i].bn1_b   = take(p, DIM_CNN);
    w.cnn_blocks[i].bn1_rm  = take(p, DIM_CNN);
    w.cnn_blocks[i].bn1_rv  = take(p, DIM_CNN);
    w.cnn_blocks[i].conv2_w = take(p, DIM_CNN * DIM_CNN * 9);
    w.cnn_blocks[i].bn2_g   = take(p, DIM_CNN);
    w.cnn_blocks[i].bn2_b   = take(p, DIM_CNN);
    w.cnn_blocks[i].bn2_rm  = take(p, DIM_CNN);
    w.cnn_blocks[i].bn2_rv  = take(p, DIM_CNN);
  }

  // ChessResNet — output conv (DIM_CNN -> VIT_LENGTH)
  w.cnn_conv_last_w = take(p, VIT_LENGTH * DIM_CNN * 9);
  w.cnn_bn_last_g   = take(p, VIT_LENGTH);
  w.cnn_bn_last_b   = take(p, VIT_LENGTH);
  w.cnn_bn_last_rm  = take(p, VIT_LENGTH);
  w.cnn_bn_last_rv  = take(p, VIT_LENGTH);

  // Patch embedding (8*8 -> DIM_VIT) + LN
  w.patch_w    = take(p, 64 * DIM_VIT);
  w.patch_b    = take(p, DIM_VIT);
  w.patch_ln_g = take(p, DIM_VIT);
  w.patch_ln_b = take(p, DIM_VIT);

  // Positional embedding [VIT_LENGTH, DIM_VIT]
  w.pos_emb = take(p, VIT_LENGTH * DIM_VIT);

  // Elo embedding [NUM_ELO_BUCKETS, ELO_DIM]
  w.elo_emb = take(p, NUM_ELO_BUCKETS * ELO_DIM);

  // 2 transformer blocks
  for (size_t i = 0; i < NUM_BLOCKS_VIT; i++) {
    auto& b = w.vit_blocks[i];
    // Attention
    b.attn_norm_g       = take(p, DIM_VIT);
    b.attn_norm_b       = take(p, DIM_VIT);
    b.attn_qkv_w        = take(p, DIM_VIT * INNER_DIM * 3);
    b.attn_elo_query_w  = take(p, (ELO_DIM * 2) * INNER_DIM);
    b.attn_to_out_w     = take(p, INNER_DIM * DIM_VIT);
    b.attn_to_out_b     = take(p, DIM_VIT);
    // FFN (LN inside)
    b.ffn_ln_g  = take(p, DIM_VIT);
    b.ffn_ln_b  = take(p, DIM_VIT);
    b.ffn_fc1_w = take(p, DIM_VIT * DIM_VIT);   // mlp_dim = DIM_VIT
    b.ffn_fc1_b = take(p, DIM_VIT);
    b.ffn_fc2_w = take(p, DIM_VIT * DIM_VIT);
    b.ffn_fc2_b = take(p, DIM_VIT);
  }

  // Transformer outer LN (applied after all blocks, before mean pool)
  w.transformer_ln_g = take(p, DIM_VIT);
  w.transformer_ln_b = take(p, DIM_VIT);

  // Final LN + heads
  w.last_ln_g = take(p, DIM_VIT);
  w.last_ln_b = take(p, DIM_VIT);
  w.fc_1_w    = take(p, DIM_VIT * NUM_MOVES);
  w.fc_1_b    = take(p, NUM_MOVES);
  w.fc_3_1_w  = take(p, DIM_VIT * 128);
  w.fc_3_1_b  = take(p, 128);
  w.fc_3_w    = take(p, 128 * 1);
  w.fc_3_b    = take(p, 1);

  if (p > end) return 0;
  return (size_t)(p - blob);
}

// ─── Activation buffers (B=1) ────────────────────────────────────────────
// All shapes fixed at compile time. Allocated once at first call.

namespace {

struct Activations {
  Tensor cnn_in;          // [1, INPUT_CHANNELS, 8, 8]
  Tensor cnn_a;           // [1, DIM_CNN, 8, 8]
  Tensor cnn_b;           // [1, DIM_CNN, 8, 8] residual buffer
  Tensor cnn_out;         // [1, VIT_LENGTH, 8, 8]
  Tensor patch_in;        // [VIT_LENGTH, 64]
  Tensor patch_out;       // [VIT_LENGTH, DIM_VIT]
  Tensor x;               // [VIT_LENGTH, DIM_VIT]  (running through transformer)
  Tensor x_skip;          // [VIT_LENGTH, DIM_VIT]
  Tensor norm_x;          // [VIT_LENGTH, DIM_VIT]
  Tensor qkv;             // [VIT_LENGTH, INNER_DIM*3]
  Tensor q;               // [HEADS, VIT_LENGTH, DIM_HEAD]
  Tensor k;
  Tensor v;
  Tensor k_t;             // [HEADS, DIM_HEAD, VIT_LENGTH]
  Tensor dots;            // [HEADS, VIT_LENGTH, VIT_LENGTH]
  Tensor attn_out;        // [HEADS, VIT_LENGTH, DIM_HEAD]
  Tensor attn_concat;     // [VIT_LENGTH, INNER_DIM]
  Tensor attn_proj;       // [VIT_LENGTH, DIM_VIT]
  Tensor ffn_h;           // [VIT_LENGTH, DIM_VIT]
  Tensor mean_pool;       // [DIM_VIT]
  Tensor head_in;         // [1, DIM_VIT]
  Tensor logits;          // [NUM_MOVES]
  Tensor val_h;           // [128]
  Tensor val_out;         // [1]
  Tensor elo_concat;      // [ELO_DIM*2]
  Tensor elo_effect;      // [HEADS, 1, DIM_HEAD]
  bool   inited;
};

Activations& acts() {
  static Activations a{};
  if (!a.inited) {
    a.cnn_in       = Tensor::alloc(1, INPUT_CHANNELS, 8, 8);
    a.cnn_a        = Tensor::alloc(1, DIM_CNN, 8, 8);
    a.cnn_b        = Tensor::alloc(1, DIM_CNN, 8, 8);
    a.cnn_out      = Tensor::alloc(1, VIT_LENGTH, 8, 8);
    a.patch_in     = Tensor::alloc(VIT_LENGTH, 64);
    a.patch_out    = Tensor::alloc(VIT_LENGTH, DIM_VIT);
    a.x            = Tensor::alloc(VIT_LENGTH, DIM_VIT);
    a.x_skip       = Tensor::alloc(VIT_LENGTH, DIM_VIT);
    a.norm_x       = Tensor::alloc(VIT_LENGTH, DIM_VIT);
    a.qkv          = Tensor::alloc(VIT_LENGTH, INNER_DIM * 3);
    a.q            = Tensor::alloc(1, HEADS, VIT_LENGTH, DIM_HEAD);
    a.k            = Tensor::alloc(1, HEADS, VIT_LENGTH, DIM_HEAD);
    a.v            = Tensor::alloc(1, HEADS, VIT_LENGTH, DIM_HEAD);
    a.k_t          = Tensor::alloc(1, HEADS, DIM_HEAD, VIT_LENGTH);
    a.dots         = Tensor::alloc(1, HEADS, VIT_LENGTH, VIT_LENGTH);
    a.attn_out     = Tensor::alloc(1, HEADS, VIT_LENGTH, DIM_HEAD);
    a.attn_concat  = Tensor::alloc(VIT_LENGTH, INNER_DIM);
    a.attn_proj    = Tensor::alloc(VIT_LENGTH, DIM_VIT);
    a.ffn_h        = Tensor::alloc(VIT_LENGTH, DIM_VIT);
    a.mean_pool    = Tensor::alloc(DIM_VIT);
    a.head_in      = Tensor::alloc(1, DIM_VIT);
    a.logits       = Tensor::alloc(NUM_MOVES);
    a.val_h        = Tensor::alloc(1, 128);
    a.val_out      = Tensor::alloc(1, 1);
    a.elo_concat   = Tensor::alloc(ELO_DIM * 2);
    a.elo_effect   = Tensor::alloc(1, HEADS, 1, DIM_HEAD);
    a.inited = true;
  }
  return a;
}

} // namespace

// ─── Forward pass ────────────────────────────────────────────────────────

bool forward(const ModelWeights& w,
             const float* board,
             int64_t elo_self, int64_t elo_oppo,
             float* logits_out,
             float* value_out) {
  Activations& A = acts();

  // 1. Copy board input
  std::memcpy(A.cnn_in.data, board, INPUT_CHANNELS * 64 * sizeof(float));

  // 2. ChessResNet: conv1 → BN → ReLU → 5 BasicBlocks → conv_last → BN
  Tensor conv1_w = Tensor::borrow((float*)w.cnn_conv1_w, DIM_CNN, INPUT_CHANNELS, 3, 3);
  ops::conv2d_3x3_s1_p1(A.cnn_in, conv1_w, A.cnn_a);
  ops::batchnorm2d(A.cnn_a, w.cnn_bn1_g, w.cnn_bn1_b,
                   w.cnn_bn1_rm, w.cnn_bn1_rv, BATCHNORM_EPS, A.cnn_a);
  ops::relu_(A.cnn_a);

  for (size_t i = 0; i < NUM_BLOCKS_CNN; i++) {
    const auto& blk = w.cnn_blocks[i];
    // Save residual: cnn_a → cnn_b temporarily not needed since we add at end.
    // Strategy: compute into cnn_b, then add cnn_a, then swap.
    Tensor c1_w = Tensor::borrow((float*)blk.conv1_w, DIM_CNN, DIM_CNN, 3, 3);
    Tensor c2_w = Tensor::borrow((float*)blk.conv2_w, DIM_CNN, DIM_CNN, 3, 3);

    ops::conv2d_3x3_s1_p1(A.cnn_a, c1_w, A.cnn_b);
    ops::batchnorm2d(A.cnn_b, blk.bn1_g, blk.bn1_b, blk.bn1_rm, blk.bn1_rv,
                     BATCHNORM_EPS, A.cnn_b);
    ops::relu_(A.cnn_b);

    // Conv2 → BN
    Tensor cnn_b2 = Tensor::alloc(1, DIM_CNN, 8, 8);  // tmp; could reuse A.cnn_b's buffer
    ops::conv2d_3x3_s1_p1(A.cnn_b, c2_w, cnn_b2);
    ops::batchnorm2d(cnn_b2, blk.bn2_g, blk.bn2_b, blk.bn2_rm, blk.bn2_rv,
                     BATCHNORM_EPS, cnn_b2);
    // Residual + ReLU
    ops::add_(cnn_b2, A.cnn_a);
    ops::relu_(cnn_b2);
    std::memcpy(A.cnn_a.data, cnn_b2.data, A.cnn_a.size * sizeof(float));
    cnn_b2.release();
  }

  // conv_last + bn_last
  Tensor conv_last_w = Tensor::borrow((float*)w.cnn_conv_last_w, VIT_LENGTH, DIM_CNN, 3, 3);
  ops::conv2d_3x3_s1_p1(A.cnn_a, conv_last_w, A.cnn_out);
  ops::batchnorm2d(A.cnn_out, w.cnn_bn_last_g, w.cnn_bn_last_b,
                   w.cnn_bn_last_rm, w.cnn_bn_last_rv, BATCHNORM_EPS, A.cnn_out);

  // 3. Reshape [1, VIT_LENGTH, 8, 8] → [VIT_LENGTH, 64] (channel becomes patch)
  std::memcpy(A.patch_in.data, A.cnn_out.data, VIT_LENGTH * 64 * sizeof(float));

  // 4. Patch embedding: Linear(64, DIM_VIT) + LayerNorm(DIM_VIT)
  Tensor patch_w = Tensor::borrow((float*)w.patch_w, 64, DIM_VIT);
  Tensor patch_b = Tensor::borrow((float*)w.patch_b, DIM_VIT);
  ops::linear(A.patch_in, patch_w, &patch_b, A.patch_out);
  Tensor ln_g = Tensor::borrow((float*)w.patch_ln_g, DIM_VIT);
  Tensor ln_b = Tensor::borrow((float*)w.patch_ln_b, DIM_VIT);
  ops::layernorm(A.patch_out, ln_g, ln_b, LAYERNORM_EPS, A.x);

  // 5. Add positional embedding
  Tensor pos = Tensor::borrow((float*)w.pos_emb, VIT_LENGTH, DIM_VIT);
  ops::add_(A.x, pos);

  // 6. Build elo_concat = [elo_self_emb || elo_oppo_emb]
  if (elo_self < 0) elo_self = 0;
  if (elo_oppo < 0) elo_oppo = 0;
  if ((size_t)elo_self >= NUM_ELO_BUCKETS) elo_self = NUM_ELO_BUCKETS - 1;
  if ((size_t)elo_oppo >= NUM_ELO_BUCKETS) elo_oppo = NUM_ELO_BUCKETS - 1;
  std::memcpy(A.elo_concat.data,           w.elo_emb + elo_self * ELO_DIM, ELO_DIM * sizeof(float));
  std::memcpy(A.elo_concat.data + ELO_DIM, w.elo_emb + elo_oppo * ELO_DIM, ELO_DIM * sizeof(float));
  A.elo_concat.shape[0] = 1;
  A.elo_concat.shape[1] = ELO_DIM * 2;
  A.elo_concat.rank = 2;

  // 7. Transformer blocks
  const float scale = 1.0f / std::sqrt((float)DIM_HEAD);
  for (size_t i = 0; i < NUM_BLOCKS_VIT; i++) {
    const auto& blk = w.vit_blocks[i];

    // ── Attention sub-block ──
    // Save x as residual
    std::memcpy(A.x_skip.data, A.x.data, A.x.size * sizeof(float));

    // norm_x = LN(x)
    Tensor an_g = Tensor::borrow((float*)blk.attn_norm_g, DIM_VIT);
    Tensor an_b = Tensor::borrow((float*)blk.attn_norm_b, DIM_VIT);
    ops::layernorm(A.x, an_g, an_b, LAYERNORM_EPS, A.norm_x);

    // qkv = norm_x @ to_qkv  ([VIT_LENGTH, INNER_DIM*3])
    Tensor qkv_w = Tensor::borrow((float*)blk.attn_qkv_w, DIM_VIT, INNER_DIM * 3);
    ops::linear(A.norm_x, qkv_w, nullptr, A.qkv);

    // Split + reshape: q/k/v each [HEADS, VIT_LENGTH, DIM_HEAD]
    // Source layout: A.qkv[n][h*DIM_HEAD + d_or_offset]; we extract per-head.
    for (size_t n = 0; n < VIT_LENGTH; n++) {
      const float* src = A.qkv.data + n * (INNER_DIM * 3);
      for (size_t h = 0; h < HEADS; h++) {
        std::memcpy(A.q.data + (h * VIT_LENGTH + n) * DIM_HEAD,
                    src + h * DIM_HEAD, DIM_HEAD * sizeof(float));
        std::memcpy(A.k.data + (h * VIT_LENGTH + n) * DIM_HEAD,
                    src + INNER_DIM + h * DIM_HEAD, DIM_HEAD * sizeof(float));
        std::memcpy(A.v.data + (h * VIT_LENGTH + n) * DIM_HEAD,
                    src + INNER_DIM * 2 + h * DIM_HEAD, DIM_HEAD * sizeof(float));
      }
    }

    // elo_effect = elo_concat @ elo_query_w → [INNER_DIM] → reshape [HEADS, 1, DIM_HEAD]
    Tensor elo_query_w = Tensor::borrow((float*)blk.attn_elo_query_w, ELO_DIM * 2, INNER_DIM);
    Tensor tmp_eff = Tensor::alloc(1, INNER_DIM);
    ops::linear(A.elo_concat, elo_query_w, nullptr, tmp_eff);
    // Expand elo_effect into [HEADS, 1, DIM_HEAD] shape mapped to A.elo_effect
    for (size_t h = 0; h < HEADS; h++) {
      std::memcpy(A.elo_effect.data + h * DIM_HEAD,
                  tmp_eff.data + h * DIM_HEAD,
                  DIM_HEAD * sizeof(float));
    }
    tmp_eff.release();

    // q += elo_effect (broadcast over n)
    for (size_t h = 0; h < HEADS; h++) {
      for (size_t n = 0; n < VIT_LENGTH; n++) {
        float* qrow = A.q.data + (h * VIT_LENGTH + n) * DIM_HEAD;
        const float* erow = A.elo_effect.data + h * DIM_HEAD;
        for (size_t d = 0; d < DIM_HEAD; d++) qrow[d] += erow[d];
      }
    }

    // dots = q @ k^T * scale  ([HEADS, VIT_LENGTH, VIT_LENGTH])
    A.k.shape[0] = 1; A.k.shape[1] = HEADS; A.k.shape[2] = VIT_LENGTH; A.k.shape[3] = DIM_HEAD; A.k.rank = 4;
    A.k_t.shape[0] = 1; A.k_t.shape[1] = HEADS; A.k_t.shape[2] = DIM_HEAD; A.k_t.shape[3] = VIT_LENGTH; A.k_t.rank = 4;
    ops::transpose_last2(A.k, A.k_t);
    A.q.shape[0] = 1; A.q.shape[1] = HEADS; A.q.shape[2] = VIT_LENGTH; A.q.shape[3] = DIM_HEAD; A.q.rank = 4;
    A.dots.shape[0] = 1; A.dots.shape[1] = HEADS; A.dots.shape[2] = VIT_LENGTH; A.dots.shape[3] = VIT_LENGTH; A.dots.rank = 4;
    ops::matmul_batched(A.q, A.k_t, A.dots);
    ops::scale_(A.dots, scale);

    // attn = softmax(dots, dim=-1)
    ops::softmax_lastdim_(A.dots);

    // attn_out = attn @ v  ([HEADS, VIT_LENGTH, DIM_HEAD])
    A.v.shape[0] = 1; A.v.shape[1] = HEADS; A.v.shape[2] = VIT_LENGTH; A.v.shape[3] = DIM_HEAD; A.v.rank = 4;
    A.attn_out.shape[0] = 1; A.attn_out.shape[1] = HEADS; A.attn_out.shape[2] = VIT_LENGTH; A.attn_out.shape[3] = DIM_HEAD; A.attn_out.rank = 4;
    ops::matmul_batched(A.dots, A.v, A.attn_out);

    // Reshape [HEADS, VIT_LENGTH, DIM_HEAD] → [VIT_LENGTH, INNER_DIM]
    for (size_t n = 0; n < VIT_LENGTH; n++) {
      for (size_t h = 0; h < HEADS; h++) {
        std::memcpy(A.attn_concat.data + n * INNER_DIM + h * DIM_HEAD,
                    A.attn_out.data + (h * VIT_LENGTH + n) * DIM_HEAD,
                    DIM_HEAD * sizeof(float));
      }
    }

    // attn_proj = attn_concat @ to_out_w + to_out_b
    Tensor to_out_w = Tensor::borrow((float*)blk.attn_to_out_w, INNER_DIM, DIM_VIT);
    Tensor to_out_b = Tensor::borrow((float*)blk.attn_to_out_b, DIM_VIT);
    ops::linear(A.attn_concat, to_out_w, &to_out_b, A.attn_proj);

    // x = attn_proj + skip
    ops::add_(A.attn_proj, A.x_skip);
    std::memcpy(A.x.data, A.attn_proj.data, A.x.size * sizeof(float));

    // ── FFN sub-block: x = x + FFN(x) ──
    std::memcpy(A.x_skip.data, A.x.data, A.x.size * sizeof(float));
    Tensor fn_g = Tensor::borrow((float*)blk.ffn_ln_g, DIM_VIT);
    Tensor fn_b = Tensor::borrow((float*)blk.ffn_ln_b, DIM_VIT);
    ops::layernorm(A.x, fn_g, fn_b, LAYERNORM_EPS, A.norm_x);

    Tensor f1_w = Tensor::borrow((float*)blk.ffn_fc1_w, DIM_VIT, DIM_VIT);
    Tensor f1_b = Tensor::borrow((float*)blk.ffn_fc1_b, DIM_VIT);
    ops::linear(A.norm_x, f1_w, &f1_b, A.ffn_h);
    ops::gelu_(A.ffn_h);

    Tensor f2_w = Tensor::borrow((float*)blk.ffn_fc2_w, DIM_VIT, DIM_VIT);
    Tensor f2_b = Tensor::borrow((float*)blk.ffn_fc2_b, DIM_VIT);
    ops::linear(A.ffn_h, f2_w, &f2_b, A.norm_x);

    ops::add_(A.norm_x, A.x_skip);
    std::memcpy(A.x.data, A.norm_x.data, A.x.size * sizeof(float));
  }

  // 8. Transformer outer LayerNorm (applied AFTER all blocks, BEFORE mean pool)
  Tensor t_ln_g = Tensor::borrow((float*)w.transformer_ln_g, DIM_VIT);
  Tensor t_ln_b = Tensor::borrow((float*)w.transformer_ln_b, DIM_VIT);
  ops::layernorm(A.x, t_ln_g, t_ln_b, LAYERNORM_EPS, A.x);

  // 9. Mean pool over VIT_LENGTH tokens
  std::memset(A.mean_pool.data, 0, DIM_VIT * sizeof(float));
  for (size_t n = 0; n < VIT_LENGTH; n++) {
    for (size_t d = 0; d < DIM_VIT; d++) {
      A.mean_pool.data[d] += A.x.data[n * DIM_VIT + d];
    }
  }
  for (size_t d = 0; d < DIM_VIT; d++) A.mean_pool.data[d] /= (float)VIT_LENGTH;

  // 10. last_ln
  Tensor last_g = Tensor::borrow((float*)w.last_ln_g, DIM_VIT);
  Tensor last_b = Tensor::borrow((float*)w.last_ln_b, DIM_VIT);
  Tensor mean_pool_view = Tensor::borrow(A.mean_pool.data, 1, DIM_VIT);
  ops::layernorm(mean_pool_view, last_g, last_b, LAYERNORM_EPS, A.head_in);

  // 11. logits_maia = head_in @ fc_1 + b
  Tensor fc1_w = Tensor::borrow((float*)w.fc_1_w, DIM_VIT, NUM_MOVES);
  Tensor fc1_b = Tensor::borrow((float*)w.fc_1_b, NUM_MOVES);
  Tensor logits_view = Tensor::borrow(logits_out, 1, NUM_MOVES);
  ops::linear(A.head_in, fc1_w, &fc1_b, logits_view);

  // 12. value head: relu(fc_3_1) → fc_3 → squeeze
  Tensor fc31_w = Tensor::borrow((float*)w.fc_3_1_w, DIM_VIT, 128);
  Tensor fc31_b = Tensor::borrow((float*)w.fc_3_1_b, 128);
  ops::linear(A.head_in, fc31_w, &fc31_b, A.val_h);
  ops::relu_(A.val_h);

  Tensor fc3_w = Tensor::borrow((float*)w.fc_3_w, 128, 1);
  Tensor fc3_b = Tensor::borrow((float*)w.fc_3_b, 1);
  ops::linear(A.val_h, fc3_w, &fc3_b, A.val_out);

  *value_out = A.val_out.data[0];
  return true;
}

} // namespace maia
