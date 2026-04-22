#pragma once

#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cassert>

// Minimal fp32 tensor — flat row-major, owns or borrows its storage.
// Maia 2 uses fixed shapes throughout the forward pass (we know cfg at
// compile time once the model is loaded), so dynamic-shape gymnastics
// from generic frameworks aren't needed.
struct Tensor {
  float*  data;
  size_t  size;        // total element count
  size_t  shape[4];    // up to 4 dims; trailing dims = 1 if rank < 4
  uint8_t rank;
  uint8_t owned;       // 1 = free(data) on destruction

  static Tensor borrow(float* d, size_t s0, size_t s1 = 1, size_t s2 = 1, size_t s3 = 1) {
    Tensor t{};
    t.data = d;
    t.shape[0] = s0; t.shape[1] = s1; t.shape[2] = s2; t.shape[3] = s3;
    t.rank = (s3 > 1 ? 4 : (s2 > 1 ? 3 : (s1 > 1 ? 2 : 1)));
    t.size = s0 * s1 * s2 * s3;
    t.owned = 0;
    return t;
  }

  static Tensor alloc(size_t s0, size_t s1 = 1, size_t s2 = 1, size_t s3 = 1) {
    Tensor t = borrow(nullptr, s0, s1, s2, s3);
    t.data = (float*)aligned_alloc(64, ((t.size * sizeof(float) + 63) / 64) * 64);
    t.owned = 1;
    std::memset(t.data, 0, t.size * sizeof(float));
    return t;
  }

  void release() {
    if (owned && data) { free(data); data = nullptr; owned = 0; }
  }
};
