#!/usr/bin/env bash
# 在 Ubuntu 上打包 Auth Service
#
# 用法（仓库根目录）：
#   ./build/build-auth.sh <version>
# 例：
#   ./build/build-auth.sh 1.0.0
#
# 产物：
#   build/release/<version>/auth-server

set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "usage: $0 <version>" >&2
  echo "example: $0 1.0.0" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVC="$ROOT/auth-service"
OUT="$ROOT/build/release/$VERSION"

if [[ ! -d "$SVC" ]]; then
  echo "error: auth-service not found at $SVC" >&2
  exit 1
fi

if ! command -v go >/dev/null 2>&1; then
  echo "error: go is not installed or not in PATH" >&2
  exit 1
fi

mkdir -p "$OUT"
cd "$SVC"

export CGO_ENABLED=0
# Ubuntu 本机编译 → linux 二进制；固定 amd64 便于服务器部署
export GOOS="${GOOS:-linux}"
export GOARCH="${GOARCH:-amd64}"

echo "[build] version=$VERSION go=$(go version) GOOS=$GOOS GOARCH=$GOARCH"
go build -trimpath -ldflags="-s -w" -o "$OUT/auth-server" ./cmd/server

chmod +x "$OUT/auth-server"
echo "OK: $OUT/auth-server"
ls -lh "$OUT/auth-server"
