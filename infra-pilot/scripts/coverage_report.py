#!/usr/bin/env python3
"""Generate a JSON coverage summary from a coverage.xml file."""

import json
import sys
from pathlib import Path

from coverage_lib import read_line_rate


def main(coverage_xml_path: str) -> None:
    """Parse the given coverage.xml and print a JSON summary with the coverage percentage."""
    line_rate = read_line_rate(Path(coverage_xml_path))
    if line_rate is None:
        print(f"Error reading coverage file: {coverage_xml_path}", file=sys.stderr)
        sys.exit(1)

    data = {"coverage": round(line_rate * 100.0, 2)}
    print(json.dumps(data))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <coverage.xml>", file=sys.stderr)
        sys.exit(2)
    main(sys.argv[1])
