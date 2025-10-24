/**
 * 从 Markdown 文本中提取 JSON 代码块
 * @param {string} text - Markdown 文本
 * @returns {{content: string, parsed: Object|null, error: Error|null}}
 */
function extractJson(text) {
    // 尝试提取 ```json 代码块
    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
    const jsonMatch = jsonBlockRegex.exec(text);
    
    let jsonContent = '';
    
    if (jsonMatch) {
        jsonContent = jsonMatch[1];
    } else {
        // 如果没有 ```json 标记，尝试提取任意代码块
        const codeBlockRegex = /```\s*([\s\S]*?)\s*```/;
        const codeMatch = codeBlockRegex.exec(text);
        
        if (codeMatch) {
            jsonContent = codeMatch[1];
        } else {
            // 最后尝试直接提取 JSON 对象
            const directJsonRegex = /\{[\s\S]*"reviews"[\s\S]*\}/;
            const directMatch = directJsonRegex.exec(text);
            
            if (directMatch) {
                jsonContent = directMatch[0];
            } else {
                return {
                    content: '',
                    parsed: null,
                    error: new Error('未找到 JSON 内容（未找到 ```json 代码块或 JSON 对象）')
                };
            }
        }
    }

    const result = {
        content: jsonContent,
        parsed: null,
        error: null
    };

    // 尝试解析 JSON
    try {
        const cleaned = cleanJsonContent(jsonContent);
        const parsed = JSON.parse(cleaned);
        
        // 验证结构
        if (!parsed || typeof parsed !== 'object') {
            result.error = new Error('JSON 解析结果不是有效对象');
            return result;
        }
        
        if (!parsed.reviews || !Array.isArray(parsed.reviews)) {
            result.error = new Error('JSON 缺少 reviews 数组字段');
            return result;
        }
        
        // 清理和标准化数据
        result.parsed = sanitizeReviews(parsed);
        
    } catch (parseError) {
        // 如果直接解析失败，尝试修复常见问题
        try {
            const fixed = fixCommonJsonIssues(jsonContent);
            const parsed = JSON.parse(fixed);
            
            if (parsed && parsed.reviews && Array.isArray(parsed.reviews)) {
                result.parsed = sanitizeReviews(parsed);
                console.log('✅ JSON 格式修复成功');
            } else {
                result.error = new Error('修复后的 JSON 结构仍然无效');
            }
        } catch (fixError) {
            result.error = new Error(`JSON 解析失败: ${parseError.message}`);
            console.error('原始 JSON 内容：\n', jsonContent);
            console.error('解析错误：', parseError.message);
        }
    }

    return result;
}

/**
 * 清理 JSON 内容（移除注释、修正格式等）
 * @param {string} content - JSON 内容
 * @returns {string} - 清理后的 JSON
 */
function cleanJsonContent(content) {
    let cleaned = content;
    
    // 移除 JavaScript 风格的注释
    cleaned = cleaned.replace(/\/\/.*$/gm, '');
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // 移除 BOM 标记
    cleaned = cleaned.replace(/^\uFEFF/, '');
    
    // 修正常见的引号问题（中文引号转英文引号）
    cleaned = cleaned.replace(/[""]/g, '"');
    cleaned = cleaned.replace(/['']/g, "'");
    
    return cleaned.trim();
}

/**
 * 修复常见的 JSON 格式问题
 * @param {string} content - JSON 内容
 * @returns {string} - 修复后的 JSON
 */
function fixCommonJsonIssues(content) {
    let fixed = cleanJsonContent(content);
    
    // 1. 移除尾随逗号（对象和数组）
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
    
    // 2. 修复单引号为双引号（JSON 标准要求双引号）
    // 注意：这个比较复杂，需要避免修改字符串内部的单引号
    // 简单处理：替换键名的单引号
    fixed = fixed.replace(/'([^']+)':/g, '"$1":');
    
    // 3. 修复缺少引号的键名
    fixed = fixed.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    
    // 4. 修复连续的逗号
    fixed = fixed.replace(/,+/g, ',');
    
    // 5. 移除空白行可能导致的问题
    fixed = fixed.replace(/\n\s*\n/g, '\n');
    
    return fixed;
}

/**
 * 清理和标准化 reviews 数据
 * @param {Object} data - 解析后的 JSON 对象
 * @returns {Object} - 标准化后的对象
 */
function sanitizeReviews(data) {
    if (!data.reviews || !Array.isArray(data.reviews)) {
        return { reviews: [] };
    }
    
    const sanitized = {
        reviews: data.reviews
            .filter(review => isValidReview(review))
            .map(review => sanitizeReview(review))
    };
    
    return sanitized;
}

/**
 * 验证单个 review 是否有效
 * @param {Object} review - review 对象
 * @returns {boolean}
 */
function isValidReview(review) {
    if (!review || typeof review !== 'object') {
        return false;
    }
    
    // 必需字段检查
    const requiredFields = ['newPath', 'oldPath', 'type', 'startLine', 'endLine', 'issueHeader', 'issueContent'];
    
    for (const field of requiredFields) {
        if (!(field in review)) {
            console.warn(`跳过无效 review：缺少字段 ${field}`);
            return false;
        }
    }
    
    // 类型检查
    if (typeof review.newPath !== 'string' || typeof review.oldPath !== 'string') {
        console.warn('跳过无效 review：newPath 或 oldPath 不是字符串');
        return false;
    }
    
    if (review.type !== 'new' && review.type !== 'old') {
        console.warn(`跳过无效 review：type 必须是 'new' 或 'old'，当前值: ${review.type}`);
        return false;
    }
    
    // 行号必须是有效数字
    const startLine = parseInt(review.startLine, 10);
    const endLine = parseInt(review.endLine, 10);
    
    if (isNaN(startLine) || isNaN(endLine) || startLine < 1 || endLine < startLine) {
        console.warn(`跳过无效 review：行号无效 (startLine: ${review.startLine}, endLine: ${review.endLine})`);
        return false;
    }
    
    return true;
}

/**
 * 标准化单个 review 对象
 * @param {Object} review - review 对象
 * @returns {Object} - 标准化后的 review
 */
function sanitizeReview(review) {
    return {
        // 基础字段
        newPath: String(review.newPath || '').trim(),
        oldPath: String(review.oldPath || '').trim(),
        type: review.type === 'old' ? 'old' : 'new',
        startLine: parseInt(review.startLine, 10),
        endLine: parseInt(review.endLine, 10),
        issueHeader: String(review.issueHeader || '代码问题').trim(),
        issueContent: String(review.issueContent || '').trim(),
        
        // 可选字段（提供默认值）
        severity: normalizeSeverity(review.severity),
        guidelineId: String(review.guidelineId || '').trim()
    };
}

/**
 * 标准化严重程度
 * @param {string} severity - 严重程度
 * @returns {string} - 标准化后的严重程度
 */
function normalizeSeverity(severity) {
    const severityMap = {
        '高': '高',
        '中': '中',
        '低': '低',
        '严重': '高',
        'high': '高',
        'medium': '中',
        'low': '低',
        'critical': '高',
        'major': '高',
        'minor': '低',
        'trivial': '低'
    };
    
    const normalized = severityMap[String(severity || '').toLowerCase().trim()];
    return normalized || '中';
}

/**
 * 将 reviews 转换为兼容的 issues 格式
 * @param {Array} reviews - JSON 解析的 reviews 数组
 * @returns {Array} - 兼容的 issues 数组
 */
function convertReviewsToIssues(reviews) {
    if (!Array.isArray(reviews)) {
        return [];
    }

    return reviews
        .map(review => ({
            // 保留所有原始字段（包括 type: 'new'/'old'）
            ...review,
            // 添加兼容字段（不覆盖原有的 type）
            line: review.startLine,
            description: review.issueContent,
            suggestion: review.issueContent,
            issueType: review.issueHeader || '代码问题',  // 问题类型重命名为 issueType
            severity: review.severity || '中',
            guideline_id: review.guidelineId || ''
        }))
        .sort((a, b) => a.startLine - b.startLine);
}

module.exports = {
    extractJson,
    convertReviewsToIssues
};

