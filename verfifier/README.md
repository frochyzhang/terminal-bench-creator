# Submit Automatic Verify — 任务提交自动化核验工具

本项目提供一套标准化的自动核验流程，用于在任务提交后对 Terminal Bench 任务进行质量检查、标准答案验证、Agent 测试和 AI 辅助评审。

> **Harbor 版本要求**：本项目使用 **harbor v0.1.42**，`setup.sh` 会自动安装该版本。如需手动安装：`uv tool install "harbor==0.1.42"`。

## 目录结构

```
submit_automatic_verify/
├── .env                                      # 环境变量（API Key 等）
├── setup.sh                                  # 一键环境配置脚本
├── run_harbor_test_single.sh                 # 单任务核验脚本
├── run_harbor_test_multiple.sh               # 批量并行核验脚本
├── final_collect_meta.sh                     # 收集核验元数据并分类
├── final_organize_tasks.sh                   # 整理任务为提交结构
├── claude_code_api_provider_config.md       # Claude Code API 提供商配置指南
│
├── post_check_prompts/                       # [必需] 基础质量评审
│   ├── 01_rl_value.md                        #   RL 训练价值与基础质量检查
│   └── 02_test_quality.md                    #   测试代码与环境配置质量检查
│
└── post_check_trace_prompts/                 # [可选] Trace 失败归因分析
    └── 01_trace_failure_analysis.md          #   基于 Agent Trace 的失败归因
```

> **必需 vs 可选**：`post_check_prompts/` 是每次核验都会执行的必需评审项。`post_check_trace_prompts/` 仅在 Agent 测试产生了 trajectory 文件时才会自动执行，属于可选的深度分析。

## 快速开始

### 1. 安装依赖

```bash
# 一键安装所有依赖（uv、harbor v0.1.42、claude、docker）
bash setup.sh

# 中国大陆用户使用镜像安装 uv
UV_MIRROR=1 bash setup.sh
```

### 2. 配置环境变量

```bash
# 编辑 .env，填入真实的 API Key（setup.sh 会自动生成模板）
vim .env
```

### 3. 切换 API 提供商（可选）

通过 `API_PROVIDER` 环境变量切换，支持 `qiniu`（默认）和 `openrouter`：

```bash
API_PROVIDER=openrouter ./run_harbor_test_single.sh /path/to/task
```

如需为 Claude Code 本身配置第三方 API 转发（七牛 / OpenRouter），参见 [claude_code_api_provider_config.md](claude_code_api_provider_config.md)。

### 4. 运行单个任务的完整核验

```bash
./run_harbor_test_single.sh /path/to/task
```

### 5. 批量运行多个任务

```bash
./run_harbor_test_multiple.sh /path/to/tasks_dir
```

## 核验流程概览

```
┌─────────────────────────────────────────────────────┐
│  1. Harbor Check    — 任务质量自动检查               │
│  2. Harbor Oracle   — 标准答案（solution）验证       │
│  3. Harbor Agent    — AI Agent 自动测试              │
│  4. Post Checks     — Claude Code AI 评审            │
│     ├── 基础质量 + RL 价值评审  [必需]               │
│     ├── 测试代码与环境质量评审  [必需]               │
│     └── Trace 失败归因          [可选, 需有 trace]   │
└─────────────────────────────────────────────────────┘
```

## 脚本详细说明

### run_harbor_test_single.sh — 单任务核验

```bash
./run_harbor_test_single.sh <task_path> [command]
```

**命令选项**：

| 命令 | 说明 |
| :--- | :--- |
| `check` | 只运行 Harbor 质量检查 |
| `oracle` | 只运行 Oracle 标准答案验证 |
| `agent` | 只运行 Agent 测试 |
| `post` | 只运行 Claude Code 后检查 |
| `all` | 运行所有步骤（默认） |

**环境变量**：

| 变量 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `API_PROVIDER` | API 提供商 | `qiniu`（可选 `openrouter`） |
| `AGENT_MODEL` | Agent 使用的模型 | 由 `API_PROVIDER` 决定 |
| `AGENT_TYPE` | Agent 类型 | `terminus-2` |
| `AGENT_ATTEMPTS` | Agent 测试次数 | `4` |
| `CHECK_MODEL` | Harbor check 使用的模型 | 由 `API_PROVIDER` 决定 |
| `TASK_TIMEOUT` | 任务超时时间（秒） | `3600` |
| `SKIP_EXISTING` | 跳过已有输出 | `true` |
| `JOBS_DIR` | Harbor jobs 输出目录 | `<task_dir>/harbor_jobs` |

**`API_PROVIDER` 对应的默认模型**：

| 项目 | `qiniu` | `openrouter` |
| :--- | :--- | :--- |
| AGENT_MODEL | `openai/claude-4.5-opus` | `openrouter/anthropic/claude-opus-4.5` |
| CHECK_MODEL | `openai/deepseek/deepseek-v3.2-251201` | `openrouter/deepseek/deepseek-v3.2` |

**示例**：

```bash
# 完整核验（默认走七牛）
./run_harbor_test_single.sh /path/to/task

# 使用 OpenRouter
API_PROVIDER=openrouter ./run_harbor_test_single.sh /path/to/task

# 只跑 Oracle 验证
./run_harbor_test_single.sh /path/to/task oracle

# 使用自定义模型跑 Agent 测试
AGENT_MODEL=openrouter/anthropic/claude-opus-4.5 AGENT_ATTEMPTS=2 \
  ./run_harbor_test_single.sh /path/to/task agent

# 强制重跑所有步骤（不跳过已有输出）
SKIP_EXISTING=false ./run_harbor_test_single.sh /path/to/task all
```

---

### run_harbor_test_multiple.sh — 批量并行核验

并行执行多个任务的核验，支持配置文件管理任务列表。

```bash
./run_harbor_test_multiple.sh <tasks_dir> [command] [options]
```

**选项**：

| 选项 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `-j, --jobs N` | 并行任务数 | `30` |
| `-T, --timeout SEC` | 单个任务超时时间 | `3600` |
| `-t, --task TASK` | 只运行指定任务（可多次使用） | — |
| `-e, --exclude TASK` | 排除指定任务（可多次使用） | — |
| `-d, --dry-run` | 只显示要运行的任务 | — |
| `-c, --config FILE` | 指定配置文件 | `<tasks_dir>/tasks.conf` |
| `--no-config` | 忽略配置文件，扫描所有任务 | — |
| `--init-config` | 只生成配置文件 | — |

**配置文件**：首次运行时会自动在 `tasks_dir` 下生成 `tasks.conf`，每行一个任务名。用 `#` 注释掉不需要执行的任务。

**示例**：

```bash
# 全量核验所有任务（默认走七牛）
./run_harbor_test_multiple.sh /path/to/tasks

# 使用 OpenRouter，8 并行只跑 Agent
API_PROVIDER=openrouter ./run_harbor_test_multiple.sh /path/to/tasks agent -j 8

# 只跑指定任务
./run_harbor_test_multiple.sh /path/to/tasks all -t task_a -t task_b

# 预览任务列表
./run_harbor_test_multiple.sh /path/to/tasks all -d
```

---

### final_collect_meta.sh — 收集核验元数据

核验完成后，扫描任务目录下的 `harbor_jobs/` 结果，为每个任务生成 `meta.json`，并按 oracle/agent 通过次数做初步分类。

> **注意**：本脚本 **仅根据 oracle/agent 的通过次数** 做初步筛选，输出的 "qualified" 只代表通过了数量门槛。一个任务要真正合格，还需要通过完整核验流程中的所有环节（Harbor Check、Post Check 评审等），并补充人工编写的考察点和错误分析。本脚本的输出应作为批量筛选的起点，而非最终判定。

```bash
./final_collect_meta.sh <tasks_dir>
```

**筛选条件**（qualified）：
- Oracle mean = 1.0（标准答案全部通过）
- Agent 至少有 1 次通过 **且** 至少有 1 次失败（具备区分度）

**输出文件**（生成在 `tasks_dir` 下）：

| 文件 | 说明 |
| :--- | :--- |
| `qualified_tasks.jsonl` | 通过数量筛选的任务列表（每行一个 JSON） |
| `qualified_tasks_summary.txt` | 通过数量筛选的任务摘要 |
| `unqualified_tasks.jsonl` | 未通过数量筛选的任务列表 |
| `unqualified_tasks_summary.txt` | 未通过数量筛选的任务摘要（按原因分组） |
| `<task>/meta.json` | 每个任务的 oracle/agent 元信息 |

**示例**：

```bash
# 收集 data 目录下所有任务的元数据
./final_collect_meta.sh ./data

# 收集指定目录
./final_collect_meta.sh /path/to/tasks
```

---

### final_organize_tasks.sh — 整理任务为提交结构

将核验过的任务目录整理成规范的 `.submitted` 提交结构，包含核心文件和附录（评审报告、运行日志等）。

```bash
./final_organize_tasks.sh <source_dir> [--prefix PREFIX] [--start NUM]
```

**选项**：

| 选项 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `--prefix PREFIX` | 为目标目录名添加前缀 | 无 |
| `--start NUM` | 起始编号 | `1` |

**输出结构**（生成在 `<source_dir>.submitted/` 下）：

```
<task_name>/
├── environment/              # Dockerfile 等环境配置
├── instruction.md            # 任务说明
├── solution/                 # 参考解答
├── task.toml                 # 任务元数据
├── tests/                    # 测试文件
└── appendix/                 # 附录
    ├── oracle_job/           # Oracle 运行产物
    ├── agent_job/            # Agent 运行产物
    ├── basic_evaluation.txt  # RL 价值评审（自动生成）
    ├── env_evaluation.txt    # 测试质量评审（自动生成）
    ├── points.txt            # 任务考察点（⚠️ 人工编写）
    ├── error_analysis.txt    # 模型错误轨迹分析（⚠️ 人工编写）
    ├── check_result.log      # Harbor check 结果（可读文本）
    ├── oracle_result.log     # Oracle 结果摘要
    ├── agent_result.log      # Agent 结果摘要
    └── meta.json             # 任务元信息
```

**示例**：

```bash
# 整理 data 目录下的任务
./final_organize_tasks.sh ./data

# 添加前缀
./final_organize_tasks.sh /path/to/tasks --prefix batch01
```

## Prompt 目录说明

每个 prompt 目录下放置 `.md` 格式的评审 prompt 文件，按文件名排序依次执行。

### 必需的评审项

| 目录 | 文件 | 说明 |
| :--- | :--- | :--- |
| `post_check_prompts/` | `01_rl_value.md` | RL 训练价值与基础质量（拼写、逻辑一致性、开放性、假难题等） |
| `post_check_prompts/` | `02_test_quality.md` | 测试代码质量（覆盖度、过严/过松、防 Hack、环境完整性、网络隔离） |

### 可选的深度分析（需 Agent trace）

| 目录 | 文件 | 说明 |
| :--- | :--- | :--- |
| `post_check_trace_prompts/` | `01_trace_failure_analysis.md` | Agent 失败归因（指令/测试/环境/能力问题分类） |

### 扩展评审项

可以在任意 prompt 目录下添加新的 `.md` 文件来扩展评审维度。文件命名建议使用数字前缀以控制执行顺序：

```
post_check_prompts/
├── 01_rl_value.md
├── 02_test_quality.md
└── 03_your_new_check.md    # 新增的评审维度
```

## 人工编写项

以下两个文件**不会自动生成**，需要在核验完成后由人工编写，放到任务的 `post_logs/` 目录下：

| 文件 | 说明 | 存放位置 |
| :--- | :--- | :--- |
| `points.txt` | 任务考察点（能力维度、难度评估） | `<task_path>/post_logs/points.txt` |
| `error_analysis.txt` | 模型错误轨迹分析（基于 Agent trace 的失败归因与错误分类） | `<task_path>/post_logs/error_analysis.txt` |

`final_organize_tasks.sh` 会自动将这两个文件复制到 `appendix/` 中。如果缺失，整理时会输出 WARNING 提醒。

## 输出说明

核验完成后，输出文件位于任务目录下：

```
<task_path>/
├── post_logs/                        # Claude Code 评审输出 + 人工编写项
│   ├── claude_01_rl_value.md         # RL 价值评审报告（自动）
│   ├── claude_02_test_quality.md     # 测试质量评审报告（自动）
│   ├── claude_trace_*.md             # [可选] Trace 分析报告（自动）
│   ├── points.txt                    # 任务考察点（⚠️ 人工编写）
│   ├── error_analysis.txt            # 错误轨迹分析（⚠️ 人工编写）
│   ├── harbor_check.json             # Harbor check 结果
│   └── all_paths.log                 # 所有输出路径汇总
│
└── harbor_jobs/                      # Harbor 运行数据
    ├── oracle/                       # Oracle 验证结果
    └── agent/                        # Agent 测试结果
```

批量运行时，统一的结果汇总位于 `<tasks_dir>/` 下：

```
<tasks_dir>/
├── harbor_jobs/      # 所有任务 Harbor 结果的软链接
├── post_logs/        # 所有任务评审结果的软链接
└── .batch_logs/      # 批量运行日志（按时间戳组织）
```

## 常见问题

**Q: `claude` 命令不可用怎么办？**
A: 运行 `bash setup.sh` 自动安装。如果没有安装，后检查步骤会自动跳过。

**Q: 如何切换 API 提供商？**
A: 通过 `API_PROVIDER` 环境变量切换，详细配置参见 [claude_code_api_provider_config.md](claude_code_api_provider_config.md)。
```bash
API_PROVIDER=openrouter ./run_harbor_test_single.sh /path/to/task
```

**Q: 如何重新运行某个已完成的检查？**
A: 默认会跳过已有输出。设置 `SKIP_EXISTING=false` 强制重跑：
```bash
SKIP_EXISTING=false ./run_harbor_test_single.sh /path/to/task post
```

**Q: 如何查看 Harbor 的可视化结果？**
A: 运行完成后使用：
```bash
uv run --with "harbor==0.1.42" harbor view <task_path>/harbor_jobs
```
