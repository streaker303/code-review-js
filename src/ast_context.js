const babelParser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { extractVueAstContext } = require('./ast_context_vue');
const {
    getAstConfig,
    readFileSafe,
    withTimeout,
    createDepthLimiter,
    isTargetNode,
    selectSmallestSections,
    extractContextAroundLines,
} = require('./ast_utils');

/**
 * AST分析模块 - JavaScript/TypeScript/JSX
 * 1.实现最小包含块原则 - 避免返回外层大函数
 * 2.添加块大小限制 - 防止Token浪费
 * 3.超时保护 - 避免解析大文件卡死
 * 4.递归深度限制 - 防止栈溢出
 * 5.完善错误处理 - 不影响主流程
 */

/**
 * 提取 JS/TS/TSX 文件的 AST 上下文
 */
async function extractJsAstContext(filePath, addedLines, projectRoot) {
    const config = getAstConfig();
    const result = {
        impacted_sections: [],
        errors: []
    };

    // 读取文件
    const code = await readFileSafe(filePath, projectRoot);
    if (!code) {
        result.errors.push("file_not_readable");
        return result;
    }

    // 解析AST（带超时保护）
    let ast;
    try {
        ast = await withTimeout(
            parseCode(code),
            config.timeoutMs,
            `AST解析超时 (>${config.timeoutMs}ms)`
        );
    } catch (e) {
        result.errors.push(`parse_error: ${e.message}`);
        return result;
    }

    // 收集所有包含新增行的代码块
    let allSections = [];
    try {
        allSections = collectImpactedSections(ast, code, addedLines, config);
    } catch (e) {
        result.errors.push(`traverse_error: ${e.message}`);
        return result;
    }

    // 选择最小的包含块（核心优化）
    const selectedSections = selectSmallestSections(allSections, addedLines);

    // 应用大小限制和截断
    result.impacted_sections = selectedSections.map(section => 
        limitSectionSize(section, code, config)
    );

    return result;
}

/**
 * 解析代码为AST
 */
async function parseCode(code) {
    return babelParser.parse(code, {
        sourceType: 'module',
        plugins: [
            'jsx',
            'typescript',
            'classProperties',
            'optionalChaining',
            'nullishCoalescingOperator',
            'decorators-legacy',
        ],
        errorRecovery: true,
    });
}

/**
 * 收集所有包含新增行的代码块
 */
function collectImpactedSections(ast, code, addedLines, config) {
    const sections = [];
    const depthLimiter = createDepthLimiter(config.maxDepth);

    try {
        traverse(ast, {
            enter(astPath) {
                depthLimiter.enter();

                const node = astPath.node;
                
                // 只关注函数和类声明（避免提取容器节点）
                if (!isTargetNode(astPath)) {
                    return;
                }

                // 检查节点是否有位置信息
                if (!node.loc || !node.loc.start || !node.loc.end) {
                    return;
                }

                const { start, end } = node.loc;
                
                // 检查是否包含新增行
                const relevantLines = Array.from(addedLines).filter(
                    lineNumber => lineNumber >= start.line && lineNumber <= end.line
                );

                if (relevantLines.length === 0) {
                    return;
                }

                // 获取名称
                const name = getNodeName(node, astPath);
                const type = node.type;
                const size = end.line - start.line + 1;

                sections.push({
                    type,
                    name,
                    start_line: start.line,
                    end_line: end.line,
                    start_offset: node.start,
                    end_offset: node.end,
                    added_lines: relevantLines,
                    size,
                });
            },
            exit() {
                depthLimiter.exit();
            }
        });
    } catch (error) {
        // 如果是深度限制错误，记录警告但继续
        if (error.message.includes('深度超限')) {
            console.warn(`⚠️  ${error.message}, 已收集 ${sections.length} 个代码块`);
        } else {
            throw error;
        }
    }

    return sections;
}

/**
 * 获取节点名称
 */
function getNodeName(node, astPath) {
    // 直接命名
    if (node.id && node.id.name) {
        return node.id.name;
    }

    // 变量声明的函数
    if (astPath.parentPath && astPath.parentPath.isVariableDeclarator()) {
        const declarator = astPath.parentPath.node;
        if (declarator.id && declarator.id.name) {
            return declarator.id.name;
        }
    }

    // 对象方法/属性
    if (node.key) {
        return node.key.name || node.key.value || 'anonymous';
    }

    return 'anonymous';
}


/**
 * 限制代码块大小，超过限制则截断
 */
function limitSectionSize(section, code, config) {
    const snippet = code.substring(section.start_offset, section.end_offset);
    
    // 情况1: 字符数超限
    if (snippet.length > config.maxSnippetLength) {
        return {
            type: section.type,
            name: section.name,
            start_line: section.start_line,
            end_line: section.end_line,
            added_lines: section.added_lines,
            snippet: snippet.substring(0, config.maxSnippetLength) + 
                     `\n\n/* ... 代码过长已截断 (总长${snippet.length}字符) */`,
            is_truncated: true,
            truncation_reason: 'char_limit',
        };
    }
    
    // 情况2: 行数超限
    if (section.size > config.maxBlockSizeLines) {
        const CONTEXT_RADIUS = 8; // 固定上下文行数
        const contextSnippet = extractContextAroundLines(
            code,
            section.added_lines,
            section.start_line,
            section.end_line,
            CONTEXT_RADIUS
        );
        
        return {
            type: section.type,
            name: section.name,
            start_line: section.start_line,
            end_line: section.end_line,
            added_lines: section.added_lines,
            snippet: contextSnippet,
            is_truncated: true,
            truncation_reason: 'line_limit',
            summary: `函数较大(${section.size}行)，只显示新增行周围${CONTEXT_RADIUS}行上下文`,
        };
    }
    
    // 情况3: 正常大小
    return {
        type: section.type,
        name: section.name,
        start_line: section.start_line,
        end_line: section.end_line,
        added_lines: section.added_lines,
        snippet,
    };
}

/**
 * 提取 AST 上下文（统一入口）
 * @param {string} filePath - 文件路径
 * @param {Set<number>} addedLines - 新增行号集合
 * @param {string} projectRoot - 项目根目录
 */
async function extractAstContext(filePath, addedLines, projectRoot) {
    const startTime = Date.now();
    let result;

    try {
        if (/\.(js|jsx|ts|tsx)$/.test(filePath)) {
            result = await extractJsAstContext(filePath, addedLines, projectRoot);
        } else if (/\.vue$/.test(filePath)) {
            result = await extractVueAstContext(filePath, addedLines, projectRoot);
        } else {
            // 不支持的文件类型
            result = { 
                impacted_sections: [],
                errors: ["unsupported_file_type"] 
            };
        }
    } catch (error) {
        // 防止AST分析错误影响主流程
        console.error(`❌ AST分析异常: ${filePath}`, error.message);
        result = {
            impacted_sections: [],
            errors: [`unexpected_error: ${error.message}`]
        };
    }

    return {
        ...result,
        parse_time_ms: Date.now() - startTime,
    };
}

module.exports = {
    extractAstContext,
};
