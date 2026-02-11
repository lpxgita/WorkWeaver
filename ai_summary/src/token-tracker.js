/**
 * Token 用量跟踪模块
 * 统计 Gemini API 调用的 token 消耗，支持按时间段和按功能粒度查询
 *
 * 存储格式（JSON 文件，按日期分文件）:
 * {
 *   "session_id": "2026-02-09T10:00:00.000Z",  // 本次启动时间
 *   "records": [
 *     {
 *       "time": "2026-02-09T10:02:00.000Z",     // 精确到分钟
 *       "granularity": "2min",                   // 功能粒度
 *       "prompt_tokens": 13223,                  // 输入 token
 *       "candidates_tokens": 40,                 // 输出 token
 *       "thoughts_tokens": 555,                  // 思考 token
 *       "total_tokens": 13818,                   // 总 token
 *       "prompt_text_tokens": 23,                // 文本输入 token
 *       "prompt_image_tokens": 13200             // 图片输入 token
 *     }
 *   ]
 * }
 */

const fs = require('fs');
const path = require('path');

class TokenTracker {
    /**
     * 创建 Token 跟踪器实例
     * @param {Object} config - 配置
     * @param {string} config.directory - 总结存储根目录（token 统计文件存放于其下 token-stats/ 子目录）
     * @param {Logger} logger - 日志模块
     */
    constructor(config, logger) {
        this.logger = logger;

        // 解析目录为绝对路径
        const baseDir = config.directory.replace(/^~/, require('os').homedir());
        this.statsDirectory = path.isAbsolute(baseDir)
            ? path.join(baseDir, 'token-stats')
            : path.join(path.resolve(process.cwd(), baseDir), 'token-stats');

        // 本次会话 ID（启动时间 ISO 格式）
        this.sessionId = new Date().toISOString();

        // 内存缓存：本次会话的所有记录
        this.records = [];

        // 按粒度汇总
        this.summaryByGranularity = {
            '2min': this._emptyBucket(),
            '10min': this._emptyBucket(),
            '1h': this._emptyBucket()
        };

        this.logger.info(`TokenTracker 初始化，会话: ${this.sessionId}`);
    }

    /**
     * 创建空的统计桶
     * @returns {Object}
     */
    _emptyBucket() {
        return {
            count: 0,
            prompt_tokens: 0,
            candidates_tokens: 0,
            thoughts_tokens: 0,
            total_tokens: 0,
            prompt_text_tokens: 0,
            prompt_image_tokens: 0
        };
    }

    /**
     * 确保目录存在
     * @param {string} dirPath - 目录路径
     */
    _ensureDir(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    /**
     * 格式化日期为 YYYY-MM-DD
     * @param {Date} date
     * @returns {string}
     */
    _formatDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    /**
     * 格式化时间为 HH:MM（精确到分钟）
     * @param {Date} date
     * @returns {string}
     */
    _formatMinute(date) {
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    }

    /**
     * 记录一次 API 调用的 token 用量
     * @param {string} granularity - 功能粒度 ('2min' | '10min' | '1h')
     * @param {Object} usageMetadata - Gemini API 返回的 usageMetadata 对象
     */
    record(granularity, usageMetadata) {
        if (!usageMetadata) {
            this.logger.warn('TokenTracker: usageMetadata 为空，跳过记录');
            return;
        }

        const now = new Date();

        // 从 promptTokensDetails 提取文本/图片 token
        let promptTextTokens = 0;
        let promptImageTokens = 0;
        if (Array.isArray(usageMetadata.promptTokensDetails)) {
            for (const detail of usageMetadata.promptTokensDetails) {
                if (detail.modality === 'TEXT') {
                    promptTextTokens = detail.tokenCount || 0;
                } else if (detail.modality === 'IMAGE') {
                    promptImageTokens = detail.tokenCount || 0;
                }
            }
        }

        const record = {
            time: now.toISOString(),
            minute: this._formatMinute(now),
            granularity,
            prompt_tokens: usageMetadata.promptTokenCount || 0,
            candidates_tokens: usageMetadata.candidatesTokenCount || 0,
            thoughts_tokens: usageMetadata.thoughtsTokenCount || 0,
            total_tokens: usageMetadata.totalTokenCount || 0,
            prompt_text_tokens: promptTextTokens,
            prompt_image_tokens: promptImageTokens
        };

        // 写入内存缓存
        this.records.push(record);

        // 更新按粒度汇总
        const bucket = this.summaryByGranularity[granularity];
        if (bucket) {
            bucket.count++;
            bucket.prompt_tokens += record.prompt_tokens;
            bucket.candidates_tokens += record.candidates_tokens;
            bucket.thoughts_tokens += record.thoughts_tokens;
            bucket.total_tokens += record.total_tokens;
            bucket.prompt_text_tokens += record.prompt_text_tokens;
            bucket.prompt_image_tokens += record.prompt_image_tokens;
        }

        // 持久化到文件
        this._persistRecord(now, record);

        this.logger.debug(
            `TokenTracker: [${granularity}] ` +
            `prompt=${record.prompt_tokens} (text=${promptTextTokens}, image=${promptImageTokens}), ` +
            `output=${record.candidates_tokens}, thoughts=${record.thoughts_tokens}, ` +
            `total=${record.total_tokens}`
        );
    }

    /**
     * 持久化单条记录到日期文件
     * @param {Date} date - 记录时间
     * @param {Object} record - 记录对象
     */
    _persistRecord(date, record) {
        try {
            this._ensureDir(this.statsDirectory);
            const dateStr = this._formatDate(date);
            const filePath = path.join(this.statsDirectory, `${dateStr}.json`);

            let data;
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                data = JSON.parse(content);
            } else {
                data = {
                    date: dateStr,
                    sessions: []
                };
            }

            // 查找或创建本次会话
            let session = data.sessions.find(s => s.session_id === this.sessionId);
            if (!session) {
                session = {
                    session_id: this.sessionId,
                    records: []
                };
                data.sessions.push(session);
            }

            session.records.push(record);

            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        } catch (err) {
            this.logger.error(`TokenTracker 持久化失败: ${err.message}`);
        }
    }

    /**
     * 获取本次会话的统计概览
     * @returns {Object} 包含按粒度和总计的统计信息
     */
    getSessionStats() {
        const total = this._emptyBucket();
        for (const [, bucket] of Object.entries(this.summaryByGranularity)) {
            total.count += bucket.count;
            total.prompt_tokens += bucket.prompt_tokens;
            total.candidates_tokens += bucket.candidates_tokens;
            total.thoughts_tokens += bucket.thoughts_tokens;
            total.total_tokens += bucket.total_tokens;
            total.prompt_text_tokens += bucket.prompt_text_tokens;
            total.prompt_image_tokens += bucket.prompt_image_tokens;
        }

        return {
            session_id: this.sessionId,
            by_granularity: { ...this.summaryByGranularity },
            total,
            record_count: this.records.length
        };
    }

    /**
     * 按时间范围查询 token 用量（精确到分钟）
     * @param {string} date - 日期 YYYY-MM-DD
     * @param {string} startMinute - 开始时间 HH:MM（可选）
     * @param {string} endMinute - 结束时间 HH:MM（可选）
     * @returns {Object} 查询结果 { records, summary }
     */
    queryByTimeRange(date, startMinute, endMinute) {
        const filePath = path.join(this.statsDirectory, `${date}.json`);

        if (!fs.existsSync(filePath)) {
            return { records: [], summary: this._emptyBucket(), sessions: [] };
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(content);

            // 收集所有 session 的记录
            let allRecords = [];
            const sessionInfos = [];
            for (const session of (data.sessions || [])) {
                const sessionRecords = (session.records || []).map(r => ({
                    ...r,
                    session_id: session.session_id
                }));
                allRecords = allRecords.concat(sessionRecords);
                if (sessionRecords.length > 0) {
                    sessionInfos.push({
                        session_id: session.session_id,
                        record_count: sessionRecords.length
                    });
                }
            }

            // 时间范围过滤
            if (startMinute || endMinute) {
                allRecords = allRecords.filter(r => {
                    const minute = r.minute;
                    if (startMinute && minute < startMinute) return false;
                    if (endMinute && minute > endMinute) return false;
                    return true;
                });
            }

            // 按时间排序
            allRecords.sort((a, b) => a.time.localeCompare(b.time));

            // 汇总
            const summary = this._emptyBucket();
            for (const r of allRecords) {
                summary.count++;
                summary.prompt_tokens += r.prompt_tokens || 0;
                summary.candidates_tokens += r.candidates_tokens || 0;
                summary.thoughts_tokens += r.thoughts_tokens || 0;
                summary.total_tokens += r.total_tokens || 0;
                summary.prompt_text_tokens += r.prompt_text_tokens || 0;
                summary.prompt_image_tokens += r.prompt_image_tokens || 0;
            }

            // 按粒度分类汇总
            const byGranularity = {};
            for (const r of allRecords) {
                if (!byGranularity[r.granularity]) {
                    byGranularity[r.granularity] = this._emptyBucket();
                }
                const bucket = byGranularity[r.granularity];
                bucket.count++;
                bucket.prompt_tokens += r.prompt_tokens || 0;
                bucket.candidates_tokens += r.candidates_tokens || 0;
                bucket.thoughts_tokens += r.thoughts_tokens || 0;
                bucket.total_tokens += r.total_tokens || 0;
                bucket.prompt_text_tokens += r.prompt_text_tokens || 0;
                bucket.prompt_image_tokens += r.prompt_image_tokens || 0;
            }

            // 按分钟聚合
            const byMinute = {};
            for (const r of allRecords) {
                if (!byMinute[r.minute]) {
                    byMinute[r.minute] = this._emptyBucket();
                    byMinute[r.minute].minute = r.minute;
                }
                const bucket = byMinute[r.minute];
                bucket.count++;
                bucket.prompt_tokens += r.prompt_tokens || 0;
                bucket.candidates_tokens += r.candidates_tokens || 0;
                bucket.thoughts_tokens += r.thoughts_tokens || 0;
                bucket.total_tokens += r.total_tokens || 0;
                bucket.prompt_text_tokens += r.prompt_text_tokens || 0;
                bucket.prompt_image_tokens += r.prompt_image_tokens || 0;
            }

            // 按分钟排序
            const minuteList = Object.values(byMinute).sort((a, b) =>
                a.minute.localeCompare(b.minute)
            );

            return {
                records: allRecords,
                summary,
                by_granularity: byGranularity,
                by_minute: minuteList,
                sessions: sessionInfos
            };
        } catch (err) {
            this.logger.error(`TokenTracker 查询失败: ${err.message}`);
            return { records: [], summary: this._emptyBucket(), sessions: [] };
        }
    }

    /**
     * 按会话 ID 查询 token 用量
     * @param {string} date - 日期 YYYY-MM-DD
     * @param {string} sessionId - 会话 ID
     * @returns {Object} 查询结果
     */
    queryBySession(date, sessionId) {
        const filePath = path.join(this.statsDirectory, `${date}.json`);

        if (!fs.existsSync(filePath)) {
            return { records: [], summary: this._emptyBucket() };
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(content);

            const session = (data.sessions || []).find(s => s.session_id === sessionId);
            if (!session) {
                return { records: [], summary: this._emptyBucket() };
            }

            const records = (session.records || []).sort((a, b) =>
                a.time.localeCompare(b.time)
            );

            // 汇总
            const summary = this._emptyBucket();
            const byGranularity = {};
            for (const r of records) {
                summary.count++;
                summary.prompt_tokens += r.prompt_tokens || 0;
                summary.candidates_tokens += r.candidates_tokens || 0;
                summary.thoughts_tokens += r.thoughts_tokens || 0;
                summary.total_tokens += r.total_tokens || 0;
                summary.prompt_text_tokens += r.prompt_text_tokens || 0;
                summary.prompt_image_tokens += r.prompt_image_tokens || 0;

                if (!byGranularity[r.granularity]) {
                    byGranularity[r.granularity] = this._emptyBucket();
                }
                const bucket = byGranularity[r.granularity];
                bucket.count++;
                bucket.prompt_tokens += r.prompt_tokens || 0;
                bucket.candidates_tokens += r.candidates_tokens || 0;
                bucket.thoughts_tokens += r.thoughts_tokens || 0;
                bucket.total_tokens += r.total_tokens || 0;
                bucket.prompt_text_tokens += r.prompt_text_tokens || 0;
                bucket.prompt_image_tokens += r.prompt_image_tokens || 0;
            }

            return { records, summary, by_granularity: byGranularity };
        } catch (err) {
            this.logger.error(`TokenTracker 会话查询失败: ${err.message}`);
            return { records: [], summary: this._emptyBucket() };
        }
    }

    /**
     * 获取可用的统计日期列表
     * @returns {Array<string>} 日期数组 ['2026-02-05', '2026-02-06', ...]
     */
    getAvailableDates() {
        if (!fs.existsSync(this.statsDirectory)) {
            return [];
        }

        try {
            return fs.readdirSync(this.statsDirectory)
                .filter(f => f.endsWith('.json'))
                .map(f => f.replace('.json', ''))
                .sort()
                .reverse();
        } catch (err) {
            this.logger.error(`TokenTracker 读取日期列表失败: ${err.message}`);
            return [];
        }
    }
}

module.exports = TokenTracker;
