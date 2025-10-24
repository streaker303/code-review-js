const pLimit = require('p-limit');
const { parseDiffNewlineMap, addLineNumbersToDiff } = require('./diff_utils');
const { extractAstContext } = require('./ast_context');
const { callChatCompletion } = require('./ai_client');
const { extractJson, convertReviewsToIssues } = require('./json_utils');
const { buildSystemPrompt, buildUserContent } = require('./prompt_builder');

/**
 * 审查单个文件
 * @param {string} filePath - 文件路径
 * @param {string} diffText - Diff 内容
 * @param {Object} config - 配置对象
 * @param {Object} guidelines - 编码规范
 * @param {string} systemPrompt - System Prompt
 */
async function reviewSingleFile(filePath, diffText, config, guidelines, systemPrompt) {
    // 添加行号标记
    const extendedDiffInfo = addLineNumbersToDiff(diffText);

    // 提取新增行号
    const addedLinesMap = parseDiffNewlineMap(diffText);
    const addedLines = new Set(addedLinesMap.map(([, newLine]) => newLine));

    // 提取 AST 上下文（如果启用）
    let astContext = null;
    if (config.enableAst) {
        astContext = await extractAstContext(filePath, addedLines, config.projectRoot);
    }

    // 构建 User Content
    const userContent = buildUserContent({
        filePath,
        extendedDiff: extendedDiffInfo.extendedDiff,
        astContext,
    });

    // 调用 AI 模型
    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
    ];

    try {
        const responseText = await callChatCompletion(messages, 0.2);
        
        // 解析 JSON 响应
        const jsonResult = extractJson(responseText);
        
        if (jsonResult.error) {
            console.error(`❌ 解析 JSON 失败: ${filePath}`, jsonResult.error.message);
            console.error(`响应内容（前500字符）: ${responseText.substring(0, 500)}`);
            return {
                file_path: filePath,
                status: 'ERROR',
                issues: [{
                    line: 0,
                    description: `JSON 解析失败: ${jsonResult.error.message}`,
                    severity: '高',
                    type: '解析错误'
                }],
                reviews: []
            };
        }
        
        // 转换为兼容格式
        const issues = convertReviewsToIssues(jsonResult.parsed.reviews || []);
        
        // 添加统计信息
        const added = diffText.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
        const deleted = diffText.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).length;

        return {
            file_path: filePath,
            status: issues.length > 0 ? 'WARNING' : 'PASS',
            issues,
            reviews: jsonResult.parsed.reviews || [],
            added_lines: added,
            deleted_lines: deleted,
            extendedDiffInfo,
        };

    } catch (error) {
        console.error(`审查失败: ${filePath}`, error.message);
        return {
            file_path: filePath,
            status: 'ERROR',
            issues: [{
                line: 0,
                type: '审查失败',
                severity: '高',
                description: `审查出错: ${error.message}`,
            }],
            reviews: [],
            added_lines: 0,
            deleted_lines: 0,
        };
    }
}

/**
 * 审查多个文件（并发执行）
 * @param {Array} files - 文件列表 [{path, diff}]
 * @param {Object} config - 配置对象
 * @param {Object} guidelines - 编码规范
 */
async function reviewFiles(files, config, guidelines) {
    // 构建 System Prompt
    const systemPrompt = await buildSystemPrompt({
        guidelines,
        issueLimit: config.issueLimit,
        enableAst: config.enableAst,
    });

    console.log(`🔍 开始审查 ${files.length} 个文件 (并发数: ${config.maxParallel})...`);
    
    // 使用并发限制
    const limit = pLimit(config.maxParallel);
    
    const reviewPromises = files.map(({ path, diff }) => 
        limit(async () => {
            console.log(`📝 审查中: ${path}`);
            try {
                const result = await reviewSingleFile(path, diff, config, guidelines, systemPrompt);
                const issueCount = result.issues.length;
                const emoji = issueCount === 0 ? '✅' : issueCount > 5 ? '🔴' : '⚠️';
                console.log(`${emoji} 完成: ${path} (${issueCount} 个问题)`);
                return { path, result };
            } catch (error) {
                console.error(`❌ 处理失败: ${path}`, error.message);
                return {
                    path,
                    result: {
                        file_path: path,
                        status: 'ERROR',
                        issues: [{
                            line: 0,
                            type: '审查失败',
                            severity: '高',
                            description: `审查出错: ${error.message}`,
                        }],
                        reviews: [],
                        added_lines: 0,
                        deleted_lines: 0,
                    }
                };
            }
        })
    );

    // 等待所有审查完成
    const results = await Promise.all(reviewPromises);
    
    // 转换为对象格式
    const reviews = {};
    results.forEach(({ path, result }) => {
        reviews[path] = result;
    });

    return reviews;
}

module.exports = {
    reviewFiles,
};

