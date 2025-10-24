const axios = require('axios');
const { loadRuntimeConfig } = require('./config');

let config;
let apiClient;

/**
 * 初始化 GitLab API 客户端
 */
function initializeClient() {
    if (!apiClient) {
        config = loadRuntimeConfig();
        apiClient = axios.create({
            baseURL: config.gitlabApiUrl,
            headers: {
                'PRIVATE-TOKEN': config.gitlabToken,
            },
            timeout: 30000, // 30秒超时
        });
    }
    return apiClient;
}

/**
 * 检查是否为DRY RUN模式
 */
function checkDryRun(action) {
    if (config.dryRun) {
        console.log(`\n[DRY RUN] 模拟${action}`);
        return true;
    }
    return false;
}

/**
 * 从 GitLab MR 获取 diff
 */
async function getGitDiffs() {
    const client = initializeClient();
    const { projectId, mergeRequestIid } = config;

    try {
        // 首先获取 MR 的详细信息，这其中包含了行级评论所需的 diff_refs
        console.log(`正在从项目 ${projectId} 的 MR !${mergeRequestIid} 获取变更信息...`);
        const mrResponse = await client.get(`/projects/${projectId}/merge_requests/${mergeRequestIid}`);
        const { source_branch, target_branch, diff_refs } = mrResponse.data;

        if (!source_branch || !target_branch) {
            throw new Error('无法从 MR 信息中获取 source_branch 或 target_branch。');
        }

        console.log(`比对分支: ${target_branch} ... ${source_branch}`);

        // 然后使用 compare 接口获取 diff
        const compareResponse = await client.get(`/projects/${projectId}/repository/compare`, {
            params: {
                from: target_branch,
                to: source_branch,
            },
        });
        
        // 将 diffs 和 diffRefs 一起返回
        return {
            diffs: compareResponse.data.diffs || [],
            diffRefs: diff_refs,
        };

    } catch (error) {
        console.error('从 GitLab 获取 diff 失败:', error.response ? error.response.data : error.message);
        throw error;
    }
}


/**
 * 向 GitLab MR 发布评论
 */
async function postComment(commentBody) {
    if (checkDryRun('发布评论')) return;

    const client = initializeClient();
    const { projectId, mergeRequestIid } = config;

    try {
        await client.post(`/projects/${projectId}/merge_requests/${mergeRequestIid}/notes`, {
            body: commentBody,
        });
        console.log('✅ 评论发布成功');
    } catch (error) {
        const errorMsg = error.response?.data?.message || error.message;
        console.error('❌ 发布评论失败:', errorMsg);
        throw new Error(`发布评论失败: ${errorMsg}`);
    }
}

/**
 * 删除旧的 AI 评论
 */
async function deletePastComments(identifier) {
    if (checkDryRun('删除旧评论')) return;

    const client = initializeClient();
    const { projectId, mergeRequestIid } = config;

    try {
        const response = await client.get(`/projects/${projectId}/merge_requests/${mergeRequestIid}/notes`, {
            params: { 
                sort: 'desc', 
                order_by: 'updated_at',
                per_page: 100 
            },
        });

        const notesToDelete = response.data.filter(note => note.body && note.body.includes(identifier));

        for (const note of notesToDelete) {
            try {
                await client.delete(`/projects/${projectId}/merge_requests/${mergeRequestIid}/notes/${note.id}`);
            } catch (deleteError) {
                console.warn(`⚠️  删除评论 ${note.id} 失败:`, deleteError.message);
            }
        }
        
        if (notesToDelete.length > 0) {
            console.log(`🗑️  删除了 ${notesToDelete.length} 条旧评论`);
        }
    } catch (error) {
        console.warn('⚠️  删除旧评论失败:', error.response?.data?.message || error.message);
    }
}

/**
 * 删除旧的行级评论
 */
async function deletePastLineComments(identifier) {
    if (checkDryRun('删除旧行级评论')) return;

    const client = initializeClient();
    const { projectId, mergeRequestIid } = config;

    try {
        const response = await client.get(`/projects/${projectId}/merge_requests/${mergeRequestIid}/discussions`, {
            params: { per_page: 100 },
        });

        const discussionsToDelete = response.data.filter(d => 
            d.notes?.[0]?.body && d.notes[0].body.includes(identifier)
        );

        for (const discussion of discussionsToDelete) {
            try {
                const firstNoteId = discussion.notes[0].id;
                await client.delete(`/projects/${projectId}/merge_requests/${mergeRequestIid}/notes/${firstNoteId}`);
            } catch (deleteError) {
                console.warn(`⚠️  删除行级评论失败:`, deleteError.message);
            }
        }

        if (discussionsToDelete.length > 0) {
            console.log(`🗑️  删除了 ${discussionsToDelete.length} 条旧行级评论`);
        }
    } catch (error) {
        console.warn('⚠️  删除旧行级评论失败:', error.response?.data?.message || error.message);
    }
}

/**
 * 发布行级评论
 */
async function postLineComment(commentBody, position) {
    if (checkDryRun('发布行级评论')) return;

    const client = initializeClient();
    const { projectId, mergeRequestIid } = config;

    try {
        await client.post(`/projects/${projectId}/merge_requests/${mergeRequestIid}/discussions`, {
            body: commentBody,
            position,
        });
    } catch (error) {
        const lineInfo = position.new_line || position.old_line || '未知';
        const errorMsg = error.response?.data?.message || error.message;
        console.warn(`⚠️  发布行级评论失败 (行${lineInfo}):`, errorMsg);
    }
}

module.exports = {
    getGitDiffs,
    postComment,
    deletePastComments,
    postLineComment,
    deletePastLineComments,
};
