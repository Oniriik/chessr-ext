import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Required for SharedArrayBuffer (multi-threaded WASM in onnxruntime-web).
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
});

app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, p) {
    if (p.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
    if (p.endsWith(".onnx")) res.setHeader("Content-Type", "application/octet-stream");
  },
}));

// Serve the exported ONNX models from the python output dir.
app.use("/models", express.static(path.join(__dirname, "..", "python", "models")));

const port = process.env.PORT || 5173;
app.listen(port, () => {
  console.log(`maia2-wasm demo  →  http://localhost:${port}`);
});
