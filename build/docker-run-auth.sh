#!/usr/bin/env bash
# 运行 Auth Service Docker 镜像
#
# 用法（仓库根目录）：
#   ./build/docker-run-auth.sh <version> [env_file] [image_name]
# 例：
#   ./build/docker-run-auth.sh 1.0.0
#   ./build/docker-run-auth.sh 1.0.0 ./auth-service.env
#   ./build/docker-run-auth.sh 1.0.0 ./auth-service.env gushi-auth
#
# 默认 env：当前工作目录下的 auth-service.env（不是仓库根目录）
#
# 前置：
#   ./build/docker-build-auth.sh <version>
#   在执行目录准备 auth-service.env（可参考 build/auth-service.env.example）
#
# 注意：容器内访问宿主机 CRV 时，CRV_BASE_URL 不要用 127.0.0.1，
#       可改为宿主机局域网 IP，或 host.docker.internal（视 Docker 网络而定）。

set -euo pipefail

VERSION="${1:-}"
ENV_FILE="${2:-}"
IMAGE_NAME="${3:-gushi-auth}"
HOST_PORT="${HOST_PORT:-8081}"
CONTAINER_NAME="${CONTAINER_NAME:-gushi-auth}"

if [[ -z "$VERSION" ]]; then
  echo "usage: $0 <version> [env_file] [image_name]" >&2
  echo "example: $0 1.0.0" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 默认在「执行时的当前工作目录」查找 auth-service.env
if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$(pwd)/auth-service.env"
fi

# 相对路径基于当前工作目录解析，便于 docker --env-file
if [[ "$ENV_FILE" != /* ]]; then
  ENV_FILE="$(pwd)/$ENV_FILE"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: env file not found: $ENV_FILE" >&2
  echo "place auth-service.env in the current directory (see build/auth-service.env.example)" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found" >&2
  exit 1
fi

TAG="${IMAGE_NAME}:${VERSION}"
if ! docker image inspect "$TAG" >/dev/null 2>&1; then
  echo "error: image not found: $TAG" >&2
  echo "run first: ./build/docker-build-auth.sh $VERSION" >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "[run] removing existing container: $CONTAINER_NAME"
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

echo "[run] starting $TAG (port $HOST_PORT -> 8081, env=$ENV_FILE)"
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${HOST_PORT}:8081" \
  --env-file "$ENV_FILE" \
  -e AUTH_ADDR=:8081 \
  "$TAG"

echo "OK: container=$CONTAINER_NAME image=$TAG"
echo "health: curl -s http://127.0.0.1:${HOST_PORT}/healthz"
docker ps --filter "name=^${CONTAINER_NAME}$" --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
