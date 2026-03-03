#!/bin/bash
# ==============================================================================
# 一键环境配置脚本
# ==============================================================================
#
# 安装以下工具：
#   - uv         Python 包管理
#   - harbor     任务测试框架 (v0.1.42)
#   - claude     Claude Code CLI（AI 辅助评审）
#   - docker     容器化任务环境
#
# 用法：
#   bash setup.sh
#
# 环境变量：
#   UV_MIRROR=1  使用中国大陆镜像安装 uv（默认使用官方源）
#
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[ OK ]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERR]${NC} $1"; }

check_cmd() { command -v "$1" &>/dev/null; }

# ============ uv ============
install_uv() {
    if check_cmd uv; then
        log_success "uv 已安装: $(uv --version)"
        return
    fi
    if [ "${UV_MIRROR:-0}" = "1" ]; then
        log_info "安装 uv（中国大陆镜像）..."
        curl -LsSf https://mirror.ghproxy.com/https://astral.sh/uv/install.sh | sh
    else
        log_info "安装 uv（官方源）..."
        curl -LsSf https://astral.sh/uv/install.sh | sh
    fi
    # 确保 uv 在 PATH 中
    export PATH="$HOME/.local/bin:$PATH"
    if check_cmd uv; then
        log_success "uv 安装完成: $(uv --version)"
    else
        log_error "uv 安装失败，请手动安装: https://docs.astral.sh/uv/getting-started/installation/"
        exit 1
    fi
}

# ============ harbor ============
HARBOR_VERSION="0.1.42"

install_harbor() {
    if check_cmd harbor; then
        local current_ver
        current_ver="$(harbor --version 2>&1 | head -1)"
        log_success "harbor 已安装: ${current_ver}"
        return
    fi
    log_info "安装 harbor==${HARBOR_VERSION}..."
    uv tool install "harbor==${HARBOR_VERSION}"
    if check_cmd harbor; then
        log_success "harbor ${HARBOR_VERSION} 安装完成"
    else
        log_error "harbor 安装失败"
        exit 1
    fi
}

# ============ Node.js + Claude Code ============
install_claude() {
    if check_cmd claude; then
        log_success "claude 已安装: $(claude --version 2>&1 | head -1)"
        return
    fi

    # 检查 Node.js
    if ! check_cmd node; then
        log_info "安装 Node.js..."
        if check_cmd apt-get; then
            curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif check_cmd yum; then
            curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
            sudo yum install -y nodejs
        else
            log_error "无法自动安装 Node.js，请手动安装: https://nodejs.org/"
            return 1
        fi
    fi
    log_success "node: $(node --version)"

    log_info "安装 Claude Code CLI..."
    sudo npm install -g @anthropic-ai/claude-code
    if check_cmd claude; then
        log_success "claude 安装完成: $(claude --version 2>&1 | head -1)"
    else
        log_error "claude 安装失败"
        return 1
    fi
}

# ============ Docker ============
install_docker() {
    if check_cmd docker; then
        log_success "docker 已安装: $(docker --version)"
        return
    fi
    log_info "安装 Docker..."
    if check_cmd apt-get || check_cmd yum; then
        curl -fsSL https://get.docker.com | sudo sh
        sudo usermod -aG docker "$USER"
        log_warn "已将当前用户加入 docker 组，需要重新登录才能免 sudo 使用 docker"
    else
        log_error "无法自动安装 Docker，请手动安装: https://docs.docker.com/engine/install/"
        return 1
    fi
    if check_cmd docker; then
        log_success "docker 安装完成: $(docker --version)"
    else
        log_error "docker 安装失败"
        return 1
    fi
}

# ============ .env 模板 ============
setup_env() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local env_file="${script_dir}/.env"
    if [ -f "${env_file}" ]; then
        log_success ".env 已存在，跳过"
        return
    fi
    log_info "生成 .env 模板..."
    cat > "${env_file}" << 'EOF'
# Harbor litellm 路由配置
# openai/ 前缀的模型走此配置（即七牛）
export OPENAI_API_KEY="你的七牛API密钥"
export OPENAI_API_BASE="https://api.qnaigc.com/v1"

# openrouter/ 前缀的模型走此配置
export OPENROUTER_API_BASE="https://openrouter.ai/api/v1/"
export OPENROUTER_API_KEY="你的OpenRouter API密钥"

# 七牛 (Qiniu) 配置 - 用于 Claude Code ANTHROPIC 兼容模式
export QINIU_API_BASE="https://api.qnaigc.com"
export QINIU_API_KEY="你的七牛API密钥"
EOF
    log_warn "请编辑 ${env_file}，填入真实的 API Key"
}

# ============ 主流程 ============
main() {
    echo ""
    echo -e "${BLUE}══════════════════════════════════════${NC}"
    echo -e "${BLUE}  Submit Automatic Verify - 环境配置${NC}"
    echo -e "${BLUE}══════════════════════════════════════${NC}"
    echo ""

    install_uv
    install_harbor
    install_claude
    install_docker
    setup_env

    echo ""
    echo -e "${GREEN}══════════════════════════════════════${NC}"
    echo -e "${GREEN}  配置完成${NC}"
    echo -e "${GREEN}══════════════════════════════════════${NC}"
    echo ""
}

main
