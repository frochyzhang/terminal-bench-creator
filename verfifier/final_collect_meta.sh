#!/usr/bin/env bash
# ==============================================================================
# final_collect_meta.sh - 收集任务核验元数据并分类
# ==============================================================================
#
# 功能：
#   遍历 tasks_dir 下的任务子目录，读取 harbor_jobs 中的 result.json，
#   为每个任务生成 meta.json，并按核验结果分为 qualified / unqualified。
#
# 用法：
#   ./final_collect_meta.sh <tasks_dir>
#
# 示例：
#   ./final_collect_meta.sh ./data
#   ./final_collect_meta.sh /path/to/tasks
#
# 判定标准 (qualified):
#   - oracle mean = 1.0 (标准答案全部通过)
#   - agent 至少有 1 次通过 且 至少有 1 次失败 (区分度)
#
# 输出文件:
#   <tasks_dir>/qualified_tasks.jsonl          # 合格任务 (每行一个 JSON)
#   <tasks_dir>/qualified_tasks_summary.txt    # 合格任务摘要
#   <tasks_dir>/unqualified_tasks.jsonl        # 不合格任务 (每行一个 JSON)
#   <tasks_dir>/unqualified_tasks_summary.txt  # 不合格任务摘要 (分组)
#   <task_dir>/meta.json                       # 每个任务的元信息
#
# ==============================================================================

set -euo pipefail

if [ $# -ne 1 ]; then
    echo "Usage: $0 <tasks_dir>"
    echo "Example: $0 ./data"
    exit 1
fi

TASKS_DIR="$1"

if [ ! -d "$TASKS_DIR" ]; then
    echo "Error: directory does not exist: $TASKS_DIR"
    exit 1
fi

QUALIFIED_JSONL="$TASKS_DIR/qualified_tasks.jsonl"
QUALIFIED_TXT="$TASKS_DIR/qualified_tasks_summary.txt"
UNQUALIFIED_JSONL="$TASKS_DIR/unqualified_tasks.jsonl"
UNQUALIFIED_TXT="$TASKS_DIR/unqualified_tasks_summary.txt"

# Temp buffers for grouping unqualified tasks (3 categories)
BUF_ORACLE_FAIL=$(mktemp)
BUF_AGENT_ALL_FAIL=$(mktemp)
BUF_AGENT_ALL_PASS=$(mktemp)

# Clear output files
> "$QUALIFIED_JSONL"
> "$QUALIFIED_TXT"
> "$UNQUALIFIED_JSONL"
> "$UNQUALIFIED_TXT"

echo "Scanning: $TASKS_DIR"
echo "=========================================="
echo ""

TOTAL=0
QUALIFIED=0
UNQUALIFIED=0

for task_dir in "$TASKS_DIR"/*/; do
    [ -d "$task_dir" ] || continue
    task_name=$(basename "$task_dir")

    # 跳过非任务目录
    case "$task_name" in
        harbor_jobs|post_logs|.batch_logs|__pycache__) continue ;;
    esac

    # 必须有 instruction.md 才算任务
    [ -f "$task_dir/instruction.md" ] || continue

    TOTAL=$((TOTAL + 1))

    # --- 自动探测 result.json 路径 ---
    # 原始结构: harbor_jobs/oracle/*/result.json
    # .submitted 结构: appendix/oracle_job/result.json
    oracle_result_file=$({ find "$task_dir/harbor_jobs/oracle" -name "result.json" -maxdepth 2 2>/dev/null || true; } | head -1)
    [ -z "$oracle_result_file" ] && oracle_result_file=$({ find "$task_dir/appendix/oracle_job" -name "result.json" -maxdepth 1 2>/dev/null || true; } | head -1)

    agent_result_file=$({ find "$task_dir/harbor_jobs/agent" -name "result.json" -maxdepth 2 2>/dev/null || true; } | head -1)
    [ -z "$agent_result_file" ] && agent_result_file=$({ find "$task_dir/appendix/agent_job" -name "result.json" -maxdepth 1 2>/dev/null || true; } | head -1)

    # --- Parse oracle result ---
    oracle_mean="N/A"
    oracle_n_trials=0
    oracle_n_pass=0
    oracle_n_fail=0

    if [ -n "$oracle_result_file" ] && [ -f "$oracle_result_file" ]; then
        oracle_info=$(python3 -c "
import json, sys
d = json.load(open('$oracle_result_file'))
evals = list(d['stats']['evals'].values())[0]
mean = evals['metrics'][0]['mean']
n_trials = evals['n_trials']
reward_stats = evals['reward_stats'].get('reward', {})
n_pass = len(reward_stats.get('1.0', []))
n_fail = len(reward_stats.get('0.0', []))
print(f'{mean} {n_trials} {n_pass} {n_fail}')
" 2>/dev/null || echo "N/A 0 0 0")
        oracle_mean=$(echo "$oracle_info" | awk '{print $1}')
        oracle_n_trials=$(echo "$oracle_info" | awk '{print $2}')
        oracle_n_pass=$(echo "$oracle_info" | awk '{print $3}')
        oracle_n_fail=$(echo "$oracle_info" | awk '{print $4}')
    fi

    # --- Parse agent result ---
    agent_mean="N/A"
    agent_n_trials=0
    agent_n_pass=0
    agent_n_fail=0
    agent_n_errors=0
    agent_model="unknown"

    if [ -n "$agent_result_file" ] && [ -f "$agent_result_file" ]; then
        agent_info=$(python3 -c "
import json, sys
d = json.load(open('$agent_result_file'))
evals = list(d['stats']['evals'].values())[0]
mean = evals['metrics'][0]['mean']
n_trials = evals['n_trials']
n_errors = evals['n_errors']
reward_stats = evals['reward_stats'].get('reward', {})
n_pass = len(reward_stats.get('1.0', []))
n_fail = len(reward_stats.get('0.0', []))
# extract model name from eval key
eval_key = list(d['stats']['evals'].keys())[0]
print(f'{mean} {n_trials} {n_pass} {n_fail} {n_errors} {eval_key}')
" 2>/dev/null || echo "N/A 0 0 0 0 unknown")
        agent_mean=$(echo "$agent_info" | awk '{print $1}')
        agent_n_trials=$(echo "$agent_info" | awk '{print $2}')
        agent_n_pass=$(echo "$agent_info" | awk '{print $3}')
        agent_n_fail=$(echo "$agent_info" | awk '{print $4}')
        agent_n_errors=$(echo "$agent_info" | awk '{print $5}')
        agent_model=$(echo "$agent_info" | awk '{print $6}')
    fi

    # --- Write per-task meta.json ---
    python3 -c "
import json
meta = {
    'task': '$task_name',
    'oracle': {
        'mean': $( [ "$oracle_mean" = "N/A" ] && echo "None" || echo "$oracle_mean" ),
        'n_trials': $oracle_n_trials,
        'n_pass': $oracle_n_pass,
        'n_fail': $oracle_n_fail
    },
    'agent': {
        'model': '$agent_model',
        'mean': $( [ "$agent_mean" = "N/A" ] && echo "None" || echo "$agent_mean" ),
        'n_trials': $agent_n_trials,
        'n_pass': $agent_n_pass,
        'n_fail': $agent_n_fail,
        'n_errors': $agent_n_errors,
        'score': '${agent_n_pass}/${agent_n_trials}'
    }
}
with open('$task_dir/meta.json', 'w') as f:
    json.dump(meta, f, indent=2, default=str)
"

    # --- Display ---
    echo "  $task_name"
    echo "    oracle: $oracle_n_pass/$oracle_n_trials (mean=$oracle_mean)"
    echo "    agent:  $agent_n_pass/$agent_n_trials (mean=$agent_mean)  [$agent_model]"

    # --- Check qualification ---
    # oracle must be 1.0, agent must have at least 1 pass AND at least 1 fail
    is_qualified=false
    reject_reason=""
    has_results=false

    # Determine if we have any result files at all
    if [ -n "$oracle_result_file" ] || [ -n "$agent_result_file" ]; then
        has_results=true
    fi

    if [ "$oracle_mean" = "1.0" ] && [ "$agent_n_trials" -gt 0 ] 2>/dev/null; then
        if [ "$agent_n_pass" -gt 0 ] && [ "$agent_n_pass" -lt "$agent_n_trials" ]; then
            is_qualified=true
        elif [ "$agent_n_pass" -eq 0 ]; then
            reject_reason="agent=0/$agent_n_trials"
        else
            reject_reason="agent=$agent_n_pass/$agent_n_trials"
        fi
    elif $has_results; then
        # Build reason for rejection
        if [ "$oracle_mean" = "N/A" ]; then
            reject_reason="no_oracle_result"
        elif [ "$oracle_mean" != "1.0" ]; then
            reject_reason="oracle_mean=$oracle_mean"
        fi
        if [ "$agent_mean" = "N/A" ]; then
            reject_reason="${reject_reason:+${reject_reason},}no_agent_result"
        elif [ "$agent_n_trials" -eq 0 ] 2>/dev/null; then
            reject_reason="${reject_reason:+${reject_reason},}no_agent_result"
        fi
    fi

    if $is_qualified; then
        echo "    => QUALIFIED"
        QUALIFIED=$((QUALIFIED + 1))
        # Append to jsonl
        python3 -c "
import json
meta = json.load(open('$task_dir/meta.json'))
meta['qualified'] = True
print(json.dumps(meta))
" >> "$QUALIFIED_JSONL"
        # Append to summary txt
        echo "$task_name  oracle=$oracle_n_pass/$oracle_n_trials  agent=$agent_n_pass/$agent_n_trials" >> "$QUALIFIED_TXT"
    elif $has_results; then
        echo "    => UNQUALIFIED ($reject_reason)"
        UNQUALIFIED=$((UNQUALIFIED + 1))
        python3 -c "
import json
meta = json.load(open('$task_dir/meta.json'))
meta['qualified'] = False
meta['reject_reason'] = '$reject_reason'
print(json.dumps(meta))
" >> "$UNQUALIFIED_JSONL"
        # Dispatch to the right category buffer
        unq_line="$task_name  oracle=$oracle_n_pass/$oracle_n_trials  agent=$agent_n_pass/$agent_n_trials  reason=$reject_reason"
        if [ "$oracle_mean" != "1.0" ]; then
            echo "$unq_line" >> "$BUF_ORACLE_FAIL"
        elif [ "$agent_n_pass" -eq 0 ] 2>/dev/null; then
            echo "$unq_line" >> "$BUF_AGENT_ALL_FAIL"
        else
            echo "$unq_line" >> "$BUF_AGENT_ALL_PASS"
        fi
    else
        echo "    => NO RESULTS"
    fi

    echo ""
done

# Merge unqualified buffers into unqualified_tasks_summary.txt (3 groups, separated by blank lines)
_first=true
for _buf in "$BUF_ORACLE_FAIL" "$BUF_AGENT_ALL_FAIL" "$BUF_AGENT_ALL_PASS"; do
    if [ -s "$_buf" ]; then
        $_first || printf '\n\n\n' >> "$UNQUALIFIED_TXT"
        cat "$_buf" >> "$UNQUALIFIED_TXT"
        _first=false
    fi
done

rm -f "$BUF_ORACLE_FAIL" "$BUF_AGENT_ALL_FAIL" "$BUF_AGENT_ALL_PASS"

echo "=========================================="
echo "Total tasks:       $TOTAL"
echo "Qualified tasks:   $QUALIFIED"
echo "Unqualified tasks: $UNQUALIFIED  (has results but not meeting criteria)"
echo "No results:        $((TOTAL - QUALIFIED - UNQUALIFIED))"
echo ""
echo "Meta files written to each task directory: meta.json"
echo "Qualified list:      $QUALIFIED_JSONL"
echo "Qualified summary:   $QUALIFIED_TXT"
echo "Unqualified list:    $UNQUALIFIED_JSONL"
echo "Unqualified summary: $UNQUALIFIED_TXT"
