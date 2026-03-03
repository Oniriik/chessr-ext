#!/bin/bash
# Launch Chessr Maia-2 wrapper
cd "$(dirname "$0")"

# Setup venv if first run
if [ ! -d "venv" ]; then
    echo "First run — setting up environment..."
    pyenv local 3.11.6 2>/dev/null
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt rumps >/dev/null 2>&1
    echo "Setup complete."
else
    source venv/bin/activate
fi

# Check model exists
if [ ! -f "model.onnx" ]; then
    echo "Error: model.onnx not found."
    echo "Run: pip install -r requirements-build.txt && python -m scripts.export_onnx"
    exit 1
fi

python -m src.main
