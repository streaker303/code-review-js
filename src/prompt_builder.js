const fs = require('fs/promises');
const path = require('path');

// 缓存
let systemPromptTemplate = null;

/**
 * 加载 System Prompt 模板
 */
async function loadSystemPromptTemplate() {
    if (!systemPromptTemplate) {
        try {
            const promptPath = path.resolve(process.cwd(), 'system_prompt.txt');
            systemPromptTemplate = await fs.readFile(promptPath, 'utf-8');
        } catch (error) {
            throw new Error(`无法加载 system_prompt.txt: ${error.message}`);
        }
    }
    return systemPromptTemplate;
}

/**
 * 加载编码规范（固定为 YAML 格式）
 */
async function loadGuidelines() {
    try {
        const yaml = require('js-yaml');
        const guidelinesFile = path.resolve(process.cwd(), 'coding_guidelines.yaml');
        const content = await fs.readFile(guidelinesFile, 'utf-8');
        return yaml.load(content) || {};
    } catch (error) {
        console.warn(`未找到或无法解析规范文件 coding_guidelines.yaml，将跳过规范检查。`);
        return {};
    }
}

/**
 * 构建 System Prompt
 * @param {Object} options
 * @param {Object} options.guidelines - 编码规范
 * @param {number} options.issueLimit - 问题数量限制
 * @param {boolean} options.enableAst - 是否启用 AST
 */
async function buildSystemPrompt({ guidelines, issueLimit, enableAst }) {
    const template = await loadSystemPromptTemplate();
    
    const guidelineIds = guidelines?.guidelines?.map(g => g.id).join(', ') || '';
    
    // 使用 JSON 格式化规范（更稳定）
    const guidelinesText = guidelines && Object.keys(guidelines).length > 0
        ? JSON.stringify(guidelines, null, 2)
        : "未提供编码规范文件";
    
    // 安全的字符串替换（转义大括号，兼容 Linux 和 Windows）
    let prompt = template
        .replace(/\{GUIDELINE_JSON_TEXT\}/g, guidelinesText)
        .replace(/\{GUIDELINE_IDS\}/g, guidelineIds)
        .replace(/\{ISSUE_LIMIT\}/g, String(issueLimit));

    // 如果未启用 AST，移除 AST 相关的描述（通过标记块精准移除）
    if (!enableAst) {
        prompt = prompt.replace(/<!-- AST_SECTION_START -->[\s\S]*?<!-- AST_SECTION_END -->\n?/g, '');
    }

    return prompt;
}

/**
 * 构建 User Content
 * @param {Object} options
 * @param {string} options.filePath - 文件路径
 * @param {string} options.extendedDiff - 带行号的 diff
 * @param {Object} options.astContext - AST 上下文（可选）
 */
function buildUserContent({ filePath, extendedDiff, astContext }) {
    const oldPath = filePath;
    const newPath = filePath;

    let content = `## new_path: ${newPath}\n## old_path: ${oldPath}\n${extendedDiff}`;
    
    // 只有在有 AST 上下文且包含受影响的代码段时才添加
    if (astContext && astContext.impacted_sections && astContext.impacted_sections.length > 0) {
        content += '\n\n# AST 上下文（辅助信息）\n';
        content += '以下是包含变更行的完整函数/类代码，帮助你理解修改的上下文。\n';
        content += '**注意**：并非所有 Diff 变更都会有 AST 上下文，这是正常的。请以 Diff 为主要审查依据。\n\n';
        
        // 逐个展示受影响的代码段
        astContext.impacted_sections.forEach((section, index) => {
            content += `## 代码段 ${index + 1}: ${section.name}\n`;
            content += `- **类型**: ${section.type}\n`;
            content += `- **位置**: 第 ${section.start_line}-${section.end_line} 行\n`;
            content += `- **新增行号**: [${section.added_lines.join(', ')}]\n`;
            content += `- **完整代码**:\n\`\`\`\n${section.snippet}\n\`\`\`\n\n`;
        });
        
        // 如果有解析错误，附加错误信息
        if (astContext.errors && astContext.errors.length > 0) {
            content += `**注意**: AST 解析遇到以下问题: ${astContext.errors.join(', ')}\n`;
        }
    }
    
    return content;
}

module.exports = {
    loadGuidelines,
    buildSystemPrompt,
    buildUserContent,
};

