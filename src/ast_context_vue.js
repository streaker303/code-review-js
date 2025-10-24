const babelParser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const {
    getAstConfig,
    readFileSafe,
    withTimeout,
    createDepthLimiter,
} = require('./ast_utils');

/**
 * Vue文件AST上下文提取器
 * 1.保持最小包含块选择逻辑
 * 2.统一使用配置文件
 * 3.添加超时保护
 * 4.添加递归深度限制
 * 5.完善错误处理机制
 * 6.防止循环引用和栈溢出
 * 7.只分析 Script 部分，不分析 Template
 */

// Vue SFC 编译器（延迟加载）
let vueSfcCompiler = null;

/**
 * 延迟加载Vue SFC编译器（避免没安装时报错）
 */
function loadVueSfcCompiler() {
    if (vueSfcCompiler) return vueSfcCompiler;
    
    try {
        const { parse: parseSFC } = require('@vue/compiler-sfc');
        vueSfcCompiler = { parseSFC };
        return vueSfcCompiler;
    } catch (error) {
        console.warn('⚠️  @vue/compiler-sfc 未安装，Vue文件AST分析将降级');
        return null;
    }
}

/**
 * 提取 Script 部分的 AST 上下文
 */
function extractScriptContext(scriptContent, addedLines, scriptStartLine) {
    const config = getAstConfig();
    const result = {
        sections: [],
        errors: []
    };

    // 解析Script AST
    let ast;
    try {
        ast = babelParser.parse(scriptContent, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'classProperties', 'optionalChaining'],
            errorRecovery: true,
        });
    } catch (e) {
        result.errors.push(`script_parse_error: ${e.message}`);
        return result;
    }

    // 将script内部的行号映射回整个Vue文件的行号
    const adjustedAddedLines = new Set(
        Array.from(addedLines)
            .filter(line => line >= scriptStartLine)
            .map(line => line - scriptStartLine + 1)
    );

    if (adjustedAddedLines.size === 0) {
        return result;
    }

    // 收集所有包含新增行的节点
    let allSections = [];
    try {
        allSections = collectScriptSections(ast, scriptContent, adjustedAddedLines, config);
    } catch (e) {
        result.errors.push(`script_traverse_error: ${e.message}`);
        return result;
    }

    // 选择最小的包含块
    const selectedSections = selectSmallestSections(allSections, adjustedAddedLines);
    
    // 调整行号为整个Vue文件的行号
    result.sections = selectedSections.map(section => ({
        type: section.type,
        name: section.name,
        start_line: section.start_line + scriptStartLine - 1,
        end_line: section.end_line + scriptStartLine - 1,
        added_lines: section.added_lines.map(l => l + scriptStartLine - 1),
        snippet: section.snippet,
        is_truncated: section.is_truncated,
        truncation_reason: section.truncation_reason,
        summary: section.summary,
    }));

    return result;
}

/**
 * 收集Script中所有包含新增行的代码块
 */
function collectScriptSections(ast, scriptContent, addedLines, config) {
    const sections = [];
    const depthLimiter = createDepthLimiter(config.maxDepth);

    try {
        traverse(ast, {
            enter(astPath) {
                depthLimiter.enter();

                const node = astPath.node;
                
                // 提取函数、方法、类等
                if (!isScriptTargetNode(astPath)) {
                    return;
                }

                // 检查位置信息
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

                // 获取名称和上下文
                const { name, context } = getScriptNodeInfo(node, astPath);
                const size = end.line - start.line + 1;

                // 提取代码片段
                const snippet = scriptContent.substring(node.start, node.end);

                sections.push({
                    type: context || node.type,
                    name,
                    start_line: start.line,
                    end_line: end.line,
                    added_lines: relevantLines,
                    size,
                    snippet,
                });
            },
            exit() {
                depthLimiter.exit();
            }
        });
    } catch (error) {
        if (error.message.includes('深度超限')) {
            console.warn(`⚠️  ${error.message}, 已收集 ${sections.length} 个代码块`);
        } else {
            throw error;
        }
    }

    return sections;
}

/**
 * 判断是否是Script目标节点
 */
function isScriptTargetNode(astPath) {
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
 * 获取Script节点信息
 */
function getScriptNodeInfo(node, astPath) {
    let name = 'anonymous';
    let context = '';

    // 直接命名
    if (node.id && node.id.name) {
        name = node.id.name;
    } 
    // 变量声明的函数
    else if (astPath.parentPath && astPath.parentPath.isVariableDeclarator()) {
        const declarator = astPath.parentPath.node;
        if (declarator.id && declarator.id.name) {
            name = declarator.id.name;
        }
    } 
    // 对象方法
    else if (node.key) {
        name = node.key.name || node.key.value || 'anonymous';
        
        // 检查是否在Vue组件配置中
        try {
            const parent = astPath.findParent(p => p && p.isObjectExpression && p.isObjectExpression());
            if (parent) {
                const exportDefault = astPath.findParent(p => p && p.isExportDefaultDeclaration && p.isExportDefaultDeclaration());
                if (exportDefault) {
                    context = detectVueContext(astPath);
                }
            }
        } catch (error) {
            // 防止findParent导致的循环引用错误
            console.warn('⚠️  检测Vue上下文时出错:', error.message);
        }
    }

    return { name, context };
}

/**
 * 检测Vue特定的上下文（methods、computed、watch等）
 */
function detectVueContext(astPath) {
    try {
        const objectParent = astPath.findParent(p => p && p.isObjectProperty && p.isObjectProperty());
        if (objectParent && objectParent.node && objectParent.node.key) {
            const parentKey = objectParent.node.key.name || objectParent.node.key.value;
            const vueContexts = ['methods', 'computed', 'watch', 'setup'];
            if (vueContexts.includes(parentKey)) {
                return `vue_${parentKey}`;
            }
        }
    } catch (error) {
        // 防止递归查找导致的错误
        console.warn('⚠️  检测Vue上下文时出错:', error.message);
    }
    return '';
}

/**
 * 选择最小的包含块（Vue专用版本，应用大小限制）
 */
function selectSmallestSections(sections, addedLines) {
    if (sections.length === 0) return [];
    if (sections.length === 1) {
        const config = getAstConfig();
        return [applySectionSizeLimit(sections[0], config)];
    }
    
    const config = getAstConfig();
    
    // 按大小排序（小的优先）
    const sorted = [...sections].sort((a, b) => a.size - b.size);
    
    const selected = [];
    const coveredLines = new Set();
    
    for (const section of sorted) {
        // 检查这个section的新增行是否已被更小的section覆盖
        const sectionLines = Array.from(addedLines).filter(
            line => line >= section.start_line && line <= section.end_line
        );
        
        const hasUncoveredLines = sectionLines.some(line => !coveredLines.has(line));
        
        if (hasUncoveredLines) {
            // 应用大小限制
            const limitedSection = applySectionSizeLimit(section, config);
            selected.push(limitedSection);
            
            // 标记这些行已被覆盖
            sectionLines.forEach(line => coveredLines.add(line));
        }
    }
    
    return selected;
}

/**
 * 应用代码块大小限制
 */
function applySectionSizeLimit(section, config) {
    // 情况1: 字符数超限
    if (section.snippet.length > config.maxSnippetLength) {
        return {
            ...section,
            snippet: section.snippet.substring(0, config.maxSnippetLength) + 
                     `\n\n/* ... 代码过长已截断 (总长${section.snippet.length}字符) */`,
            is_truncated: true,
            truncation_reason: 'char_limit',
        };
    }
    
    // 情况2: 行数超限
    if (section.size > config.maxBlockSizeLines) {
        const CONTEXT_RADIUS = 8; // 固定上下文行数
        const contextSnippet = extractContextAroundLines(
            section.snippet,
            section.added_lines,
            section.start_line,
            section.end_line,
            CONTEXT_RADIUS
        );
        
        return {
            ...section,
            snippet: contextSnippet,
            is_truncated: true,
            truncation_reason: 'line_limit',
            summary: `代码块较大(${section.size}行)，只显示新增行周围${CONTEXT_RADIUS}行上下文`,
        };
    }
    
    // 情况3: 正常大小
    return section;
}

/**
 * 提取新增行周围的上下文
 */
function extractContextAroundLines(snippet, addedLines, blockStart, blockEnd, radius) {
    const lines = snippet.split('\n');
    const contexts = [];
    
    addedLines.forEach(lineNum => {
        const relativeLineNum = lineNum - blockStart + 1;
        const contextStart = Math.max(1, relativeLineNum - radius);
        const contextEnd = Math.min(lines.length, relativeLineNum + radius);
        
        const contextLines = lines.slice(contextStart - 1, contextEnd);
        const snippetPart = contextLines.map((line, idx) => {
            const actualLineNum = blockStart + contextStart - 1 + idx;
            const marker = actualLineNum === lineNum ? ' ← 新增' : '';
            return `${actualLineNum}| ${line}${marker}`;
        }).join('\n');
        
        contexts.push(snippetPart);
    });
    
    return contexts.join('\n\n...\n\n');
}


/**
 * 提取 Vue 文件的 AST 上下文（仅分析 Script 部分）
 */
async function extractVueAstContext(filePath, addedLines, projectRoot) {
    const config = getAstConfig();
    const result = {
        impacted_sections: [],
        component_info: null,
        errors: [],
    };

    const compiler = loadVueSfcCompiler();
    if (!compiler) {
        result.errors.push('vue_sfc_compiler_not_installed');
        return result;
    }

    const code = await readFileSafe(filePath, projectRoot);
    if (!code) {
        result.errors.push('file_not_readable');
        return result;
    }

    // 解析Vue文件（带超时保护）
    let descriptor;
    try {
        const parsePromise = new Promise((resolve, reject) => {
            try {
                const parsed = compiler.parseSFC(code, { filename: filePath });
                resolve(parsed);
            } catch (e) {
                reject(e);
            }
        });

        const parsed = await withTimeout(
            parsePromise,
            config.timeoutMs,
            `Vue SFC解析超时 (>${config.timeoutMs}ms)`
        );
        
        descriptor = parsed.descriptor;
        
        if (parsed.errors && parsed.errors.length > 0) {
            result.errors.push(`sfc_parse_errors: ${parsed.errors.length}`);
        }
    } catch (e) {
        result.errors.push(`sfc_parse_error: ${e.message}`);
        return result;
    }

    // 提取组件基本信息
    result.component_info = {
        has_template: !!descriptor.template,
        has_script: !!descriptor.script,
        has_script_setup: !!descriptor.scriptSetup,
        style_blocks: descriptor.styles ? descriptor.styles.length : 0,
        script_lang: descriptor.script?.lang || 'js',
    };

    const allSections = [];

    // 1. 分析 Script 部分
    if (descriptor.script && descriptor.script.content) {
        try {
            const scriptStartLine = descriptor.script.loc.start.line;
            const scriptResult = extractScriptContext(
                descriptor.script.content,
                addedLines,
                scriptStartLine
            );
            
            allSections.push(...scriptResult.sections);
            result.errors.push(...scriptResult.errors);
        } catch (error) {
            result.errors.push(`script_analysis_error: ${error.message}`);
        }
    }

    // 2. 分析 ScriptSetup 部分
    if (descriptor.scriptSetup && descriptor.scriptSetup.content) {
        try {
            const scriptStartLine = descriptor.scriptSetup.loc.start.line;
            const scriptResult = extractScriptContext(
                descriptor.scriptSetup.content,
                addedLines,
                scriptStartLine
            );
            
            allSections.push(...scriptResult.sections);
            result.errors.push(...scriptResult.errors);
        } catch (error) {
            result.errors.push(`script_setup_analysis_error: ${error.message}`);
        }
    }

    // 按行号排序
    allSections.sort((a, b) => a.start_line - b.start_line);
    
    result.impacted_sections = allSections;

    return result;
}

module.exports = {
    extractVueAstContext,
};
