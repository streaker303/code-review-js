const fs = require('fs/promises');
const path = require('path');
const { loadRuntimeConfig } = require('./config');

// 全局配置缓存
let astConfig = null;

/**
 * 获取AST配置
 */
function getAstConfig() {
    if (!astConfig) {
        try {
            const config = loadRuntimeConfig();
            astConfig = config.astConfig;
        } catch (error) {
            console.error('❌ 无法加载AST配置，AST分析将不可用');
            throw error;
        }
    }
    return astConfig;
}

/**
 * 安全读取文件
 * @param {string} filePath - 相对路径
 * @param {string} projectRoot - 项目根目录
 * @returns {Promise<string|null>} - 文件内容或null
 */
async function readFileSafe(filePath, projectRoot) {
    try {
        const absolutePath = path.resolve(projectRoot, filePath);
        return await fs.readFile(absolutePath, 'utf-8');
    } catch (error) {
        return null;
    }
}

/**
 * 超时执行包装器
 * @param {Promise} promise - 要执行的Promise
 * @param {number} timeoutMs - 超时时间(毫秒)
 * @param {string} errorMessage - 超时错误消息
 * @returns {Promise} - 结果或超时错误
 */
async function withTimeout(promise, timeoutMs, errorMessage = 'Operation timeout') {
    let timeoutHandle;
    
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(errorMessage));
        }, timeoutMs);
    });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timeoutHandle);
        return result;
    } catch (error) {
        clearTimeout(timeoutHandle);
        throw error;
    }
}

/**
 * 创建深度限制器
 * 返回一个对象，包含enter和exit方法，用于跟踪和限制递归深度
 * @param {number} maxDepth - 最大深度
 * @returns {Object} - 包含enter和exit方法的对象
 */
function createDepthLimiter(maxDepth) {
    let currentDepth = 0;
    
    return {
        enter() {
            currentDepth++;
            if (currentDepth > maxDepth) {
                throw new Error(`AST遍历深度超限 (>${maxDepth})`);
            }
        },
        exit() {
            currentDepth--;
        },
        getDepth() {
            return currentDepth;
        }
    };
}

/**
 * 判断是否是目标节点（函数、方法、类）
 * @param {Object} astPath - Babel AST路径对象
 * @returns {boolean}
 */
function isTargetNode(astPath) {
    return (
        astPath.isFunctionDeclaration() ||
        astPath.isFunctionExpression() ||
        astPath.isArrowFunctionExpression() ||
        astPath.isClassMethod() ||
        astPath.isObjectMethod() ||
        astPath.isClassDeclaration()
    );
}

/**
 * 选择最小的包含块
 * 策略: 按大小排序，优先选择小的块，避免重叠
 * @param {Array} sections - 代码段数组
 * @param {Set} addedLines - 新增行号集合
 * @returns {Array} - 选中的代码段
 */
function selectSmallestSections(sections, addedLines) {
    if (sections.length === 0) return [];
    if (sections.length === 1) return sections;
    
    // 按大小排序（小的优先）
    const sorted = [...sections].sort((a, b) => a.size - b.size);
    
    const selected = [];
    const coveredLines = new Set();
    
    for (const section of sorted) {
        // 检查这个section的新增行是否已被更小的section覆盖
        const sectionLines = section.added_lines.filter(
            line => !coveredLines.has(line)
        );
        
        // 如果还有未覆盖的行，选择这个section
        if (sectionLines.length > 0) {
            selected.push(section);
            // 标记这些行已被覆盖
            section.added_lines.forEach(line => coveredLines.add(line));
        }
    }
    
    return selected;
}

/**
 * 提取新增行周围的上下文
 * @param {string} code - 完整代码
 * @param {Array} addedLines - 新增行号数组
 * @param {number} blockStart - 代码块起始行
 * @param {number} blockEnd - 代码块结束行
 * @param {number} radius - 上下文半径（行数）
 * @returns {string} - 上下文代码片段
 */
function extractContextAroundLines(code, addedLines, blockStart, blockEnd, radius) {
    const lines = code.split('\n');
    const contexts = [];
    
    // 对每个新增行提取上下文
    addedLines.forEach(lineNum => {
        const contextStart = Math.max(blockStart, lineNum - radius);
        const contextEnd = Math.min(blockEnd, lineNum + radius);
        
        const contextLines = lines.slice(contextStart - 1, contextEnd);
        const snippet = contextLines.map((line, idx) => {
            const actualLineNum = contextStart + idx;
            const marker = actualLineNum === lineNum ? ' ← 新增' : '';
            return `${actualLineNum}| ${line}${marker}`;
        }).join('\n');
        
        contexts.push(snippet);
    });
    
    return contexts.join('\n\n...\n\n');
}

module.exports = {
    getAstConfig,
    readFileSafe,
    withTimeout,
    createDepthLimiter,
    isTargetNode,
    selectSmallestSections,
    extractContextAroundLines,
};

