#!/usr/bin/env bash
# ==============================================================================
# final_organize_tasks.sh - 将任务目录整理成规范的 .submitted 结构
# ==============================================================================
#
# 功能：
#   遍历 source_dir 下的任务子目录，将每个任务的核心文件和核验产物
#   整理到统一的 .submitted/ 输出目录中，便于最终提交。
#
# 用法：
#   ./final_organize_tasks.sh <source_dir> [--prefix PREFIX] [--start NUM]
#
# 示例：
#   ./final_organize_tasks.sh ./data
#   ./final_organize_tasks.sh /path/to/tasks --prefix batch01
#   ./final_organize_tasks.sh /path/to/tasks --start 100
#
# 输出结构 (每个任务):
#   <task_name>/
#   ├── environment/          # Dockerfile 等环境配置
#   ├── instruction.md        # 任务说明
#   ├── solution/             # 参考解答 (solve.sh)
#   ├── task.toml             # 任务元数据
#   ├── tests/                # 测试文件
#   └── appendix/             # 附录: 评估报告、运行日志等
#       ├── oracle_job/       # oracle 运行产物 (最新一次)
#       ├── agent_job/        # agent 运行产物 (最新一次)
#       ├── basic_evaluation.txt    # post_logs/claude_01_rl_value.md
#       ├── env_evaluation.txt      # post_logs/claude_02_test_quality.md
#       ├── points.txt              # [人工编写] 任务考察点
#       ├── error_analysis.txt      # [人工编写] 模型错误轨迹分析
#       ├── check_result.log        # post_logs/harbor_check.json (转为可读文本)
#       ├── oracle_result.log       # oracle 运行的 job.log + result.json 摘要
#       ├── agent_result.log        # agent 运行的 job.log + result.json 摘要
#       └── meta.json               # 任务元信息 (如有)
#
# ==============================================================================

set -uo pipefail

# ─── 参数解析 ───
PREFIX=""
START_NUM=1
SOURCE_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --prefix)
            PREFIX="$2"
            shift 2
            ;;
        --start)
            START_NUM="$2"
            shift 2
            ;;
        -h|--help)
            head -38 "$0" | tail -37
            exit 0
            ;;
        *)
            if [ -z "$SOURCE_DIR" ]; then
                SOURCE_DIR="$1"
            else
                echo "Error: unexpected argument '$1'"
                exit 1
            fi
            shift
            ;;
    esac
done

if [ -z "$SOURCE_DIR" ]; then
    echo "Usage: $0 <source_dir> [--prefix PREFIX] [--start NUM]"
    exit 1
fi

if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: directory does not exist: $SOURCE_DIR"
    exit 1
fi

# 转为绝对路径
SOURCE_DIR=$(cd "$SOURCE_DIR" && pwd)

# 输出目录: 在 source_dir 同级创建 <basename>.submitted/
OUTPUT_DIR="${SOURCE_DIR}.submitted"
mkdir -p "$OUTPUT_DIR"

echo "Source:  $SOURCE_DIR"
echo "Output:  $OUTPUT_DIR"
echo "Prefix:  ${PREFIX:-<none>}"
echo "Start#:  $START_NUM"
echo "=========================================="
echo ""

# ─── 辅助函数 ───

# 生成 oracle/agent result 摘要日志
generate_result_log() {
    local job_type="$1"  # oracle or agent
    local job_dir="$2"   # harbor_jobs/oracle 或 harbor_jobs/agent
    local output_file="$3"

    if [ ! -d "$job_dir" ]; then
        echo "[No $job_type job found]" > "$output_file"
        return
    fi

    # 找最新的 timestamp 目录
    local latest_run
    latest_run=$(ls -1d "$job_dir"/*/ 2>/dev/null | sort | tail -1)
    if [ -z "$latest_run" ]; then
        echo "[No $job_type runs found]" > "$output_file"
        return
    fi

    {
        echo "=== $job_type Result ==="
        echo "Run: $(basename "$latest_run")"
        echo ""

        # result.json 摘要
        if [ -f "$latest_run/result.json" ]; then
            echo "--- Result Summary ---"
            python3 -c "
import json, sys
try:
    d = json.load(open('$latest_run/result.json'))
    print(f\"Started:  {d.get('started_at', 'N/A')}\")
    print(f\"Finished: {d.get('finished_at', 'N/A')}\")
    print(f\"Total trials: {d.get('n_total_trials', 'N/A')}\")
    stats = d.get('stats', {})
    print(f\"N trials: {stats.get('n_trials', 'N/A')}\")
    print(f\"N errors: {stats.get('n_errors', 'N/A')}\")
    for eval_name, eval_data in stats.get('evals', {}).items():
        print(f\"\nEval: {eval_name}\")
        metrics = eval_data.get('metrics', [{}])
        if metrics:
            print(f\"  Mean reward: {metrics[0].get('mean', 'N/A')}\")
        reward_stats = eval_data.get('reward_stats', {}).get('reward', {})
        for score, trials in sorted(reward_stats.items()):
            print(f\"  Score {score}: {len(trials)} trial(s)\")
except Exception as e:
    print(f'Error parsing result.json: {e}')
" 2>/dev/null || echo "[Error reading result.json]"
            echo ""
        fi

        # job.log 内容
        if [ -f "$latest_run/job.log" ] && [ -s "$latest_run/job.log" ]; then
            echo "--- Job Log ---"
            cat "$latest_run/job.log"
            echo ""
        fi

        # 每个 trial 的简要结果
        echo "--- Trial Results ---"
        for trial_dir in "$latest_run"/*/; do
            [ -d "$trial_dir" ] || continue
            trial_name=$(basename "$trial_dir")
            # 至少有 config.json 或 trial.log 才算 trial 目录
            [ -f "$trial_dir/config.json" ] || [ -f "$trial_dir/trial.log" ] || continue

            reward="N/A"
            if [ -f "$trial_dir/verifier/reward.txt" ]; then
                reward=$(tr -d '[:space:]' < "$trial_dir/verifier/reward.txt")
            fi
            echo "  $trial_name: reward=$reward"

            # 如果有 test-stdout，输出摘要
            if [ -f "$trial_dir/verifier/test-stdout.txt" ]; then
                echo "    --- test output (last 20 lines) ---"
                tail -20 "$trial_dir/verifier/test-stdout.txt" | sed 's/^/    /'
                echo ""
            fi
        done
    } > "$output_file"
}

# 拷贝 harbor_jobs 的最新一次运行产物
copy_job_artifacts() {
    local job_type="$1"  # oracle or agent
    local job_dir="$2"   # harbor_jobs/oracle 或 harbor_jobs/agent
    local dest_dir="$3"  # appendix/oracle_job 或 appendix/agent_job

    if [ ! -d "$job_dir" ]; then
        return
    fi

    local latest_run
    latest_run=$(ls -1d "$job_dir"/*/ 2>/dev/null | sort | tail -1)
    if [ -z "$latest_run" ]; then
        return
    fi

    mkdir -p "$dest_dir"

    # 拷贝 job 级文件
    for f in config.json result.json job.log; do
        [ -f "$latest_run/$f" ] && cp "$latest_run/$f" "$dest_dir/"
    done

    # 拷贝每个 trial (只保留关键文件，跳过大的 agent 录制文件)
    for trial_dir in "$latest_run"/*/; do
        [ -d "$trial_dir" ] || continue
        trial_name=$(basename "$trial_dir")
        # 至少有 config.json 或 trial.log 才算 trial 目录
        [ -f "$trial_dir/config.json" ] || [ -f "$trial_dir/trial.log" ] || continue

        trial_dest="$dest_dir/$trial_name"
        mkdir -p "$trial_dest"

        # trial 级别文件
        for f in config.json result.json trial.log exception.txt; do
            [ -f "$trial_dir/$f" ] && cp "$trial_dir/$f" "$trial_dest/"
        done

        # verifier 结果
        if [ -d "$trial_dir/verifier" ]; then
            mkdir -p "$trial_dest/verifier"
            cp "$trial_dir/verifier/"* "$trial_dest/verifier/" 2>/dev/null || true
        fi

        # agent 目录: 只拷贝 trajectory.json (轨迹分析用), 跳过 recording.cast 等大文件
        if [ -d "$trial_dir/agent" ]; then
            mkdir -p "$trial_dest/agent"
            [ -f "$trial_dir/agent/trajectory.json" ] && cp "$trial_dir/agent/trajectory.json" "$trial_dest/agent/"
        fi
    done
}

# ─── 主循环 ───

NUM=$START_NUM
TASK_COUNT=0

for task_dir in "$SOURCE_DIR"/*/; do
    [ -d "$task_dir" ] || continue
    task_name=$(basename "$task_dir")

    # 跳过非任务目录
    case "$task_name" in
        harbor_jobs|post_logs|.batch_logs|__pycache__) continue ;;
    esac

    # 必须至少有 instruction.md 才算是任务目录
    if [ ! -f "$task_dir/instruction.md" ]; then
        echo "SKIP (no instruction.md): $task_name"
        continue
    fi

    TASK_COUNT=$((TASK_COUNT + 1))

    # 生成目标目录名: 直接使用原名，可选前缀
    if [ -n "$PREFIX" ]; then
        dest_name="${PREFIX}_${task_name}"
    else
        dest_name="${task_name}"
    fi
    dest_dir="$OUTPUT_DIR/$dest_name"

    echo "[$NUM] $task_name -> $dest_name"

    # 清理已有目标
    rm -rf "$dest_dir"
    mkdir -p "$dest_dir"

    # ── 1. 核心文件 ──

    # environment/
    if [ -d "$task_dir/environment" ]; then
        cp -r "$task_dir/environment" "$dest_dir/environment"
    else
        mkdir -p "$dest_dir/environment"
        echo "[WARNING] No environment/ directory found" >&2
    fi

    # instruction.md
    cp "$task_dir/instruction.md" "$dest_dir/instruction.md"

    # solution/
    if [ -d "$task_dir/solution" ]; then
        cp -r "$task_dir/solution" "$dest_dir/solution"
    else
        mkdir -p "$dest_dir/solution"
        echo "[WARNING] No solution/ directory found for $task_name" >&2
    fi

    # task.toml
    if [ -f "$task_dir/task.toml" ]; then
        cp "$task_dir/task.toml" "$dest_dir/task.toml"
    else
        echo "[WARNING] No task.toml found for $task_name" >&2
    fi

    # tests/
    if [ -d "$task_dir/tests" ]; then
        cp -r "$task_dir/tests" "$dest_dir/tests"
    else
        mkdir -p "$dest_dir/tests"
        echo "[WARNING] No tests/ directory found for $task_name" >&2
    fi

    # ── 2. appendix/ ──
    appendix_dir="$dest_dir/appendix"
    mkdir -p "$appendix_dir"

    # oracle_job/ 和 agent_job/
    copy_job_artifacts "oracle" "$task_dir/harbor_jobs/oracle" "$appendix_dir/oracle_job"
    copy_job_artifacts "agent"  "$task_dir/harbor_jobs/agent"  "$appendix_dir/agent_job"

    # basic_evaluation.txt (from claude_01_rl_value.md)
    if [ -f "$task_dir/post_logs/claude_01_rl_value.md" ]; then
        cp "$task_dir/post_logs/claude_01_rl_value.md" "$appendix_dir/basic_evaluation.txt"
    fi

    # env_evaluation.txt (from claude_02_test_quality.md)
    if [ -f "$task_dir/post_logs/claude_02_test_quality.md" ]; then
        cp "$task_dir/post_logs/claude_02_test_quality.md" "$appendix_dir/env_evaluation.txt"
    fi

    # check_result.log (from harbor_check.json -> 转为可读文本)
    if [ -f "$task_dir/post_logs/harbor_check.json" ]; then
        python3 -c "
import json, sys
try:
    d = json.load(open('$task_dir/post_logs/harbor_check.json'))
    print('=== Harbor Check Results ===')
    print()
    if isinstance(d, dict):
        for key, val in d.items():
            if isinstance(val, dict):
                outcome = val.get('outcome', 'N/A')
                comment = val.get('comment', '')
                print(f'  [{outcome:>15}] {key}')
                if comment:
                    print(f'                    {comment}')
            else:
                print(f'  {key}: {val}')
    else:
        print(json.dumps(d, indent=2))
except Exception as e:
    print(f'Error: {e}')
    # fallback: 直接拷贝原始 JSON
    with open('$task_dir/post_logs/harbor_check.json') as f:
        print(f.read())
" > "$appendix_dir/check_result.log" 2>/dev/null
    fi

    # oracle_result.log
    generate_result_log "oracle" "$task_dir/harbor_jobs/oracle" "$appendix_dir/oracle_result.log"

    # agent_result.log
    generate_result_log "agent" "$task_dir/harbor_jobs/agent" "$appendix_dir/agent_result.log"

    # points.txt (人工编写，放在 post_logs/ 下)
    if [ -f "$task_dir/post_logs/points.txt" ]; then
        cp "$task_dir/post_logs/points.txt" "$appendix_dir/points.txt"
    else
        echo "    [WARN] 缺少 post_logs/points.txt (需人工编写)"
    fi

    # error_analysis.txt (人工编写，放在 post_logs/ 下)
    if [ -f "$task_dir/post_logs/error_analysis.txt" ]; then
        cp "$task_dir/post_logs/error_analysis.txt" "$appendix_dir/error_analysis.txt"
    else
        echo "    [WARN] 缺少 post_logs/error_analysis.txt (需人工编写)"
    fi

    # meta.json (如有)
    if [ -f "$task_dir/meta.json" ]; then
        cp "$task_dir/meta.json" "$appendix_dir/meta.json"
    fi

    NUM=$((NUM + 1))
    echo "  -> OK"
done

echo ""
echo "=========================================="
echo "Total tasks organized: $TASK_COUNT"
echo "Output directory: $OUTPUT_DIR"
echo ""

# 生成目录索引
INDEX_FILE="$OUTPUT_DIR/INDEX.txt"
{
    echo "Task Index"
    echo "Generated: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "Source: $SOURCE_DIR"
    echo "=========================================="
    echo ""
    for submit_dir in "$OUTPUT_DIR"/*/; do
        [ -d "$submit_dir" ] || continue
        name=$(basename "$submit_dir")
        # 检查 appendix 内文件情况
        has_oracle="N"
        has_agent="N"
        has_eval="N"
        [ -d "$submit_dir/appendix/oracle_job" ] && has_oracle="Y"
        [ -d "$submit_dir/appendix/agent_job" ] && has_agent="Y"
        [ -f "$submit_dir/appendix/basic_evaluation.txt" ] && has_eval="Y"
        echo "$name  oracle=$has_oracle  agent=$has_agent  eval=$has_eval"
    done
} > "$INDEX_FILE"

echo "Index: $INDEX_FILE"
