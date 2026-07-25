#!/usr/bin/env bash
# 将已编译的 Auth Service 打成 Alpine Docker 镜像
#
# 用法（仓库根目录）：
#   ./build/docker-build-auth.sh <version> [image_name]
# 例：
#   ./build/docker-build-auth.sh 1.0.0
#   ./build/docker-build-auth.sh 1.0.0 myreg/gushi-auth
#
# 前置：
#   ./build/build-auth.sh <version>

set -euo pipefail

VERSION="${1:-}"
IMAGE_NAME="${2:-gushi-auth}"
if [[ -z "$VERSION" ]]; then
  echo "usage: $0 <version> [image_name]" >&2
  echo "example: $0 1.0.0" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/build/release/$VERSION/auth-server"

if [[ ! -f "$BIN" ]]; then
  echo "error: binary not found: $BIN" >&2
  echo "run first: ./build/build-auth.sh $VERSION" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found" >&2
  exit 1
fi

cd "$ROOT"
TAG="${IMAGE_NAME}:${VERSION}"
echo "[docker] building $TAG from $BIN"
docker build \
  -f build/Dockerfile.auth \
  --build-arg VERSION="$VERSION" \
  -t "$TAG" \
  -t "${IMAGE_NAME}:latest" \
  .

echo "OK: $TAG"
docker images "$IMAGE_NAME" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"
