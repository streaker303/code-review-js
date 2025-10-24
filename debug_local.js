// debug_local.js

/**
 * 本地调试脚本
 * 
 * 使用此脚本可以在本地环境中模拟 CI 流程，针对一个特定的 GitLab Merge Request 进行代码审查。
 * 它会自动加载 .env 文件中的配置，并调用核心审查逻辑。
 * 
 * 如何使用:
 * 1. 在项目根目录创建 .env 文件，填入以下配置：
 *    GITLAB_TOKEN=your_gitlab_token_here
 *    OPENAI_API_KEY=your_openai_api_key_here
 *    CI_API_V4_URL=https://gitlabxxxxxx.cn/api/v4
 *    ENABLE_AST=true  # 启用 AST 上下文分析
 *    REVIEW_MODE=inline  # 或 report
 * 
 * 2. 修改下面配置区的三个参数：
 *    - GITLAB_PROJECT_ID: GitLab 项目 ID
 *    - GITLAB_MR_IID: Merge Request 的 ID
 *    - TARGET_PROJECT_PATH: 目标项目路径（如果不在同一目录），如果不开启 AST 功能，可以留空
 * 
 * 3. 运行调试:
 *    方式 1: node debug_local.js
 *    方式 2: 在 VS Code 中按 F5 启动调试器
 *    方式 3: node --inspect-brk debug_local.js (然后在 Chrome 中调试)
 * 
 * 注意事项:
 * - TARGET_PROJECT_PATH 支持相对路径和绝对路径
 * - 相对路径是相对于当前脚本所在目录（即 AI 文件夹）
 * - Linux 和 Windows 路径都会自动处理
 */

require('dotenv').config();
const { runReview } = require('./src/main');

// --- ⚙️ 配置区：请修改为你需要调试的目标 ---
const GITLAB_PROJECT_ID = "your_project_id"; // 👈 修改这里: 你的 GitLab 项目 ID
const GITLAB_MR_IID = "your_mr_id";       // 👈 修改这里: 你想审查的 Merge Request IID (纯数字)
const TARGET_PROJECT_PATH = "../your-project/"; // 👈 修改这里: 目标项目的相对路径或绝对路径
// ----------------------------------------------------

async function debug() {
    console.log("--- 🚀 开始本地调试模式 ---");

    if (!process.env.GITLAB_TOKEN || !process.env.OPENAI_API_KEY) {
        console.error("🚨 错误: 请确保 GITLAB_TOKEN 和 OPENAI_API_KEY 已经在你的 .env 文件中正确设置。");
        return;
    }

    if (GITLAB_PROJECT_ID === "your_project_id" || GITLAB_MR_IID === "your_mr_iid") {
        console.error("🚨 错误: 请先在此脚本中修改 GITLAB_PROJECT_ID 和 GITLAB_MR_IID 的值。");
        return;
    }

    // 模拟 GitLab CI 提供的环境变量
    process.env.CI_PROJECT_ID = GITLAB_PROJECT_ID;
    process.env.CI_MERGE_REQUEST_IID = GITLAB_MR_IID;

    // 设置项目根目录（用于 AST 功能定位文件）
    const path = require('path');
    const resolvedProjectPath = path.resolve(__dirname, TARGET_PROJECT_PATH);
    process.env.PROJECT_ROOT = resolvedProjectPath;
    
    console.log(`项目 ID: ${process.env.CI_PROJECT_ID}`);
    console.log(`Merge Request IID: ${process.env.CI_MERGE_REQUEST_IID}`);
    console.log(`项目根目录: ${resolvedProjectPath}`);

    // 调用核心审查函数
    await runReview();

    console.log("--- ✅ 本地调试结束 ---");
}

debug().catch(error => {
    console.error("本地调试过程中发生错误:", error);
});
