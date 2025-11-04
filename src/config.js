require('dotenv').config();

/**
 * 从环境变量加载运行时配置
 */
function loadRuntimeConfig() {
    // GitLab 配置
    const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
    const CI_PROJECT_ID = process.env.CI_PROJECT_ID;
    const CI_MERGE_REQUEST_IID = process.env.CI_MERGE_REQUEST_IID;
    const CI_API_V4_URL = process.env.CI_API_V4_URL; // e.g., https://gitlab.com/api/v4

    // AI 模型配置
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const REVIEW_MODEL = process.env.REVIEW_MODEL || 'qwen3-coder-plus';

    // 审查配置
    const MAX_PARALLEL = parseInt(process.env.MAX_PARALLEL || '3', 10);
    const ISSUE_LIMIT = parseInt(process.env.ISSUE_LIMIT || '10', 10);
    const REVIEW_MODE = process.env.REVIEW_MODE || 'report'; // 'report' or 'inline'
    
    // 功能开关
    const ENABLE_AST = process.env.ENABLE_AST !== 'false'; // 默认启用
    const DRY_RUN = process.env.DRY_RUN === 'true';

    // Diff 大小限制（防止超大文件消耗过多token）
    const MAX_DIFF_LINES = parseInt(process.env.MAX_DIFF_LINES || '500', 10);
    const MAX_DIFF_CHARS = parseInt(process.env.MAX_DIFF_CHARS || '50000', 10);

    // AST 配置
    const AST_MAX_SNIPPET_LENGTH = parseInt(process.env.AST_MAX_SNIPPET_LENGTH || '10000', 10);
    const AST_MAX_BLOCK_SIZE_LINES = parseInt(process.env.AST_MAX_BLOCK_SIZE_LINES || '150', 10);
    const AST_MAX_DEPTH = parseInt(process.env.AST_MAX_DEPTH || '60', 10);
    const AST_TIMEOUT_MS = parseInt(process.env.AST_TIMEOUT_MS || '8000', 10);

    // 路径配置
    const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();
    const GUIDELINES_FILE = process.env.GUIDELINES_FILE || 'coding_guidelines.yaml';

    // 验证必需的环境变量
    const required = {
        GITLAB_TOKEN,
        CI_PROJECT_ID,
        CI_MERGE_REQUEST_IID,
        CI_API_V4_URL,
        OPENAI_API_KEY
    };

    for (const [key, value] of Object.entries(required)) {
        if (!value) {
            throw new Error(`缺少必需的环境变量: ${key}`);
        }
    }

    // 规范化 GitLab API URL
    const gitlabApiUrl = CI_API_V4_URL.endsWith('/') 
        ? CI_API_V4_URL.slice(0, -1) 
        : CI_API_V4_URL;

    return {
        // GitLab
        gitlabToken: GITLAB_TOKEN,
        projectId: CI_PROJECT_ID,
        mergeRequestIid: CI_MERGE_REQUEST_IID,
        gitlabApiUrl,

        // AI 模型
        aiApiKey: OPENAI_API_KEY,
        aiApiUrl: OPENAI_BASE_URL,
        aiModel: REVIEW_MODEL,

        // 审查参数
        maxParallel: MAX_PARALLEL,
        issueLimit: ISSUE_LIMIT,
        reviewMode: REVIEW_MODE,

        // 功能开关
        enableAst: ENABLE_AST,
        dryRun: DRY_RUN,

        // Diff 限制
        maxDiffLines: MAX_DIFF_LINES,
        maxDiffChars: MAX_DIFF_CHARS,

        // AST 配置
        astConfig: {
            maxSnippetLength: AST_MAX_SNIPPET_LENGTH,
            maxBlockSizeLines: AST_MAX_BLOCK_SIZE_LINES,
            maxDepth: AST_MAX_DEPTH,
            timeoutMs: AST_TIMEOUT_MS,
        },

        // 路径
        projectRoot: PROJECT_ROOT,
        guidelinesFile: GUIDELINES_FILE,
    };
}

module.exports = {
    loadRuntimeConfig,
};
