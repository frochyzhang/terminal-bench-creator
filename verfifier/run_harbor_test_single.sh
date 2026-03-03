#!/bin/bash
# ==============================================================================
# Harbor 一键测试脚本 - Terminal Bench Tasks (并行版)
# ==============================================================================
#
# 功能：
#   1. 运行 Harbor check (任务质量检查)
#   2. 运行 Harbor oracle (标准答案验证)
#   3. 运行 Harbor agent (AI Agent 测试)
#   4. 使用 Claude Code 进行后检查（自动扫描 post_check_prompts/ 目录）
#   步骤 1-4 并行执行，终端实时显示各步骤运行状态。
#
# 用法：
#   ./run_harbor_test_single.sh <task_path> [check|oracle|agent|post|all]
#
# 环境变量：
#   TASK_TIMEOUT   - 整个任务的超时时间，秒 (默认: 3600；设为 0 禁用)
#   SKIP_EXISTING  - 跳过已有输出的步骤 (默认: true)
#   API_PROVIDER   - API 提供商: qiniu 或 openrouter (默认: qiniu)
#   AGENT_MODEL    - Agent 使用的模型 (默认由 API_PROVIDER 决定)
#   AGENT_TYPE     - Agent 类型 (默认: terminus-2)
#   AGENT_ATTEMPTS - Agent 测试次数 (默认: 4)
#   CHECK_MODEL    - harbor check 使用的模型 (默认由 API_PROVIDER 决定)
#   JOBS_DIR       - jobs 输出目录 (默认: <task_dir>/harbor_jobs)
#
# 示例：
#   ./run_harbor_test_single.sh /path/to/task
#   ./run_harbor_test_single.sh /path/to/task oracle
#   API_PROVIDER=openrouter ./run_harbor_test_single.sh /path/to/task
#   AGENT_ATTEMPTS=2 ./run_harbor_test_single.sh /path/to/task agent
#
# ==============================================================================

set -euo pipefail
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# ============ 超时控制 ============
TASK_TIMEOUT="${TASK_TIMEOUT:-3600}"
if [ "${TASK_TIMEOUT}" -gt 0 ] 2>/dev/null && [ -z "${_TASK_TIMEOUT_APPLIED:-}" ]; then
    export _TASK_TIMEOUT_APPLIED=1
    exec timeout "${TASK_TIMEOUT}" "$0" "$@"
fi

# ============ 配置区 ============
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKIP_EXISTING="${SKIP_EXISTING:-true}"
API_PROVIDER="${API_PROVIDER:-qiniu}"
AGENT_TYPE="${AGENT_TYPE:-terminus-2}"
AGENT_ATTEMPTS="${AGENT_ATTEMPTS:-4}"

POST_CHECKS_DIR="${POST_CHECKS_DIR:-${SCRIPT_DIR}/post_check_prompts}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# ============ 颜色定义 ============
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ============ 工具函数 ============
log_info()    { echo -e "${BLUE}[INFO]${NC} $(date '+%H:%M:%S') $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $(date '+%H:%M:%S') $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $(date '+%H:%M:%S') $1"; }
log_error()   { echo -e "${RED}[ERR]${NC} $(date '+%H:%M:%S') $1"; }

format_duration() {
    local secs=$1
    if [ "${secs}" -lt 60 ]; then
        echo "${secs}s"
    elif [ "${secs}" -lt 3600 ]; then
        echo "$(( secs / 60 ))m$(( secs % 60 ))s"
    else
        echo "$(( secs / 3600 ))h$(( secs % 3600 / 60 ))m"
    fi
}

# ============ 参数解析 ============
if [ $# -lt 1 ]; then
    echo "用法: $0 <task_path> [check|oracle|agent|post|all]"
    exit 1
fi

TASK_PATH="$(cd "$1" && pwd)"
COMMAND="${2:-all}"

if [ ! -d "${TASK_PATH}" ]; then
    log_error "任务目录不存在: ${TASK_PATH}"
    exit 1
fi

TASK_NAME="$(basename "${TASK_PATH}")"
JOBS_DIR="${JOBS_DIR:-${TASK_PATH}/harbor_jobs}"
LOG_DIR="${TASK_PATH}/post_logs"
STEP_LOG_DIR="${LOG_DIR}/step_logs"
mkdir -p "${LOG_DIR}" "${JOBS_DIR}" "${STEP_LOG_DIR}"

# 任务状态文件（供 multiple 脚本读取进度）
_TASK_STATUS_FILE="${LOG_DIR}/.task_status"

# ============ 日志路径收集 (线程安全) ============
declare -a LOG_PATHS=()
_LOG_PATHS_FILE=""

add_log_path() {
    if [ -n "${_LOG_PATHS_FILE:-}" ]; then
        (flock -x 200; echo "$1" >> "${_LOG_PATHS_FILE}") 200>"${_LOG_PATHS_FILE}.lock"
    else
        LOG_PATHS+=("$1")
    fi
}

# ============ 环境加载 ============
load_env() {
    local env_locations=(
        "${SCRIPT_DIR}/.env"
        "${SCRIPT_DIR}/../.env"
        "${HOME}/.env"
    )
    for env_file in "${env_locations[@]}"; do
        if [ -f "${env_file}" ]; then
            log_info "加载环境变量: ${env_file}"
            set -a; source "${env_file}"; set +a
            break
        fi
    done
}

# ============ API 提供商配置 ============
setup_api_provider() {
    case "${API_PROVIDER}" in
        qiniu)
            AGENT_MODEL="${AGENT_MODEL:-openai/claude-4.5-opus}"
            CHECK_MODEL="${CHECK_MODEL:-openai/deepseek/deepseek-v3.2-251201}"
            export ANTHROPIC_BASE_URL="${QINIU_API_BASE:-https://api.qnaigc.com}"
            export ANTHROPIC_AUTH_TOKEN="${QINIU_API_KEY:-}"
            export ANTHROPIC_API_KEY=""
            log_info "API: 七牛 | BASE=${ANTHROPIC_BASE_URL}"
            ;;
        openrouter)
            AGENT_MODEL="${AGENT_MODEL:-openrouter/anthropic/claude-opus-4.5}"
            CHECK_MODEL="${CHECK_MODEL:-openrouter/deepseek/deepseek-v3.2}"
            # Use OPENROUTER_API_BASE from .env if set, otherwise use default
            if [ -n "${OPENROUTER_API_BASE:-}" ]; then
                # Remove trailing /api/v1 or /api/v1/ suffix to get base URL for Claude Code
                export ANTHROPIC_BASE_URL="${OPENROUTER_API_BASE%/api/v1}"
                export ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL%/}"
            else
                export ANTHROPIC_BASE_URL="https://openrouter.ai/api"
            fi
            export ANTHROPIC_AUTH_TOKEN="${OPENROUTER_API_KEY:-}"
            export ANTHROPIC_API_KEY=""
            log_info "API: OpenRouter | BASE=${ANTHROPIC_BASE_URL}"
            ;;
        *)
            log_error "未知 API 提供商: ${API_PROVIDER} (可选: qiniu, openrouter)"
            exit 1
            ;;
    esac
    export AGENT_MODEL CHECK_MODEL
}

# ============ 核验步骤函数 ============

run_harbor_check() {
    local check_output="${LOG_DIR}/harbor_check.json"
    if [ "${SKIP_EXISTING}" = true ] && [ -f "${check_output}" ]; then
        log_info "[Check] 已存在，跳过"
        add_log_path "${check_output}"
        return
    fi
    log_info "[Check] 模型: ${CHECK_MODEL}"
    set +e
    uv run harbor tasks check "${TASK_PATH}" -m "${CHECK_MODEL}" -o "${check_output}"
    local rc=$?; set -e
    add_log_path "${check_output}"
    [ ${rc} -eq 0 ] && log_success "Check 完成" || log_warn "Check 退出码: ${rc}"
    return ${rc}
}

run_harbor_oracle() {
    local oracle_jobs_dir="${JOBS_DIR}/oracle"
    if [ "${SKIP_EXISTING}" = true ] && [ -d "${oracle_jobs_dir}" ] && [ -n "$(ls -A "${oracle_jobs_dir}" 2>/dev/null)" ]; then
        log_info "[Oracle] 已存在，跳过"
        add_log_path "${oracle_jobs_dir}"
        return
    fi
    log_info "[Oracle] 验证标准答案..."
    set +e
    uv run harbor run --path "${TASK_PATH}" --agent oracle --model oracle --n-attempts 1 --jobs-dir "${oracle_jobs_dir}"
    local rc=$?; set -e
    add_log_path "${oracle_jobs_dir}"
    [ ${rc} -eq 0 ] && log_success "Oracle 完成" || log_warn "Oracle 退出码: ${rc}"
    return ${rc}
}

run_harbor_agent() {
    local agent_jobs_dir="${JOBS_DIR}/agent"
    if [ "${SKIP_EXISTING}" = true ] && [ -d "${agent_jobs_dir}" ] && [ -n "$(ls -A "${agent_jobs_dir}" 2>/dev/null)" ]; then
        log_info "[Agent] 已存在，跳过"
        add_log_path "${agent_jobs_dir}"
        return
    fi
    log_info "[Agent] ${AGENT_TYPE} | ${AGENT_MODEL} | x${AGENT_ATTEMPTS}"
    set +e
    uv run harbor run --path "${TASK_PATH}" --agent "${AGENT_TYPE}" --model "${AGENT_MODEL}" --n-attempts "${AGENT_ATTEMPTS}" --jobs-dir "${agent_jobs_dir}"
    local rc=$?; set -e
    add_log_path "${agent_jobs_dir}"
    [ ${rc} -eq 0 ] && log_success "Agent 完成" || log_warn "Agent 退出码: ${rc}"
    return ${rc}
}

run_single_post_check() {
    local prompt_file="$1"
    local check_name; check_name="$(basename "${prompt_file}" .md)"
    local output_file="${LOG_DIR}/claude_${check_name}.md"
    if [ "${SKIP_EXISTING}" = true ] && [ -f "${output_file}" ]; then
        # Check if existing report contains error content — if so, remove and regenerate
        if grep -qE "Failed to authenticate|Missing Authentication header|API Error:" "${output_file}" 2>/dev/null; then
            log_warn "[Post] ${check_name} 存在但包含认证错误，删除并重新生成"
            rm -f "${output_file}"
        else
            log_info "[Post] ${check_name} 已存在，跳过"
            add_log_path "${output_file}"
            return
        fi
    fi
    log_info "[Post] ${check_name}"
    local full_prompt="请评审以下任务目录: ${TASK_PATH}

请先读取以下文件了解任务详情：
- ${TASK_PATH}/instruction.md
- ${TASK_PATH}/solution/solve.sh
- ${TASK_PATH}/tests/test.sh
- ${TASK_PATH}/environment/Dockerfile

$(cat "${prompt_file}")"
    set +e
    printf '\xEF\xBB\xBF' > "${output_file}"
    echo "${full_prompt}" | claude -p --output-format text --permission-mode bypassPermissions --add-dir "${TASK_PATH}" - 2>&1 | tee -a "${output_file}"
    local rc=$?; set -e
    add_log_path "${output_file}"
    [ ${rc} -eq 0 ] && log_success "Post ${check_name} 完成" || log_warn "Post ${check_name} 退出码: ${rc}"
    return ${rc}
}

# ============ 并行执行框架 ============

_STATUS_DIR=""
declare -A _BG_PIDS=()
declare -a PHASE1_STEPS=()
_DASHBOARD_LINES=0
_SPIN_CHARS='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
_SPIN_IDX=0
_GLOBAL_START=0

# 初始化并行框架
init_parallel() {
    _STATUS_DIR=$(mktemp -d)
    _LOG_PATHS_FILE="${_STATUS_DIR}/_log_paths"
    touch "${_LOG_PATHS_FILE}"
    export _STATUS_DIR _LOG_PATHS_FILE
    _GLOBAL_START=$(date +%s)
    trap 'cleanup_parallel' EXIT
}

cleanup_parallel() {
    # 杀掉所有后台进程
    for pid in "${_BG_PIDS[@]}"; do
        kill "${pid}" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    rm -rf "${_STATUS_DIR}" 2>/dev/null || true
}

# 写入步骤状态: pending|running|done|failed|skipped
_update_status() {
    local step_id="$1" status="$2"
    local now; now=$(date +%s)
    case "${status}" in
        running)
            echo "${status} ${now} 0" > "${_STATUS_DIR}/${step_id}"
            ;;
        done|failed)
            local prev_start
            prev_start=$(awk '{print $2}' "${_STATUS_DIR}/${step_id}" 2>/dev/null || echo "${now}")
            echo "${status} ${prev_start} $(( now - prev_start ))" > "${_STATUS_DIR}/${step_id}"
            ;;
        *)
            echo "${status} 0 0" > "${_STATUS_DIR}/${step_id}"
            ;;
    esac
}

# 后台启动步骤: bg_run "step_id|显示名|函数名|参数"
bg_run() {
    local step_spec="$1"
    local step_id display_name func_name func_arg
    IFS='|' read -r step_id display_name func_name func_arg <<< "${step_spec}"

    _update_status "${step_id}" "running"

    # 写入 UTF-8 BOM，确保 VS Code 等编辑器自动识别编码
    printf '\xEF\xBB\xBF' > "${STEP_LOG_DIR}/${step_id}.log"

    (
        set +e
        if [ -n "${func_arg}" ]; then
            "${func_name}" "${func_arg}"
        else
            "${func_name}"
        fi
        if [ $? -eq 0 ]; then
            _update_status "${step_id}" "done"
        else
            _update_status "${step_id}" "failed"
        fi
    ) >> "${STEP_LOG_DIR}/${step_id}.log" 2>&1 &

    _BG_PIDS["${step_id}"]=$!
}

# 渲染单行步骤状态
_render_line() {
    local step_id="$1" display_name="$2" now="$3"
    local info; info=$(cat "${_STATUS_DIR}/${step_id}" 2>/dev/null || echo "pending 0 0")
    local status start_ts duration
    read -r status start_ts duration <<< "${info}"

    local icon color elapsed=""
    case "${status}" in
        pending)  icon="○" ; color="${YELLOW}" ; elapsed="等待中" ;;
        running)  icon="${_SPIN_CHARS:$(( _SPIN_IDX % ${#_SPIN_CHARS} )):1}" ; color="${BLUE}" ; elapsed="$(format_duration $(( now - start_ts )))" ;;
        done)     icon="✓" ; color="${GREEN}" ; elapsed="$(format_duration "${duration}")" ;;
        failed)   icon="✗" ; color="${RED}"   ; elapsed="$(format_duration "${duration}")" ;;
        skipped)  icon="–" ; color="${CYAN}"  ; elapsed="跳过" ;;
    esac

    printf '\033[K  %b %s %b %-36s %b%s%b\n' "${color}" "${icon}" "${NC}" "${display_name}" "${color}" "${elapsed}" "${NC}"
}

# 统计阶段中已完成的步骤数
_count_finished() {
    local cnt=0
    for spec in "$@"; do
        local sid
        IFS='|' read -r sid _ _ _ <<< "${spec}"
        local st
        st=$(awk '{print $1}' "${_STATUS_DIR}/${sid}" 2>/dev/null || echo "pending")
        case "${st}" in done|failed|skipped) cnt=$(( cnt + 1 )) ;; esac
    done
    echo "${cnt}"
}

# 渲染完整面板
render_dashboard() {
    local now; now=$(date +%s)
    local total_elapsed=$(( now - _GLOBAL_START ))

    # 递增 spinner
    _SPIN_IDX=$(( _SPIN_IDX + 1 ))

    # 上移光标到面板起始位置
    if [ ${_DASHBOARD_LINES} -gt 0 ]; then
        printf '\033[%dA' "${_DASHBOARD_LINES}"
    fi
    _DASHBOARD_LINES=0

    # 预计算进度
    local p1_fin=0
    local p1_total=${#PHASE1_STEPS[@]}
    [ ${p1_total} -gt 0 ] && p1_fin=$(_count_finished "${PHASE1_STEPS[@]}")

    # 写入任务状态文件供 multiple 脚本读取
    # 格式: elapsed_secs step_id:code step_id:code ...
    # code: D=done R=running F=failed S=skipped P=pending
    if [ -n "${_TASK_STATUS_FILE:-}" ]; then
        local _sf_line="${total_elapsed}"
        if [ ${p1_total} -gt 0 ]; then
            for _sf_spec in "${PHASE1_STEPS[@]}"; do
                local _sf_sid; IFS='|' read -r _sf_sid _ _ _ <<< "${_sf_spec}"
                local _sf_st; read -r _sf_st _ _ < "${_STATUS_DIR}/${_sf_sid}" 2>/dev/null || _sf_st="pending"
                local _sf_c; case "${_sf_st}" in done) _sf_c="D";; running) _sf_c="R";; failed) _sf_c="F";; skipped) _sf_c="S";; *) _sf_c="P";; esac
                _sf_line="${_sf_line} ${_sf_sid}:${_sf_c}"
            done
        fi
        echo "${_sf_line}" > "${_TASK_STATUS_FILE}" 2>/dev/null || true
    fi

    # 标题栏
    printf '\033[K  %b═══ %s  ⏱ %s  进度: %d/%d ═══%b\n' \
        "${CYAN}" "${TASK_NAME}" "$(format_duration ${total_elapsed})" "${p1_fin}" "${p1_total}" "${NC}"
    _DASHBOARD_LINES=$(( _DASHBOARD_LINES + 1 ))

    if [ ${p1_total} -gt 0 ]; then
        printf '\033[K  %b── 并行执行 [%d/%d] ──%b\n' "${CYAN}" "${p1_fin}" "${p1_total}" "${NC}"
        _DASHBOARD_LINES=$(( _DASHBOARD_LINES + 1 ))
        for spec in "${PHASE1_STEPS[@]}"; do
            local sid sname
            IFS='|' read -r sid sname _ _ <<< "${spec}"
            _render_line "${sid}" "${sname}" "${now}"
            _DASHBOARD_LINES=$(( _DASHBOARD_LINES + 1 ))
        done
    fi
}

# 等待指定步骤完成，同时刷新面板
wait_for_steps() {
    local specs=("$@")
    local target_ids=()
    for spec in "${specs[@]}"; do
        local sid
        IFS='|' read -r sid _ _ _ <<< "${spec}"
        target_ids+=("${sid}")
    done

    while true; do
        render_dashboard

        local all_done=true
        for sid in "${target_ids[@]}"; do
            local st
            st=$(awk '{print $1}' "${_STATUS_DIR}/${sid}" 2>/dev/null || echo "pending")
            if [ "${st}" = "running" ] || [ "${st}" = "pending" ]; then
                all_done=false
                break
            fi
        done

        if [ "${all_done}" = true ]; then break; fi
        sleep 0.5
    done
    render_dashboard  # 最终刷新
}

# 扫描 prompt 目录，追加步骤到目标数组
discover_prompt_steps() {
    local -n _target=$1
    local prefix="$2" dir="$3" func="$4"
    [ -d "${dir}" ] || return 0
    local files
    files=$(find "${dir}" -maxdepth 1 -name "*.md" -type f 2>/dev/null | sort)
    [ -z "${files}" ] && return 0
    while IFS= read -r f; do
        [ -z "${f}" ] && continue
        local name; name=$(basename "${f}" .md)
        local sid="${prefix}_${name}"
        _target+=("${sid}|${prefix}: ${name}|${func}|${f}")
        echo "pending 0 0" > "${_STATUS_DIR}/${sid}"
    done <<< "${files}"
}

# ============ 结果汇总 ============
print_final_summary() {
    echo ""
    echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  核验完成 — ${TASK_NAME}${NC}"
    echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
    echo ""

    # 从文件收集日志路径
    if [ -f "${_LOG_PATHS_FILE}" ]; then
        while IFS= read -r p; do
            [ -n "${p}" ] && LOG_PATHS+=("${p}")
        done < "${_LOG_PATHS_FILE}"
    fi

    if [ ${#LOG_PATHS[@]} -gt 0 ]; then
        echo -e "${GREEN}输出文件:${NC}"
        for path in "${LOG_PATHS[@]}"; do
            [ -e "${path}" ] && echo -e "  ${path}"
        done
        echo ""
    fi

    echo -e "${GREEN}步骤日志:${NC}  ${STEP_LOG_DIR}/"
    echo ""
    echo -e "${GREEN}Harbor View:${NC}"
    echo -e "  ${YELLOW}uv run harbor view ${JOBS_DIR}${NC}"
    echo ""

    # 写入汇总文件
    {
        echo "# Harbor Test Results - ${TIMESTAMP}"
        echo "# Task: ${TASK_PATH}"
        echo "# Command: ${COMMAND}"
        echo ""
        for path in "${LOG_PATHS[@]}"; do
            [ -e "${path}" ] && echo "${path}"
        done
    } > "${LOG_DIR}/all_paths.log"
    # 在文件头部插入 UTF-8 BOM
    { printf '\xEF\xBB\xBF'; cat "${LOG_DIR}/all_paths.log"; } > "${LOG_DIR}/all_paths.log.tmp" \
        && mv "${LOG_DIR}/all_paths.log.tmp" "${LOG_DIR}/all_paths.log"
}

# ============ 帮助信息 ============
show_help() {
    echo "Harbor 一键测试脚本 (并行版)"
    echo ""
    echo "用法: $0 <task_path> [command]"
    echo ""
    echo "Commands:"
    echo "  check   只运行 harbor tasks check"
    echo "  oracle  只运行 oracle 测试"
    echo "  agent   只运行 agent 测试"
    echo "  post    只运行 Claude Code 后检查"
    echo "  all     运行所有测试 (默认)"
    echo "  help    显示此帮助信息"
    echo ""
    echo "环境变量:"
    echo "  API_PROVIDER    API 提供商: qiniu 或 openrouter (默认: qiniu)"
    echo "  AGENT_MODEL     Agent 模型 (默认由 API_PROVIDER 决定)"
    echo "  AGENT_TYPE      Agent 类型 (默认: ${AGENT_TYPE})"
    echo "  AGENT_ATTEMPTS  Agent 测试次数 (默认: ${AGENT_ATTEMPTS})"
    echo "  CHECK_MODEL     Check 模型 (默认由 API_PROVIDER 决定)"
    echo "  TASK_TIMEOUT    超时时间 (默认: ${TASK_TIMEOUT}s)"
    echo "  SKIP_EXISTING   跳过已有输出 (默认: true)"
    echo ""
    echo "并行策略:"
    echo "  阶段一 (并行): check, oracle, agent, post_check_prompts/*"
}

# ============ 主函数 ============
main() {
    if [ "${COMMAND}" = "help" ] || [ "${COMMAND}" = "--help" ] || [ "${COMMAND}" = "-h" ]; then
        show_help
        exit 0
    fi

    load_env
    setup_api_provider
    log_info "任务: ${TASK_NAME} | 命令: ${COMMAND}"

    # 检查 claude CLI
    local has_claude=true
    if ! command -v claude &>/dev/null; then
        log_warn "claude CLI 不可用，跳过 Claude Code 相关步骤"
        has_claude=false
    fi

    # 初始化并行框架
    init_parallel

    # ---- 构建步骤列表 ----
    PHASE1_STEPS=()

    case "${COMMAND}" in
        check)
            PHASE1_STEPS+=("check|Harbor Check|run_harbor_check|")
            ;;
        oracle)
            PHASE1_STEPS+=("oracle|Harbor Oracle|run_harbor_oracle|")
            ;;
        agent)
            PHASE1_STEPS+=("agent|Harbor Agent|run_harbor_agent|")
            ;;
        post)
            if [ "${has_claude}" = true ]; then
                discover_prompt_steps PHASE1_STEPS "post" "${POST_CHECKS_DIR}" "run_single_post_check"
            else
                log_warn "claude CLI 不可用，无步骤可执行"
                exit 0
            fi
            ;;
        all)
            PHASE1_STEPS+=("check|Harbor Check|run_harbor_check|")
            PHASE1_STEPS+=("oracle|Harbor Oracle|run_harbor_oracle|")
            PHASE1_STEPS+=("agent|Harbor Agent|run_harbor_agent|")
            if [ "${has_claude}" = true ]; then
                discover_prompt_steps PHASE1_STEPS "post" "${POST_CHECKS_DIR}" "run_single_post_check"
            fi
            ;;
        *)
            log_error "未知命令: ${COMMAND}"
            show_help
            exit 1
            ;;
    esac

    # 初始化所有步骤状态
    for spec in "${PHASE1_STEPS[@]}"; do
        local sid
        IFS='|' read -r sid _ _ _ <<< "${spec}"
        echo "pending 0 0" > "${_STATUS_DIR}/${sid}"
    done

    echo ""  # 面板前留空行

    # ---- 并行启动所有步骤 ----
    for spec in "${PHASE1_STEPS[@]}"; do
        bg_run "${spec}"
    done
    wait_for_steps "${PHASE1_STEPS[@]}"

    print_final_summary
}

main
