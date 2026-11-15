#!/usr/bin/env python3
"""Generate tests/fixtures/colour/srgb-lab-reference.json.

An independent oracle for the sRGB -> CIELAB conversion in src/lib/colour: the numbers come from the
colour-science package, not from our code and not from memory. See tests/fixtures/colour/README.md.

Regenerate (exact command, pinned version):

    python -m venv .venv-colour
    .venv-colour/bin/python -m pip install colour-science==0.4.7   # Windows: .venv-colour\\Scripts\\python.exe
    .venv-colour/bin/python scripts/gen-lab-reference.py

Output is deterministic: the colour list is fixed and the "random" colours use a fixed seed.
"""

import json
import platform
import random
import re
import sys
from importlib.metadata import version
from pathlib import Path

import colour
import numpy as np

PINNED_VERSION = "0.4.7"
SEED = 2026
RANDOM_COUNT = 30
OBSERVER = "CIE 1931 2 Degree Standard Observer"
ILLUMINANT = "D65"
COMMAND = "python scripts/gen-lab-reference.py"
OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "colour" / "srgb-lab-reference.json"

PRIMARIES_AND_SECONDARIES = [
    ("red", (255, 0, 0)),
    ("green", (0, 255, 0)),
    ("blue", (0, 0, 255)),
    ("cyan", (0, 255, 255)),
    ("magenta", (255, 0, 255)),
    ("yellow", (255, 255, 0)),
]
BLACK_WHITE = [("black", (0, 0, 0)), ("white", (255, 255, 255))]
GREYS = [(f"grey-{v}", (v, v, v)) for v in (32, 64, 128, 192, 224)]


def colour_list():
    rng = random.Random(SEED)
    randoms = [
        (f"random-{i + 1:02d}", (rng.randint(0, 255), rng.randint(0, 255), rng.randint(0, 255)))
        for i in range(RANDOM_COUNT)
    ]
    return PRIMARIES_AND_SECONDARIES + BLACK_WHITE + GREYS + randoms


def main():
    installed = version("colour-science")
    if installed != PINNED_VERSION:
        sys.exit(f"colour-science {PINNED_VERSION} is required, found {installed}")

    white_xy = colour.CCS_ILLUMINANTS[OBSERVER][ILLUMINANT]
    entries = []
    for name, rgb in colour_list():
        # sRGB 8-bit -> [0, 1], then the library's sRGB -> XYZ (D65) -> CIE Lab with the same D65 white.
        xyz = colour.sRGB_to_XYZ(np.array(rgb) / 255.0, illuminant=white_xy)
        lab = colour.XYZ_to_Lab(xyz, illuminant=white_xy)
        entries.append({"name": name, "rgb": list(rgb), "lab": [round(float(v), 6) for v in lab]})

    document = {
        "description": "sRGB (8-bit) to CIELAB under D65, 2 degree observer. Generated, do not edit by hand.",
        "source": {
            "package": "colour-science",
            "version": installed,
            "numpy": version("numpy"),
            "python": platform.python_version(),
            "command": COMMAND,
            "script": "scripts/gen-lab-reference.py",
        },
        "illuminant": ILLUMINANT,
        "observer": OBSERVER,
        "randomSeed": SEED,
        "colours": entries,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(document, indent=2)
    # Arrays on one line, so the file is stable under Prettier and diffs stay readable.
    text = re.sub(r"\[\s*(-?\d[^\[\]{}\"]*?)\s*\]", lambda m: "[" + re.sub(r"\s+", " ", m.group(1)) + "]", text)
    # newline="\n": identical bytes on every OS (write_text would write CRLF on Windows).
    with OUT.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text + "\n")
    print(f"wrote {len(entries)} colours to {OUT}")


if __name__ == "__main__":
    main()
