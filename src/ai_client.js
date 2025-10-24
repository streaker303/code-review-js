const axios = require('axios');
const { loadRuntimeConfig } = require('./config');

let config;
let apiClient;

/**
 * 初始化 AI API 客户端
 */
function initializeClient() {
    if (!apiClient) {
        config = loadRuntimeConfig();
        apiClient = axios.create({
            baseURL: config.aiApiUrl,
            headers: {
                'Authorization': `Bearer ${config.aiApiKey}`,
                'Content-Type': 'application/json',
            },
            timeout: 120000, // 2分钟超时
        });
    }
    return apiClient;
}

/**
 * 调用 AI 模型完成代码审查
 * @param {Array} messages - 消息数组
 * @param {number} temperature - 温度参数
 * @returns {Promise<string>} - 模型响应内容
 */
async function callChatCompletion(messages, temperature = 0.2) {
    initializeClient();

    const payload = {
        model: config.aiModel,
        messages,
        temperature,
    };
    
    try {
        const response = await apiClient.post('/chat/completions', payload);
        const content = response.data.choices[0]?.message?.content;
        
        if (!content) {
            throw new Error('模型响应缺少 content');
        }
        
        return content;
    } catch (error) {
        if (error.response) {
            // API返回的错误
            const errorMsg = error.response.data?.error?.message || error.response.statusText;
            const statusCode = error.response.status;
            throw new Error(`AI API错误 (${statusCode}): ${errorMsg}`);
        } else if (error.request) {
            // 网络错误
            throw new Error(`AI API网络错误: ${error.message}`);
        } else {
            // 其他错误
            throw new Error(`AI调用失败: ${error.message}`);
        }
    }
}

module.exports = {
    callChatCompletion,
};
