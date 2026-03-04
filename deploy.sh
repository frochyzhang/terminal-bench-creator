#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Terminal-Bench Station — 一键部署脚本
#
# 用法:
#   ./deploy.sh          首次部署 / 重新部署
#   ./deploy.sh restart  仅重启服务（跳过 install / migrate / build）
#   ./deploy.sh stop     停止所有服务
#
# 依赖: node ≥ 18, npm, docker, docker compose v2
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── 颜色 ──────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
step()  { echo -e "\n${BOLD}▶ $*${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODE="${1:-deploy}"

# ── 停止模式 ──────────────────────────────────────────────────────────────────
if [[ "$MODE" == "stop" ]]; then
  step "Stopping services"
  if command -v pm2 &>/dev/null; then
    pm2 delete tb-station-server 2>/dev/null && ok "PM2 process stopped" || warn "No PM2 process found"
  fi
  docker compose down && ok "PostgreSQL stopped" || warn "docker compose down failed"
  exit 0
fi

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════╗"
echo "║   Terminal-Bench Station — Deploy Script     ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Step 1: 检查依赖 ──────────────────────────────────────────────────────────
step "Step 1 / 6 — Checking prerequisites"

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    error "$1 is not installed. $2"
    exit 1
  fi
  ok "$1 found ($(command -v "$1"))"
}

check_cmd node  "Install from https://nodejs.org (≥ 18)"
check_cmd npm   "Comes with Node.js"
check_cmd docker "Install from https://docs.docker.com/get-docker/"

# docker compose v2 check
if ! docker compose version &>/dev/null; then
  error "docker compose v2 not found. Update Docker Desktop or install the compose plugin."
  exit 1
fi
ok "docker compose v2 found"

NODE_VERSION=$(node -e "process.stdout.write(process.versions.node)")
NODE_MAJOR="${NODE_VERSION%%.*}"
if (( NODE_MAJOR < 18 )); then
  error "Node.js ≥ 18 required (found $NODE_VERSION)"
  exit 1
fi
ok "Node.js $NODE_VERSION"

# ── Step 2: 环境变量配置 ───────────────────────────────────────────────────────
step "Step 2 / 6 — Environment configuration"

ENV_FILE="server/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  warn "server/.env not found — creating from .env.example"
  cp .env.example "$ENV_FILE"

  echo ""
  echo -e "${YELLOW}Please fill in these required values in server/.env:${NC}"
  echo ""
  echo "  1. ENCRYPTION_KEY — 32 hex chars (e.g. run: openssl rand -hex 16)"
  echo "  2. (Optional) OPENROUTER_API_KEY — if you want to use AI features"
  echo ""

  # Auto-generate ENCRYPTION_KEY if openssl is available
  if command -v openssl &>/dev/null; then
    GENERATED_KEY=$(openssl rand -hex 16)
    # Replace the placeholder in the copied file
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=${GENERATED_KEY}/" "$ENV_FILE"
    else
      sed -i "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=${GENERATED_KEY}/" "$ENV_FILE"
    fi
    ok "Auto-generated ENCRYPTION_KEY → $ENV_FILE"
  fi

  echo -e "${YELLOW}Press Enter after editing server/.env, or Ctrl+C to abort.${NC}"
  read -r _
else
  ok "server/.env already exists"
fi

# Check ENCRYPTION_KEY is not the placeholder
if grep -q "ENCRYPTION_KEY=0123456789abcdef" "$ENV_FILE" 2>/dev/null; then
  warn "ENCRYPTION_KEY is still the default placeholder — generating a secure one"
  if command -v openssl &>/dev/null; then
    GENERATED_KEY=$(openssl rand -hex 16)
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=${GENERATED_KEY}/" "$ENV_FILE"
    else
      sed -i "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=${GENERATED_KEY}/" "$ENV_FILE"
    fi
    ok "New ENCRYPTION_KEY generated"
  fi
fi

# ── Step 3: 安装依赖 ──────────────────────────────────────────────────────────
if [[ "$MODE" != "restart" ]]; then
  step "Step 3 / 6 — Installing npm dependencies"
  npm install --prefer-offline 2>&1 | tail -3
  ok "npm install complete"
else
  step "Step 3 / 6 — Skipping install (restart mode)"
fi

# ── Step 4: 启动数据库 ────────────────────────────────────────────────────────
step "Step 4 / 6 — Starting PostgreSQL (docker compose)"
docker compose up -d postgres

info "Waiting for PostgreSQL to be healthy…"
MAX_WAIT=30
for i in $(seq 1 $MAX_WAIT); do
  if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-tbuser}" -d "${POSTGRES_DB:-tb_station}" &>/dev/null; then
    ok "PostgreSQL is ready (${i}s)"
    break
  fi
  if [[ $i -eq $MAX_WAIT ]]; then
    error "PostgreSQL did not become ready after ${MAX_WAIT}s"
    docker compose logs postgres | tail -20
    exit 1
  fi
  sleep 1
done

# ── Step 5: 迁移 & 构建 ───────────────────────────────────────────────────────
if [[ "$MODE" != "restart" ]]; then
  step "Step 5 / 6 — Running DB migrations"
  npm run db:migrate
  ok "Migrations applied"

  step "Step 6 / 6 — Building client"
  npm run build 2>&1 | tail -5
  ok "Client built → client/dist/"
else
  step "Steps 5–6 / 6 — Skipping migrate & build (restart mode)"
fi

# ── 启动 Server ───────────────────────────────────────────────────────────────
echo -e "\n${BOLD}▶ Starting server${NC}"

PORT=$(grep '^PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo 3001)
PORT="${PORT:-3001}"

if command -v pm2 &>/dev/null; then
  info "PM2 detected — starting with pm2 (logs: pm2 logs tb-station-server)"
  pm2 delete tb-station-server 2>/dev/null || true
  pm2 start server/src/index.js \
    --name tb-station-server \
    --cwd "$SCRIPT_DIR" \
    --node-args="--env-file=server/.env" \
    -- 2>&1 | tail -5
  pm2 save 2>/dev/null || true
  ok "Server started via PM2"
else
  warn "PM2 not found — starting in foreground (install pm2 for daemon mode: npm i -g pm2)"
  info "Server will start now. Press Ctrl+C to stop."
  echo ""
  NODE_ENV=production node --env-file=server/.env server/src/index.js
  exit 0
fi

# ── 完成 ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✅  Deployment complete!${NC}"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════${NC}"
echo ""
echo -e "  🌐 App    : ${BOLD}http://localhost:${PORT}${NC}"
echo -e "  📋 Logs   : ${BOLD}pm2 logs tb-station-server${NC}"
echo -e "  🛑 Stop   : ${BOLD}./deploy.sh stop${NC}"
echo -e "  🔄 Restart: ${BOLD}./deploy.sh restart${NC}"
echo ""
