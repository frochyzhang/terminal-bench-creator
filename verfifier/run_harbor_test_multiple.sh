#!/bin/bash
# ==============================================================================
# Harbor 批量测试脚本 - Terminal Bench Tasks (多任务并行版)
# ==============================================================================
#
# 功能：
#   读取指定目录下的所有任务，并行运行 run_harbor_test_single.sh
#
# 用法：
#   ./run_harbor_test_multiple.sh <tasks_dir> [check|oracle|agent|post|all] [options]
#
#   tasks_dir: 包含多个任务的目录（每个子目录是一个任务）
#   命令选项:
#     check   - 只运行 harbor tasks check
#     oracle  - 只运行 oracle 测试
#     agent   - 只运行 agent 测试
#     post    - 只运行 Claude Code 后检查
#     all     - 运行所有测试 (默认)
#
# 选项:
#   -j, --jobs N       并行任务数 (默认: 4)
#   -t, --task TASK    只运行指定的任务（可多次使用）
#   -e, --exclude TASK 排除指定的任务（可多次使用）
#   -T, --timeout SEC  单个任务超时时间，秒 (默认: 3600，即 1 小时)
#   -d, --dry-run      只显示要运行的任务，不实际执行
#   -c, --config FILE  指定配置文件（默认: <tasks_dir>/tasks.conf）
#   --no-config        忽略配置文件，扫描所有任务
#   --init-config      只生成配置文件，不执行任务
#   -h, --help         显示帮助信息
#
# 配置文件:
#   首次运行时，如果配置文件不存在，会自动扫描目录生成配置文件。
#   配置文件格式为每行一个任务名，# 开头的行为注释（被跳过的任务）。
#   后续运行会读取配置文件决定执行哪些任务。
#
# 环境变量 (同 run_harbor_test_single.sh):
#   API_PROVIDER   - API 提供商: qiniu 或 openrouter (默认: qiniu)
#   TASK_TIMEOUT   - 单个任务超时时间，秒 (默认: 3600，即 1 小时)
#   AGENT_MODEL    - Agent 使用的模型 (根据 API_PROVIDER 自动选择默认值)
#   AGENT_TYPE     - Agent 类型
#   AGENT_ATTEMPTS - Agent 测试次数
#   CHECK_MODEL    - harbor check 使用的模型 (根据 API_PROVIDER 自动选择默认值)
#   POST_CHECKS_DIR - 后检查 prompt 目录
#   SKIP_EXISTING  - 跳过已有输出的步骤 (默认: true，设为 false 强制重跑)
#
# 示例：
#   ./run_harbor_test_multiple.sh /path/to/tasks
#   ./run_harbor_test_multiple.sh /path/to/tasks oracle -j 8
#   ./run_harbor_test_multiple.sh /path/to/tasks agent -t task1 -t task2
#   ./run_harbor_test_multiple.sh /path/to/tasks all --exclude task_broken
#   ./run_harbor_test_multiple.sh /path/to/tasks --init-config  # 只生成配置文件
#   ./run_harbor_test_multiple.sh /path/to/tasks --no-config    # 忽略配置文件
#
# ==============================================================================

set -euo pipefail
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# ============ 配置区 ============
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SINGLE_SCRIPT="${SCRIPT_DIR}/run_harbor_test_single.sh"

# 并行配置
MAX_JOBS="${MAX_JOBS:-10}"

# 单个任务超时（秒），默认 1 小时
TASK_TIMEOUT="${TASK_TIMEOUT:-3600}"

# 配置文件名
CONFIG_FILENAME="tasks.conf"

# 时间戳
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# ============ 颜色定义 ============
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# ============ 工具函数 ============
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

print_separator() {
    echo ""
    echo -e "${CYAN}======================================================================${NC}"
    echo -e "${CYAN}=== $1 ===${NC}"
    echo -e "${CYAN}======================================================================${NC}"
    echo ""
}

# ============ 显示帮助 ============
show_help() {
    echo "Harbor 批量测试脚本 - Terminal Bench Tasks (多任务并行版)"
    echo ""
    echo "用法: $0 <tasks_dir> [command] [options]"
    echo ""
    echo "tasks_dir: 包含多个任务的目录（每个子目录是一个任务）"
    echo ""
    echo "Commands:"
    echo "  check   只运行 harbor tasks check"
    echo "  oracle  只运行 oracle 测试"
    echo "  agent   只运行 agent 测试"
    echo "  post    只运行 Claude Code 后检查"
    echo "  all     运行所有测试 (默认)"
    echo "  help    显示此帮助信息"
    echo ""
    echo "Options:"
    echo "  -j, --jobs N       并行任务数 (默认: ${MAX_JOBS})"
    echo "  -T, --timeout SEC  单个任务超时时间，秒 (默认: ${TASK_TIMEOUT}，即 1 小时)"
    echo "  -t, --task TASK    只运行指定的任务（可多次使用）"
    echo "  -e, --exclude TASK 排除指定的任务（可多次使用）"
    echo "  -d, --dry-run      只显示要运行的任务，不实际执行"
    echo "  -c, --config FILE  指定配置文件（默认: <tasks_dir>/${CONFIG_FILENAME}）"
    echo "  --no-config        忽略配置文件，扫描所有任务"
    echo "  --init-config      只生成配置文件，不执行任务"
    echo "  -h, --help         显示帮助信息"
    echo ""
    echo "配置文件:"
    echo "  首次运行时，如果配置文件不存在，会自动扫描目录生成。"
    echo "  配置文件每行一个任务名，# 开头为注释（跳过的任务）。"
    echo "  编辑配置文件可以控制要执行的任务。"
    echo ""
    echo "环境变量 (会传递给 run_harbor_test_single.sh):"
    echo "  API_PROVIDER    API 提供商: qiniu 或 openrouter (默认: qiniu)"
    echo "  AGENT_MODEL     Agent 使用的模型 (根据 API_PROVIDER 自动选择)"
    echo "  AGENT_TYPE      Agent 类型"
    echo "  AGENT_ATTEMPTS  Agent 测试次数"
    echo "  CHECK_MODEL     harbor check 使用的模型 (根据 API_PROVIDER 自动选择)"
    echo "  POST_CHECKS_DIR 后检查 prompt 目录"
    echo "  MAX_JOBS        默认并行任务数"
    echo "  TASK_TIMEOUT    单个任务超时时间，秒 (默认: 3600)"
    echo "  SKIP_EXISTING   跳过已有输出的步骤 (默认: true，设为 false 强制重跑)"
    echo ""
    echo "示例:"
    echo "  $0 /path/to/tasks              # 运行所有任务的所有测试"
    echo "  $0 /path/to/tasks oracle       # 所有任务只运行 oracle"
    echo "  $0 /path/to/tasks agent -j 8   # 8 个并行运行 agent"
    echo "  $0 /path/to/tasks all -t task1 -t task2  # 只运行指定任务"
    echo "  $0 /path/to/tasks all -e broken_task     # 排除某些任务"
    echo "  $0 /path/to/tasks all -d       # 预览要运行的任务"
    echo "  $0 /path/to/tasks --init-config          # 只生成配置文件"
    echo "  $0 /path/to/tasks --no-config            # 忽略配置文件"
    echo "  $0 /path/to/tasks -c custom.conf         # 使用自定义配置文件"
}

# ============ 参数解析 ============
TASKS_DIR=""
COMMAND="all"
INCLUDE_TASKS=()
EXCLUDE_TASKS=()
DRY_RUN=false
CONFIG_FILE=""
NO_CONFIG=false
INIT_CONFIG_ONLY=false

# 检查是否有参数
if [ $# -lt 1 ]; then
    show_help
    exit 1
fi

# 第一个参数是 tasks_dir 或 help
case "$1" in
    help|--help|-h)
        show_help
        exit 0
        ;;
    *)
        TASKS_DIR="$1"
        shift
        ;;
esac

# 第二个参数可能是 command
if [ $# -gt 0 ]; then
    case "$1" in
        check|oracle|agent|post|all)
            COMMAND="$1"
            shift
            ;;
        -*)
            # 这是一个选项，不是命令
            ;;
        *)
            # 可能是未知命令
            COMMAND="$1"
            shift
            ;;
    esac
fi

# 解析剩余选项
while [ $# -gt 0 ]; do
    case "$1" in
        -j|--jobs)
            MAX_JOBS="$2"
            shift 2
            ;;
        -T|--timeout)
            TASK_TIMEOUT="$2"
            shift 2
            ;;
        -t|--task)
            INCLUDE_TASKS+=("$2")
            shift 2
            ;;
        -e|--exclude)
            EXCLUDE_TASKS+=("$2")
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -c|--config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        --no-config)
            NO_CONFIG=true
            shift
            ;;
        --init-config)
            INIT_CONFIG_ONLY=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            log_error "未知选项: $1"
            show_help
            exit 1
            ;;
    esac
done

# ============ 验证参数 ============
# 检查 single 脚本是否存在
if [ ! -f "${SINGLE_SCRIPT}" ]; then
    log_error "找不到单任务脚本: ${SINGLE_SCRIPT}"
    exit 1
fi

# 验证 tasks_dir
if [ ! -d "${TASKS_DIR}" ]; then
    log_error "任务目录不存在: ${TASKS_DIR}"
    exit 1
fi

TASKS_DIR="$(cd "${TASKS_DIR}" && pwd)"

# 设置默认配置文件路径
if [ -z "${CONFIG_FILE}" ]; then
    CONFIG_FILE="${TASKS_DIR}/${CONFIG_FILENAME}"
fi

# 验证 command
case "${COMMAND}" in
    check|oracle|agent|post|all)
        ;;
    *)
        log_error "未知命令: ${COMMAND}"
        log_info "有效命令: check, oracle, agent, post, all"
        exit 1
        ;;
esac

# ============ 配置文件函数 ============

# 扫描目录获取所有有效任务
scan_all_tasks() {
    local tasks=()
    for task_dir in "${TASKS_DIR}"/*/; do
        [ -d "${task_dir}" ] || continue
        local task_name
        task_name="$(basename "${task_dir}")"
        # 检查是否是有效的任务目录
        if [ -f "${task_dir}/instruction.md" ]; then
            tasks+=("${task_name}")
        fi
    done
    printf '%s\n' "${tasks[@]}" | sort
}

# 生成配置文件
generate_config() {
    local config_path="$1"
    log_info "生成配置文件: ${config_path}"

    {
        echo "# Harbor 批量测试配置文件"
        echo "# 生成时间: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "# "
        echo "# 每行一个任务名，# 开头的行会被跳过"
        echo "# 要禁用某个任务，在行首添加 # 即可"
        echo "# "
        echo ""
        scan_all_tasks
    } > "${config_path}"

    local task_count
    task_count=$(scan_all_tasks | wc -l)
    log_success "配置文件已生成，包含 ${task_count} 个任务"
    log_info "编辑配置文件可以控制要执行的任务: ${config_path}"
}

# 从配置文件读取任务列表
read_config() {
    local config_path="$1"
    if [ ! -f "${config_path}" ]; then
        return 1
    fi
    # 读取非空、非注释行
    grep -v '^#' "${config_path}" | grep -v '^[[:space:]]*$' | sed 's/[[:space:]]*$//'
}

# ============ 收集任务 ============
collect_tasks() {
    local tasks=()
    local task_names=()

    # 决定任务来源：配置文件 或 目录扫描
    if [ "${NO_CONFIG}" = true ]; then
        # 忽略配置文件，直接扫描
        while IFS= read -r task_name; do
            task_names+=("${task_name}")
        done < <(scan_all_tasks)
    else
        # 读取配置文件
        while IFS= read -r task_name; do
            task_names+=("${task_name}")
        done < <(read_config "${CONFIG_FILE}")
    fi

    # 处理每个任务
    for task_name in "${task_names[@]}"; do
        local task_dir="${TASKS_DIR}/${task_name}"

        # 检查目录是否存在
        [ -d "${task_dir}" ] || continue

        # 检查是否是有效的任务目录
        [ -f "${task_dir}/instruction.md" ] || continue

        # 检查是否在 include 列表中（如果指定了）
        if [ ${#INCLUDE_TASKS[@]} -gt 0 ]; then
            local found=false
            for include in "${INCLUDE_TASKS[@]}"; do
                if [ "${task_name}" = "${include}" ]; then
                    found=true
                    break
                fi
            done
            if [ "${found}" = false ]; then
                continue
            fi
        fi

        # 检查是否在 exclude 列表中
        local excluded=false
        for exclude in "${EXCLUDE_TASKS[@]}"; do
            if [ "${task_name}" = "${exclude}" ]; then
                excluded=true
                break
            fi
        done
        if [ "${excluded}" = true ]; then
            continue
        fi

        tasks+=("${task_dir}")
    done

    printf '%s\n' "${tasks[@]}"
}

# ============ 工具函数 ============
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

# ============ 创建软链接 ============
create_symlinks() {
    local task_path="$1"
    local task_name
    task_name="$(basename "${task_path}")"

    # post_logs 软链接
    local task_logs_dir="${task_path}/post_logs"
    if [ -d "${task_logs_dir}" ]; then
        rm -f "${UNIFIED_LOGS_DIR}/${task_name}"
        ln -s "${task_logs_dir}" "${UNIFIED_LOGS_DIR}/${task_name}"
    fi

    # harbor_jobs 软链接
    for sub in oracle agent; do
        local sub_dir="${task_path}/harbor_jobs/${sub}"
        [ -d "${sub_dir}" ] || continue
        for job_dir in "${sub_dir}"/*/; do
            [ -d "${job_dir}" ] || continue
            local job_name
            job_name="$(basename "${job_dir}")"
            local link_name="${task_name}_${sub}-${job_name}"
            rm -f "${UNIFIED_JOBS_DIR}/${link_name}"
            ln -s "${job_dir%/}" "${UNIFIED_JOBS_DIR}/${link_name}"
        done
    done
}

# ============ 预检查：任务是否全部可跳过 ============
# 判断一个任务在当前 COMMAND 下是否所有步骤都已有输出（无需真正执行）
_task_all_skippable() {
    local task_path="$1"
    local cmd="$2"
    local jobs_dir="${task_path}/harbor_jobs"
    local log_dir="${task_path}/post_logs"

    case "${cmd}" in
        check)
            [ -f "${log_dir}/harbor_check.json" ]
            ;;
        oracle)
            [ -d "${jobs_dir}/oracle" ] && [ -n "$(ls -A "${jobs_dir}/oracle" 2>/dev/null)" ]
            ;;
        agent)
            [ -d "${jobs_dir}/agent" ] && [ -n "$(ls -A "${jobs_dir}/agent" 2>/dev/null)" ]
            ;;
        post)
            [ -d "${log_dir}" ] && ls "${log_dir}"/claude_*.md &>/dev/null
            ;;
        all)
            [ -f "${log_dir}/harbor_check.json" ] \
                && [ -d "${jobs_dir}/oracle" ] && [ -n "$(ls -A "${jobs_dir}/oracle" 2>/dev/null)" ] \
                && [ -d "${jobs_dir}/agent" ] && [ -n "$(ls -A "${jobs_dir}/agent" 2>/dev/null)" ]
            ;;
        *)
            return 1
            ;;
    esac
}

# ============ 实时 Dashboard ============
_SPIN_CHARS='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
_SPIN_IDX=0
_DASHBOARD_LINES=0
_GLOBAL_START=0

declare -A _TASK_PIDS=()
declare -A _TASK_STATES=()
declare -a _ALL_TASK_NAMES=()
declare -a _ALL_TASK_PATHS=()

# 从 step_id 提取短名 (post_01_rl_value → rl_value, check → Check)
_short_step_name() {
    local sid="$1"
    case "${sid}" in
        check)  echo "Check" ;;
        oracle) echo "Oracle" ;;
        agent)  echo "Agent" ;;
        *)
            # 去掉 prefix_NN_ (如 post_01_rl_value → rl_value)
            local short="${sid#*_[0-9][0-9]_}"
            [ "${short}" = "${sid}" ] && short="${sid}"
            # 截断过长的名字
            [ ${#short} -gt 10 ] && short="${short:0:9}~"
            echo "${short}"
            ;;
    esac
}

# 解析 .task_status 文件，生成步骤图标字符串
_format_step_icons() {
    local content="$1"
    local spin="$2"
    local elapsed="${content%% *}"
    local steps_str="${content#* }"
    local result=""

    local token
    for token in ${steps_str}; do
        if [ "${token}" = "|" ]; then
            result="${result}\033[0;36m│\033[0m "
            continue
        fi
        local sid="${token%%:*}"
        local code="${token##*:}"
        local short
        short=$(_short_step_name "${sid}")

        case "${code}" in
            D) result="${result}\033[0;32m✓${short}\033[0m " ;;
            R) result="${result}\033[0;34m${spin}${short}\033[0m " ;;
            F) result="${result}\033[0;31m✗${short}\033[0m " ;;
            S) result="${result}\033[0;36m–${short}\033[0m " ;;
            *)  result="${result}\033[1;33m·${short}\033[0m " ;;
        esac
    done

    printf '%b' "${result}"
}

render_multi_dashboard() {
    local now
    now=$(date +%s)
    local total_elapsed=$(( now - _GLOBAL_START ))
    _SPIN_IDX=$(( _SPIN_IDX + 1 ))
    local spin="${_SPIN_CHARS:$(( _SPIN_IDX % ${#_SPIN_CHARS} )):1}"

    # 上移光标
    if [ ${_DASHBOARD_LINES} -gt 0 ]; then
        printf '\033[%dA' "${_DASHBOARD_LINES}"
    fi
    _DASHBOARD_LINES=0

    # 统计完成数和运行数
    local done_cnt=0 running_cnt=0
    for tn in "${_ALL_TASK_NAMES[@]}"; do
        case "${_TASK_STATES[$tn]}" in
            done|failed|timeout) done_cnt=$(( done_cnt + 1 )) ;;
            running) running_cnt=$(( running_cnt + 1 )) ;;
        esac
    done

    # 标题栏
    printf '\033[K  %b═══ 批量测试  ⏱ %s  进度: %d/%d  运行中: %d  并行: %d ═══%b\n' \
        "${CYAN}" "$(format_duration ${total_elapsed})" \
        "${done_cnt}" "${#_ALL_TASK_NAMES[@]}" "${running_cnt}" "${MAX_JOBS}" "${NC}"
    _DASHBOARD_LINES=$(( _DASHBOARD_LINES + 1 ))

    for i in "${!_ALL_TASK_NAMES[@]}"; do
        local tn="${_ALL_TASK_NAMES[$i]}"
        local tp="${_ALL_TASK_PATHS[$i]}"
        local state="${_TASK_STATES[$tn]}"

        # 前导图标 + 颜色
        local lead_icon lead_color
        case "${state}" in
            pending)  lead_icon="○"; lead_color="${YELLOW}" ;;
            running)  lead_icon="${spin}"; lead_color="${BLUE}" ;;
            done)     lead_icon="✓"; lead_color="${GREEN}" ;;
            failed)   lead_icon="✗"; lead_color="${RED}" ;;
            timeout)  lead_icon="⏰"; lead_color="${RED}" ;;
            *)        lead_icon="?"; lead_color="${NC}" ;;
        esac

        # 读取 .task_status 文件获取步骤详情
        local sf="${tp}/post_logs/.task_status"
        local content=""
        if [ -f "${sf}" ]; then
            content=$(cat "${sf}" 2>/dev/null) || content=""
        fi

        if [ -n "${content}" ]; then
            # 有状态文件：显示每个步骤的图标
            local elapsed="${content%% *}"
            local step_icons
            step_icons=$(_format_step_icons "${content}" "${spin}")
            local time_str
            time_str="$(format_duration ${elapsed:-0})"
            # 尾部附加整体状态标签
            local tail_label=""
            case "${state}" in
                done)    tail_label=" ${GREEN}✓${NC}" ;;
                failed)  tail_label=" ${RED}✗${NC}" ;;
                timeout) tail_label=" ${RED}⏰${NC}" ;;
            esac
            printf '\033[K  %b %s %b %-24s %b%b  %b%s%b\n' \
                "${lead_color}" "${lead_icon}" "${NC}" "${tn}" \
                "${step_icons}" "${tail_label}" \
                "${lead_color}" "${time_str}" "${NC}"
        else
            # 无状态文件
            case "${state}" in
                pending)
                    printf '\033[K  %b ○ %b %-24s %b等待中%b\n' \
                        "${YELLOW}" "${NC}" "${tn}" "${YELLOW}" "${NC}"
                    ;;
                running)
                    printf '\033[K  %b %s %b %-24s %b启动中...%b\n' \
                        "${BLUE}" "${spin}" "${NC}" "${tn}" "${BLUE}" "${NC}"
                    ;;
                *)
                    printf '\033[K  %b %s %b %-24s %b%s%b\n' \
                        "${lead_color}" "${lead_icon}" "${NC}" "${tn}" \
                        "${lead_color}" "${state}" "${NC}"
                    ;;
            esac
        fi
        _DASHBOARD_LINES=$(( _DASHBOARD_LINES + 1 ))
    done
}

# ============ 环境变量导出 ============
export SKIP_EXISTING="${SKIP_EXISTING:-true}"
export API_PROVIDER="${API_PROVIDER:-qiniu}"

# ============ 主函数 ============
main() {
    # 如果只是初始化配置文件
    if [ "${INIT_CONFIG_ONLY}" = true ]; then
        print_separator "生成配置文件"
        generate_config "${CONFIG_FILE}"
        exit 0
    fi

    # 检查配置文件是否存在（除非使用 --no-config）
    if [ "${NO_CONFIG}" = false ] && [ ! -f "${CONFIG_FILE}" ]; then
        print_separator "生成配置文件"
        generate_config "${CONFIG_FILE}"
        echo ""
        log_info "请编辑配置文件后重新运行脚本"
        exit 0
    fi

    print_separator "Harbor 批量测试 - 开始"

    log_info "任务目录: ${TASKS_DIR}"
    log_info "命令: ${COMMAND}"
    log_info "API 提供商: ${API_PROVIDER}"
    log_info "并行数: ${MAX_JOBS}"
    log_info "单任务超时: ${TASK_TIMEOUT}s"
    if [ "${NO_CONFIG}" = true ]; then
        log_info "配置文件: (忽略，扫描目录)"
    else
        log_info "配置文件: ${CONFIG_FILE}"
    fi

    # 收集任务
    local tasks_str
    tasks_str=$(collect_tasks)

    if [ -z "${tasks_str}" ]; then
        log_error "没有找到有效的任务"
        exit 1
    fi

    # 转换为数组
    local TASKS=()
    while IFS= read -r task; do
        [ -n "${task}" ] && TASKS+=("${task}")
    done <<< "${tasks_str}"
    local task_count=${#TASKS[@]}

    log_info "找到 ${task_count} 个任务"
    echo ""

    # 显示任务列表
    echo -e "${CYAN}任务列表:${NC}"
    for task in "${TASKS[@]}"; do
        echo "  - $(basename "${task}")"
    done
    echo ""

    # 如果是 dry-run，到这里就结束
    if [ "${DRY_RUN}" = true ]; then
        log_info "Dry-run 模式，不实际执行"
        exit 0
    fi

    # 创建批量日志目录
    local batch_log_dir="${TASKS_DIR}/.batch_logs/${TIMESTAMP}"
    mkdir -p "${batch_log_dir}"

    # 创建统一的 harbor_jobs 目录（软链接目标）
    UNIFIED_JOBS_DIR="${TASKS_DIR}/harbor_jobs"
    mkdir -p "${UNIFIED_JOBS_DIR}"
    export UNIFIED_JOBS_DIR

    # 创建统一的 post_logs 目录（软链接目标）
    UNIFIED_LOGS_DIR="${TASKS_DIR}/post_logs"
    mkdir -p "${UNIFIED_LOGS_DIR}"
    export UNIFIED_LOGS_DIR

    # ---- 初始化任务队列 ----
    _GLOBAL_START=$(date +%s)
    _ALL_TASK_NAMES=()
    _ALL_TASK_PATHS=()
    for task in "${TASKS[@]}"; do
        local tn
        tn="$(basename "${task}")"
        _ALL_TASK_NAMES+=("${tn}")
        _ALL_TASK_PATHS+=("${task}")
        _TASK_STATES["${tn}"]="pending"
    done

    local pending_idx=0

    # 清理函数
    cleanup_multi() {
        for pid in "${_TASK_PIDS[@]}"; do
            kill "${pid}" 2>/dev/null || true
        done
        wait 2>/dev/null || true
    }
    trap cleanup_multi EXIT

    echo ""  # 面板前留空行

    # ---- 主循环：调度 + 监控 + 渲染 ----
    while true; do
        # 1. 检查已完成的任务
        for tn in "${!_TASK_PIDS[@]}"; do
            if ! kill -0 "${_TASK_PIDS[$tn]}" 2>/dev/null; then
                wait "${_TASK_PIDS[$tn]}" 2>/dev/null
                local rc=$?
                unset '_TASK_PIDS['"${tn}"']'
                if [ ${rc} -eq 0 ]; then
                    _TASK_STATES["${tn}"]="done"
                elif [ ${rc} -eq 124 ]; then
                    _TASK_STATES["${tn}"]="timeout"
                else
                    _TASK_STATES["${tn}"]="failed"
                fi
                # 创建软链接
                for i in "${!_ALL_TASK_NAMES[@]}"; do
                    if [ "${_ALL_TASK_NAMES[$i]}" = "${tn}" ]; then
                        create_symlinks "${_ALL_TASK_PATHS[$i]}"
                        break
                    fi
                done
            fi
        done

        # 2. 启动新任务（如果有空位）
        while [ ${pending_idx} -lt ${#_ALL_TASK_NAMES[@]} ]; do
            local tn="${_ALL_TASK_NAMES[$pending_idx]}"
            local tp="${_ALL_TASK_PATHS[$pending_idx]}"

            # 预检查：如果 SKIP_EXISTING 且关键输出已存在，直接标记完成不占槽位
            if [ "${SKIP_EXISTING}" = true ] && _task_all_skippable "${tp}" "${COMMAND}"; then
                pending_idx=$(( pending_idx + 1 ))
                _TASK_STATES["${tn}"]="done"
                create_symlinks "${tp}"
                continue
            fi

            # 真正需要执行的任务，检查是否有空槽位
            [ ${#_TASK_PIDS[@]} -ge ${MAX_JOBS} ] && break

            pending_idx=$(( pending_idx + 1 ))

            local task_log_dir="${batch_log_dir}/${tn}"
            mkdir -p "${task_log_dir}"

            # 写入 UTF-8 BOM，确保 VS Code 等编辑器自动识别编码
            printf '\xEF\xBB\xBF' > "${task_log_dir}/stdout.log"
            printf '\xEF\xBB\xBF' > "${task_log_dir}/stderr.log"

            # 启动 single.sh（带超时，输出重定向到日志，追加模式保留 BOM）
            (
                timeout "${TASK_TIMEOUT}" "${SINGLE_SCRIPT}" "${tp}" "${COMMAND}"
            ) >> "${task_log_dir}/stdout.log" 2>> "${task_log_dir}/stderr.log" &
            _TASK_PIDS["${tn}"]=$!
            _TASK_STATES["${tn}"]="running"
        done

        # 3. 渲染面板
        render_multi_dashboard

        # 4. 检查是否全部完成
        local all_done=true
        for tn in "${_ALL_TASK_NAMES[@]}"; do
            case "${_TASK_STATES[$tn]}" in
                pending|running) all_done=false; break ;;
            esac
        done
        if [ "${all_done}" = true ]; then break; fi

        sleep 0.5
    done

    # 最终渲染
    render_multi_dashboard

    # ---- 结果汇总 ----
    print_separator "执行完成 - 结果汇总"

    local success_count=0
    local fail_count=0
    local timeout_count=0
    local failed_tasks=()
    local timeout_tasks=()

    for tn in "${_ALL_TASK_NAMES[@]}"; do
        case "${_TASK_STATES[$tn]}" in
            done) success_count=$(( success_count + 1 )) ;;
            timeout) timeout_count=$(( timeout_count + 1 )); timeout_tasks+=("${tn}") ;;
            failed) fail_count=$(( fail_count + 1 )); failed_tasks+=("${tn}") ;;
        esac
    done

    echo -e "${GREEN}成功: ${success_count}${NC} / ${task_count}"
    echo -e "${YELLOW}超时: ${timeout_count}${NC} / ${task_count}"
    echo -e "${RED}失败: ${fail_count}${NC} / ${task_count}"
    echo ""

    if [ ${timeout_count} -gt 0 ]; then
        echo -e "${YELLOW}超时的任务 (>${TASK_TIMEOUT}s):${NC}"
        for task in "${timeout_tasks[@]}"; do
            echo "  - ${task}"
            echo "    日志: ${batch_log_dir}/${task}/"
        done
        echo ""
    fi

    if [ ${fail_count} -gt 0 ]; then
        echo -e "${RED}失败的任务:${NC}"
        for task in "${failed_tasks[@]}"; do
            echo "  - ${task}"
            echo "    日志: ${batch_log_dir}/${task}/"
        done
        echo ""
    fi

    echo -e "${CYAN}批量日志目录:${NC}"
    echo "  ${batch_log_dir}"
    echo ""

    echo -e "${GREEN}Harbor View 命令:${NC}"
    echo -e "  ${YELLOW}uv run harbor view ${UNIFIED_JOBS_DIR}${NC}"
    echo ""
    echo -e "${CYAN}统一 Logs 目录:${NC}"
    echo "  ${UNIFIED_LOGS_DIR}"
    echo ""

    # 返回失败数作为退出码
    if [ ${fail_count} -gt 0 ] || [ ${timeout_count} -gt 0 ]; then
        exit 1
    fi
}

main
