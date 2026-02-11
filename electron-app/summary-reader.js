/**
 * 总结读取模块
 * 读取 AI 总结的 JSON 文件以在界面中展示
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class SummaryReader {
    /**
     * 创建总结读取器
     * @param {string} projectRoot - 项目根目录
     */
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
    }

    /**
     * 展开路径中的 ~ 为用户主目录
     * @param {string} filePath - 可能包含 ~ 的路径
     * @returns {string} 展开后的路径
     */
    _expandHome(filePath) {
        if (!filePath || typeof filePath !== 'string') return filePath;
        if (filePath === '~') return os.homedir();
        if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
            return path.join(os.homedir(), filePath.slice(2));
        }
        return filePath;
    }

    /**
     * 获取总结目录路径
     * @param {Object} config - 解析后的配置
     * @returns {string} 总结目录绝对路径
     */
    _getSummaryDir(config) {
        const dir = config.summary?.directory || './summaries';
        // 展开 ~ 路径
        const expanded = this._expandHome(dir);
        if (path.isAbsolute(expanded)) {
            return expanded;
        }
        // 相对于 ai_summary 模块目录
        return path.resolve(this.projectRoot, 'ai_summary', expanded);
    }

    /**
     * 获取可用的日期列表
     * @param {Object} config - 配置对象
     * @returns {Array<string>} 日期列表 (YYYY-MM-DD)，降序排列
     */
    getAvailableDates(config) {
        const summaryDir = this._getSummaryDir(config);
        if (!fs.existsSync(summaryDir)) {
            return [];
        }

        const dates = fs.readdirSync(summaryDir)
            .filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f))
            .filter(f => fs.statSync(path.join(summaryDir, f)).isDirectory())
            .sort()
            .reverse();

        return dates;
    }

    /**
     * 获取指定日期和粒度的所有总结
     * @param {Object} config - 配置对象
     * @param {string} date - 日期 (YYYY-MM-DD)
     * @param {string} granularity - 粒度 ('1min' | '10min' | '1h')
     * @returns {Array<Object>} 总结列表，按时间升序
     */
    getSummaries(config, date, granularity) {
        const summaryDir = this._getSummaryDir(config);
        const dir = path.join(summaryDir, date, granularity);

        if (!fs.existsSync(dir)) {
            return [];
        }

        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .sort();

        const summaries = [];
        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(dir, file), 'utf8');
                summaries.push(JSON.parse(content));
            } catch (err) {
                // 跳过损坏的文件
            }
        }

        return summaries;
    }

    // ========== Token 统计相关 ==========

    /**
     * 获取 token 统计目录路径
     * @param {Object} config - 配置对象
     * @returns {string} token-stats 目录绝对路径
     */
    _getTokenStatsDir(config) {
        const summaryDir = this._getSummaryDir(config);
        return path.join(summaryDir, 'token-stats');
    }

    /**
     * 获取可用的 token 统计日期列表
     * @param {Object} config - 配置对象
     * @returns {Array<string>} 日期列表，降序
     */
    getTokenStatsDates(config) {
        const dir = this._getTokenStatsDir(config);
        if (!fs.existsSync(dir)) {
            return [];
        }
        return fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .map(f => f.replace('.json', ''))
            .sort()
            .reverse();
    }

    /**
     * 查询 token 统计数据
     * @param {Object} config - 配置对象
     * @param {string} date - 日期 YYYY-MM-DD
     * @param {Object} [options] - 查询选项
     * @param {string} [options.startMinute] - 起始时间 HH:MM
     * @param {string} [options.endMinute] - 结束时间 HH:MM
     * @param {string} [options.sessionId] - 会话 ID（筛选单次启动）
     * @returns {Object} 查询结果
     */
    getTokenStats(config, date, options = {}) {
        const dir = this._getTokenStatsDir(config);
        const filePath = path.join(dir, `${date}.json`);

        if (!fs.existsSync(filePath)) {
            return { records: [], summary: this._emptyTokenBucket(), by_granularity: {}, by_minute: [], sessions: [] };
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(content);

            // 收集所有 session 及其记录
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
                        record_count: sessionRecords.length,
                        start_time: sessionRecords[0].time,
                        end_time: sessionRecords[sessionRecords.length - 1].time
                    });
                }
            }

            // 会话筛选
            if (options.sessionId) {
                allRecords = allRecords.filter(r => r.session_id === options.sessionId);
            }

            // 时间范围过滤
            if (options.startMinute || options.endMinute) {
                allRecords = allRecords.filter(r => {
                    const minute = r.minute;
                    if (options.startMinute && minute < options.startMinute) return false;
                    if (options.endMinute && minute > options.endMinute) return false;
                    return true;
                });
            }

            // 按时间排序
            allRecords.sort((a, b) => a.time.localeCompare(b.time));

            // 总汇总
            const summary = this._emptyTokenBucket();
            for (const r of allRecords) {
                this._addToBucket(summary, r);
            }

            // 按粒度分类
            const byGranularity = {};
            for (const r of allRecords) {
                if (!byGranularity[r.granularity]) {
                    byGranularity[r.granularity] = this._emptyTokenBucket();
                }
                this._addToBucket(byGranularity[r.granularity], r);
            }

            // 按分钟聚合
            const byMinuteMap = {};
            for (const r of allRecords) {
                if (!byMinuteMap[r.minute]) {
                    byMinuteMap[r.minute] = this._emptyTokenBucket();
                    byMinuteMap[r.minute].minute = r.minute;
                }
                this._addToBucket(byMinuteMap[r.minute], r);
            }
            const byMinute = Object.values(byMinuteMap).sort((a, b) =>
                a.minute.localeCompare(b.minute)
            );

            return {
                records: allRecords,
                summary,
                by_granularity: byGranularity,
                by_minute: byMinute,
                sessions: sessionInfos
            };
        } catch (err) {
            return { records: [], summary: this._emptyTokenBucket(), by_granularity: {}, by_minute: [], sessions: [] };
        }
    }

    /**
     * 创建空的 token 统计桶
     * @returns {Object}
     */
    _emptyTokenBucket() {
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
     * 将记录累加到统计桶
     * @param {Object} bucket - 统计桶
     * @param {Object} record - 单条记录
     */
    _addToBucket(bucket, record) {
        bucket.count++;
        bucket.prompt_tokens += record.prompt_tokens || 0;
        bucket.candidates_tokens += record.candidates_tokens || 0;
        bucket.thoughts_tokens += record.thoughts_tokens || 0;
        bucket.total_tokens += record.total_tokens || 0;
        bucket.prompt_text_tokens += record.prompt_text_tokens || 0;
        bucket.prompt_image_tokens += record.prompt_image_tokens || 0;
    }

    /**
     * 获取最新的截图文件列表
     * @param {Object} config - 配置对象
     * @param {number} [count=20] - 数量
     * @returns {Array<Object>} 截图信息列表
     */
    getRecentScreenshots(config, count = 20) {
        const dir = config.storage?.directory || './screenshots';
        // 展开 ~ 路径
        const expanded = this._expandHome(dir);
        let screenshotDir;

        if (path.isAbsolute(expanded)) {
            screenshotDir = expanded;
        } else {
            screenshotDir = path.resolve(this.projectRoot, 'auto_screenshot', expanded);
        }

        if (!fs.existsSync(screenshotDir)) {
            return [];
        }

        // 获取最新日期目录
        const dates = fs.readdirSync(screenshotDir)
            .filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f))
            .filter(f => fs.statSync(path.join(screenshotDir, f)).isDirectory())
            .sort()
            .reverse();

        if (dates.length === 0) {
            return [];
        }

        const screenshots = [];
        for (const date of dates) {
            if (screenshots.length >= count) break;

            const dateDir = path.join(screenshotDir, date);
            const files = fs.readdirSync(dateDir)
                .filter(f => /\.(jpeg|jpg|png)$/i.test(f))
                .sort()
                .reverse();

            for (const file of files) {
                if (screenshots.length >= count) break;
                screenshots.push({
                    date,
                    filename: file,
                    path: path.join(dateDir, file)
                });
            }
        }

        return screenshots;
    }
}

module.exports = SummaryReader;
