/**
 * Gemini 客户端模块
 * 封装 Google Gemini API 调用，支持多图+文本请求与重试
 */

const { GoogleGenAI } = require('@google/genai');

class GeminiClient {
    /**
     * 创建 Gemini 客户端实例
     * @param {Object} config - Gemini 配置
     * @param {string} config.api_key - API Key
     * @param {string} config.model - 模型名称
     * @param {number} config.max_retries - 最大重试次数
     * @param {number} config.retry_delay - 重试间隔（秒）
     * @param {Logger} logger - 日志模块
     */
    constructor(config, logger) {
        this.model = config.model;
        this.maxRetries = config.max_retries || 3;
        this.retryDelay = (config.retry_delay || 2) * 1000; // 转为毫秒
        this.logger = logger;

        // 初始化 Google GenAI 客户端
        this.genai = new GoogleGenAI({ apiKey: config.api_key });
    }

    /**
     * 构建图片 Part（inline 方式，不使用 files 系统）
     * @param {Buffer} imageBuffer - 图像数据
     * @param {string} mimeType - MIME 类型
     * @returns {Object} Gemini Part 对象
     */
    buildImagePart(imageBuffer, mimeType = 'image/jpeg') {
        return {
            inlineData: {
                data: imageBuffer.toString('base64'),
                mimeType
            }
        };
    }

    /**
     * 调用 Gemini API 生成内容（带重试）
     * @param {Array} contents - 内容数组（文本 + 图片 Part）
     * @returns {Promise<{text: string, usageMetadata: Object|null}>} AI 响应文本和 token 用量
     * @throws {Error} 超过最大重试次数后抛出
     */
    async generate(contents) {
        let lastError = null;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                this.logger.debug(`Gemini API 调用 (尝试 ${attempt}/${this.maxRetries})`);

                const response = await this.genai.models.generateContent({
                    model: this.model,
                    contents
                });

                const text = response.text;

                if (!text || text.trim() === '') {
                    throw new Error('Gemini 返回空响应');
                }

                this.logger.debug(`Gemini API 响应成功，长度: ${text.length}`);

                // 返回文本和 usageMetadata（token 用量）
                return {
                    text,
                    usageMetadata: response.usageMetadata || null
                };

            } catch (err) {
                lastError = err;
                this.logger.warn(`Gemini API 调用失败 (尝试 ${attempt}/${this.maxRetries}): ${err.message}`);

                // 最后一次尝试不再等待
                if (attempt < this.maxRetries) {
                    await this._sleep(this.retryDelay * attempt); // 递增延迟
                }
            }
        }

        this.logger.error(`Gemini API 调用全部失败: ${lastError.message}`);
        throw lastError;
    }

    /**
     * 延迟等待
     * @param {number} ms - 毫秒数
     * @returns {Promise<void>}
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = GeminiClient;
