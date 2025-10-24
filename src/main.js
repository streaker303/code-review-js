const pLimit = require('p-limit');
const { loadRuntimeConfig } = require('./config');
const { getGitDiffs, postComment, deletePastComments, postLineComment, deletePastLineComments } = require('./gitlab_api');
const { reviewFiles } = require('./review_engine');
const { loadGuidelines } = require('./prompt_builder');
const { generateReviewReport } = require('./report');

/**
 * 准备待审查的文件列表
 */
function prepareFilesForReview(diffs) {
    return diffs
        .filter(d => d.diff && !d.diff.startsWith('Binary files'))
        .map(d => {
            const header = `diff --git a/${d.old_path} b/${d.new_path}\n--- a/${d.old_path}\n+++ b/${d.new_path}\n`;
            return {
                path: d.new_path,
                diff: header + d.diff,
                old_path: d.old_path,
            };
        });
}

/**
 * 发布报告模式
 */
async function publishReport(reviews, config) {
    const identifier = '## 🤖 AI 代码审查报告';
    await deletePastComments(identifier);
    
    // 生成增强版报告（HTML表格格式）
    const report = generateReviewReport(reviews);
    await postComment(report);
}

/**
 * 发布行级评论模式
 */
async function publishInlineComments(reviews, diffs, diffRefs, config) {
    const identifier = '<!-- AI_CODE_REVIEW_LINE_COMMENT -->';
    await deletePastLineComments(identifier);

    const limit = pLimit(config.maxParallel);
    const commentPromises = [];
    let totalComments = 0;

    for (const filePath in reviews) {
        const review = reviews[filePath];
        if (!review?.issues || review.issues.length === 0) continue;

        const diffInfo = diffs.find(d => d.new_path === filePath);
        if (!diffInfo) {
            console.warn(`⚠️  未找到 ${filePath} 的diff信息，跳过行级评论`);
            continue;
        }

        for (const issue of review.issues) {
            // 确定行号
            const issueLine = issue.startLine || issue.line;
            if (!issueLine || issueLine < 1) {
                console.warn(`⚠️  跳过无效行号的问题: ${filePath} (行号: ${issueLine})`);
                continue;
            }

            // 构建位置参数
            const position = {
                ...diffRefs,
                position_type: 'text',
                old_path: issue.type === 'old' ? (issue.oldPath || diffInfo.old_path) : diffInfo.old_path,
                new_path: issue.type === 'new' ? (issue.newPath || diffInfo.new_path) : diffInfo.new_path,
            };

            if (issue.type === 'old') {
                position.old_line = issueLine;
            } else {
                position.new_line = issueLine;
            }

            // 构建评论内容
            const severityBadge = issue.severity === '高' ? '🔴' : issue.severity === '中' ? '🟡' : '🟢';
            const guidelineBadge = issue.guidelineId || issue.guideline_id ? ` [${issue.guidelineId || issue.guideline_id}]` : '';
            const commentBody = `${identifier}\n**[AI 建议]** ${severityBadge} ${issue.severity || '中'}严重性${guidelineBadge}\n\n**${issue.issueHeader || issue.issueType || '代码问题'}**\n\n${issue.issueContent || issue.description}`;

            commentPromises.push(limit(() => postLineComment(commentBody, position)));
            totalComments++;
        }
    }

    if (totalComments === 0) {
        console.log('ℹ️  没有需要发布的行级评论');
        return;
    }

    await Promise.all(commentPromises);
    console.log(`✅ 所有行级评论发布完成 (共 ${totalComments} 条)`);
}

/**
 * 主审查流程
 */
async function runReview() {
    const config = loadRuntimeConfig();
    
    console.log(`🔍 开始审查 (模式=${config.reviewMode}, 模型=${config.aiModel}, 并发=${config.maxParallel})`);

    try {
        // 加载数据
        const [guidelines, { diffs, diffRefs }] = await Promise.all([
            loadGuidelines(config.guidelinesFile),
            getGitDiffs(),
        ]);

        // 准备文件列表
        const filesToReview = prepareFilesForReview(diffs);
        
        if (filesToReview.length === 0) {
            console.log("📭 未发现可审查的代码变更");
            return;
        }

        console.log(`📋 待审查文件: ${filesToReview.length}`);

        // 执行审查
        const reviews = await reviewFiles(filesToReview, config, guidelines);

        console.log('📦 生成报告...');

        // 发布结果
        if (config.reviewMode === 'inline') {
            await publishInlineComments(reviews, diffs, diffRefs, config);
        } else {
            await publishReport(reviews, config);
        }

        console.log("🎉 审查完成！");

    } catch (error) {
        console.error("❌ 审查失败:", error);
        process.exit(1);
    }
}

/**
 * 入口函数
 */
async function main() {
    try {
        await runReview();
    } catch (error) {
        console.error('执行失败:', error.message);
        process.exit(1);
    }
}

// 直接执行时运行
if (require.main === module) {
    main();
}

module.exports = {
    runReview,
};

