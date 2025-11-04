# AI 代码审查工具

基于阿里云百炼平台和GitLab CI/CD的自动化代码审查工具，通过AST分析提取代码上下文，利用大语言模型识别代码质量问题。

## 核心模块

- `src/main.js` - 主流程控制
- `src/config.js` - 配置管理
- `src/diff_utils.js` - Git差异解析
- `src/ast_context.js` - JS/TS/JSX的AST分析
- `src/ast_context_vue.js` - Vue文件的AST分析
- `src/ast_utils.js` - AST工具函数
- `src/ai_client.js` - AI模型调用
- `src/review_engine.js` - 审查引擎
- `src/gitlab_api.js` - GitLab API
- `src/report.js` - 报告生成
- `src/prompt_builder.js` - Prompt构建

## 工作流程

```mermaid
graph LR
    A[GitLab MR触发] --> B[加载配置]
    B --> C[获取Git Diff]
    C --> D[AST分析<br/>提取上下文]
    D --> E[AI模型审查]
    E --> F{发布模式}
    F -->|report| G[汇总报告]
    F -->|inline| H[行级评论]
    
    style A fill:#e1f5fe
    style E fill:#fff3e0
    style G fill:#e8f5e9
    style H fill:#e8f5e9
```

**流程说明**：
1. **触发**：MR提交时GitLab CI/CD自动触发
2. **解析**：获取代码差异，提取新增行号
3. **分析**：AST解析JS/TS/Vue文件，提取包含新增行的最小函数/类块
4. **审查**：构建Prompt调用AI模型，获取结构化问题报告
5. **发布**：根据配置发布Markdown报告或精准行级评论

## 技术特性

- **AST智能分析**: 支持JS/TS/JSX/Vue，最小包含块选择策略，防止过度截取
- **代码块限制**: 字符数/行数限制 + 超时保护 + 递归深度限制，防止Token浪费
- **双模式发布**: 报告模式（Markdown汇总）或行级评论模式（精准定位）
- **并发控制**: 限制并发数，避免API速率限制
- **自动清理**: 删除旧评论，保持MR界面整洁
- **容错机制**: AST解析失败时优雅降级

## 技术栈

- Node.js 16+ | @babel/parser + @babel/traverse | @vue/compiler-sfc
- axios | js-yaml | p-limit
- 阿里云百炼平台（通义千问模型API）

## 部署配置

### 1. CI/CD配置

在项目根目录创建 `.gitlab-ci.yml`：

```yaml
stages:
  - review

ai_code_review:
  stage: review
  variables:
    GIT_DEPTH: "0"
  before_script:
    - git clone https://gitlab-ci-token:${CI_JOB_TOKEN}@your-gitlab-domain/your-group/code-review-js.git
    - cd code-review-js
    - pnpm install
    - cp ../coding_guidelines.yaml . || echo "No custom guidelines"
  script:
    - node src/main.js
  only:
    - merge_requests
```

### 2. 环境变量配置

在GitLab项目中配置CI/CD变量（Settings → CI/CD → Variables）

**必需变量**：
| 变量 | 说明 |
|------|------|
| `GITLAB_TOKEN` | 项目访问令牌（需要 `api`、`read_repository` 权限） |
| `OPENAI_API_KEY` | 阿里云百炼平台API密钥 |

**可选变量**：
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENAI_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | AI模型API地址 |
| `REVIEW_MODEL` | `qwen3-coder-plus` | 使用的模型 |
| `MAX_PARALLEL` | `3` | 并发审查文件数 |
| `ISSUE_LIMIT` | `10` | 单文件问题数限制 |
| `REVIEW_MODE` | `report` | 发布模式：`report` 或 `inline` |
| `ENABLE_AST` | `true` | 是否启用AST分析 |
| `DRY_RUN` | `false` | 测试模式，不实际发布 |
| `MAX_DIFF_LINES` | `500` | Diff最大行数限制 |
| `MAX_DIFF_CHARS` | `50000` | Diff最大字符数限制 |

**AST配置**：
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AST_MAX_SNIPPET_LENGTH` | `20000` | 代码片段最大字符数 |
| `AST_MAX_BLOCK_SIZE_LINES` | `200` | 代码块最大行数 |
| `AST_MAX_DEPTH` | `60` | AST遍历最大深度 |
| `AST_TIMEOUT_MS` | `8000` | AST解析超时时间（毫秒） |

### 3. 编码规范配置（可选）

在项目根目录创建 `coding_guidelines.yaml`：

```yaml
guidelines:
  - id: "JS-001"
    category: "类型安全"
    description: "避免使用 any 类型，应使用具体类型或泛型"
    severity: "中"
    
  - id: "JS-002"
    category: "错误处理"
    description: "异步操作必须进行错误处理（try-catch 或 .catch）"
    severity: "高"
```
