# Claude Code API 提供商配置指南

本文档说明如何配置 Claude Code 通过七牛 (Qiniu) 或 OpenRouter 转发请求。

## 原理

Claude Code 使用以下环境变量控制 API 路由：

| 环境变量 | 说明 |
|---------|------|
| `ANTHROPIC_BASE_URL` | API 基础地址（替代 Anthropic 官方地址） |
| `ANTHROPIC_AUTH_TOKEN` | 认证令牌（使用第三方提供商的 API Key） |
| `ANTHROPIC_API_KEY` | **必须设为空字符串**（禁用官方 Key，避免冲突） |

> 关键：`ANTHROPIC_API_KEY=""` 必须显式设置为空，否则 Claude Code 可能仍使用官方 Key。

## 配置方法：Shell 别名

在 `~/.zshrc` 或 `~/.bashrc` 中添加以下配置：

### 七牛 (Qiniu)

```bash
export QINIU_API_BASE="https://api.qnaigc.com"
export QINIU_API_KEY="你的七牛API密钥"

alias qiniu_on='export ANTHROPIC_BASE_URL=$QINIU_API_BASE && \
    export ANTHROPIC_AUTH_TOKEN="$QINIU_API_KEY" && \
    export ANTHROPIC_API_KEY="" && \
    echo "Qiniu 环境已启用"'

alias qiniu_off='unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY && \
    echo "Qiniu 环境已禁用"'
```

使用方式：
```bash
qiniu_on     # 启用七牛，之后运行的 claude 命令都走七牛
qiniu_off    # 禁用，恢复使用官方 API
```

### OpenRouter

```bash
export OPENROUTER_API_BASE="https://openrouter.ai/api/v1/"
export OPENROUTER_API_KEY="你的OpenRouter API密钥"

alias or_on='export ANTHROPIC_BASE_URL="https://openrouter.ai/api" && \
    export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY" && \
    export ANTHROPIC_API_KEY="" && \
    echo "OpenRouter 环境已启用"'

alias or_off='unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY && \
    echo "OpenRouter 环境已禁用"'
```

使用方式：
```bash
or_on        # 启用 OpenRouter
claude -p "hello"
or_off       # 禁用
```

## .env 文件配置

脚本会自动加载 `.env` 文件。确保 `.env` 包含以下配置：

```bash
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
```

## 注意事项

1. **ANTHROPIC_API_KEY 必须为空**：设置第三方提供商时，必须 `export ANTHROPIC_API_KEY=""`，否则 Claude Code 可能忽略 `ANTHROPIC_BASE_URL` 而直接使用官方 API。
2. **URL 路径差异**：
   - 七牛 ANTHROPIC 兼容模式：`https://api.qnaigc.com`（不带 `/v1`）
   - 七牛 OpenAI 兼容模式（Harbor 用）：`https://api.qnaigc.com/v1`（带 `/v1`）
   - OpenRouter ANTHROPIC 兼容模式：`https://openrouter.ai/api`（不带 `/v1`）
   - OpenRouter OpenAI 兼容模式（Harbor 用）：`https://openrouter.ai/api/v1/`（带 `/v1`）
3. **两种提供商不会冲突**：Harbor 通过模型名前缀（`openai/` vs `openrouter/`）路由请求，`.env` 中可同时配置两者。`API_PROVIDER` 只影响默认模型和 Claude Code 的 ANTHROPIC_* 环境变量。
