#!/usr/bin/env bash
set -euo pipefail

PYTHON_EXE="${PYTHON_EXE:-python3}"
CLEAN=0
TARGET_ARCH="$("$PYTHON_EXE" -c 'import platform; print(platform.machine())')"

usage() {
  cat <<'EOF'
Usage: build-helper.sh [--clean] [--target-arch arm64|x86_64|universal2]

Build the ZoteroCopilot helper using the shared PyInstaller spec on macOS.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)
      CLEAN=1
      shift
      ;;
    --target-arch)
      TARGET_ARCH="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$TARGET_ARCH" in
  arm64|x86_64|universal2)
    ;;
  *)
    echo "Unsupported target architecture: $TARGET_ARCH" >&2
    exit 1
    ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SPEC_PATH="$ROOT/packaging/helper/zotero-mcp-helper.spec"

VERSION="$("$PYTHON_EXE" - <<'PY'
from pathlib import Path
import re

text = Path("src/zotero_mcp/_version.py").read_text(encoding="utf-8")
match = re.search(r'__version__\s*=\s*"([^"]+)"', text)
if not match:
    raise SystemExit("Could not read version from src/zotero_mcp/_version.py")
print(match.group(1))
PY
)"

PRODUCT_NAME="zotero_copilot_${VERSION}_helper_macos_${TARGET_ARCH}"

run_step() {
  local label="$1"
  shift
  echo "==> $label"
  "$PYTHON_EXE" "$@"
}

cd "$ROOT"

run_step "Installing packaging backends" -m pip install hatchling editables
run_step "Installing build dependencies" -m pip install --no-build-isolation -e ".[build]"

export PYINSTALLER_TARGET_ARCH="$TARGET_ARCH"
export PYINSTALLER_PRODUCT_NAME="$PRODUCT_NAME"

PYI_ARGS=(-m PyInstaller --noconfirm)
if [[ "$CLEAN" -eq 1 ]]; then
  PYI_ARGS+=(--clean)
fi
PYI_ARGS+=("$SPEC_PATH")

run_step "Running PyInstaller" "${PYI_ARGS[@]}"
run_step \
  "Creating public release archive" \
  "$ROOT/packaging/helper/build_release.py" \
  --platform \
  macos \
  --source-dir \
  "$ROOT/dist/$PRODUCT_NAME" \
  --output-dir \
  "$ROOT/dist/releases"

echo
echo "Build completed."
echo "Output directory: $ROOT/dist/$PRODUCT_NAME"
echo "Release archive: $ROOT/dist/releases/${PRODUCT_NAME}.tar.gz"
