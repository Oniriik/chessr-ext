"""
Dump python-chess's POLYGLOT_RANDOM_ARRAY (the standard Polyglot Zobrist table)
as a 781 × uint64 big-endian binary file. Loaded by the JS PolyglotBook impl.
"""

import struct
from pathlib import Path

import chess.polyglot

ROOT = Path(__file__).parent.resolve()
out_path = ROOT / "models" / "polyglot_zobrist.bin"

table = chess.polyglot.POLYGLOT_RANDOM_ARRAY
assert len(table) == 781, f"unexpected table length: {len(table)}"

with open(out_path, "wb") as f:
    for v in table:
        f.write(struct.pack(">Q", v))   # big-endian uint64

print(f"wrote {out_path} ({out_path.stat().st_size} bytes, {len(table)} entries)")
