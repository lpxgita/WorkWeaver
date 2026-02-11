/**
 * 总结调度器模块
 * 定时触发各粒度总结任务，编排完整流程
 */

class SummaryScheduler {
    /**
     * 创建总结调度器
     * @param {Object} options
     * @param {Object} options.config - 完整配置
     * @param {ScreenshotReader} options.screenshotReader - 截图读取器
     * @param {SummaryStore} options.summaryStore - 总结存储
     * @param {GeminiClient} options.geminiClient - Gemini 客户端
     * @param {PromptBuilder} options.promptBuilder - 提示词构建器
     * @param {TokenTracker} options.tokenTracker - Token 用量跟踪器
     * @param {ActiveWindowCollector} [options.activeWindowCollector] - 焦点窗口采集器（可选）
     * @param {PromptLogger} [options.promptLogger] - Prompt 日志记录器（可选）
     * @param {ScreenshotComparer} [options.screenshotComparer] - 截图比对器（可选）
     * @param {TodoWriter} [options.todoWriter] - Todo 回写器（可选）
     * @param {Logger} options.logger - 日志模块
     */
    constructor(options) {
        this.config = options.config;
        this.screenshotReader = options.screenshotReader;
        this.summaryStore = options.summaryStore;
        this.geminiClient = options.geminiClient;
        this.promptBuilder = options.promptBuilder;
        this.tokenTracker = options.tokenTracker;
        this.activeWindowCollector = options.activeWindowCollector || null;
        this.promptLogger = options.promptLogger || null;
        this.screenshotComparer = options.screenshotComparer || null;
        this.todoWriter = options.todoWriter || null;
        this.logger = options.logger;

        // 定时器 ID
        this._timer2min = null;
        this._timer10min = null;
        this._timer1h = null;

        // 运行状态
        this.isRunning = false;
        this._executing = {
            '2min': false,
            '10min': false,
            '1h': false
        };

        // 执行统计（含跳过次数）
        this.stats = {
            '2min': { count: 0, errors: 0, skipped: 0 },
            '10min': { count: 0, errors: 0, skipped: 0 },
            '1h': { count: 0, errors: 0, skipped: 0 }
        };

        // 基础粒度配置
        this.baseGranularity = '2min';
        this.baseMinutes = 2;
    }

    /**
     * 启动调度器
     */
    start() {
        if (this.isRunning) {
            this.logger.warn('总结调度器已在运行中');
            return;
        }

        this.isRunning = true;
        this.logger.info('总结调度器启动');

        const granularity = this.config.summary.granularity;

        // 2分钟级别
        const baseConfig = granularity[this.baseGranularity];
        if (baseConfig && baseConfig.enabled) {
            const intervalMs = this.baseMinutes * 60 * 1000;
            this.logger.info(`启用 ${this.baseGranularity} 级别总结，间隔: ${this.baseMinutes * 60}秒`);
            this._timer2min = setInterval(() => this._run2min(), intervalMs);
        }

        // 10分钟级别
        if (granularity['10min'].enabled) {
            this.logger.info('启用 10min 级别总结，间隔: 600秒');
            this._timer10min = setInterval(() => this._run10min(), 10 * 60 * 1000);
        }

        // 1小时级别
        if (granularity['1h'].enabled) {
            this.logger.info('启用 1h 级别总结，间隔: 3600秒');
            this._timer1h = setInterval(() => this._run1h(), 60 * 60 * 1000);
        }
    }

    /**
     * 停止调度器
     * @returns {Promise<void>} 等待所有执行中的任务完成
     */
    async stop() {
        if (!this.isRunning) {
            return;
        }

        this.logger.info('正在停止总结调度器...');

        // 清除定时器
        if (this._timer2min) { clearInterval(this._timer2min); this._timer2min = null; }
        if (this._timer10min) { clearInterval(this._timer10min); this._timer10min = null; }
        if (this._timer1h) { clearInterval(this._timer1h); this._timer1h = null; }

        // 等待所有执行中的任务完成
        while (this._executing['2min'] || this._executing['10min'] || this._executing['1h']) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.isRunning = false;
        const s = this.stats;
        this.logger.info(`总结调度器已停止。统计: 2min=${s['2min'].count}次(${s['2min'].errors}错误,${s['2min'].skipped}跳过), 10min=${s['10min'].count}次(${s['10min'].errors}错误,${s['10min'].skipped}跳过), 1h=${s['1h'].count}次(${s['1h'].errors}错误,${s['1h'].skipped}跳过)`);
    }

    /**
     * 检查是否在允许的时间范围内
     * @returns {boolean}
     */
    _isAllowed() {
        if (!this.config.schedule.enabled) {
            return true;
        }

        const now = new Date();
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const currentDay = dayNames[now.getDay()];

        if (!this.config.schedule.days.includes(currentDay)) {
            return false;
        }

        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const [startH, startM] = this.config.schedule.start_time.split(':').map(Number);
        const [endH, endM] = this.config.schedule.end_time.split(':').map(Number);

        return currentMinutes >= (startH * 60 + startM) && currentMinutes <= (endH * 60 + endM);
    }

    /**
     * 检测历史总结与当前时间之间的时间断档
     * 如果最后一条总结距今超过2分钟，说明服务中间有中断
     * @param {Array<Object>} historySummaries - 历史总结数组（按时间升序）
     * @param {number} intervalMinutes - 期望间隔分钟数
     * @returns {Object|null} 断档信息 { gapMinutes, lastSummaryTime } 或 null
     */
    _detectTimeGap(historySummaries, intervalMinutes = 1) {
        if (!historySummaries || historySummaries.length === 0) {
            return null;
        }

        // 取最后一条（最新的）历史总结
        const lastSummary = historySummaries[historySummaries.length - 1];
        if (!lastSummary.timestamp) {
            return null;
        }

        const lastTime = new Date(lastSummary.timestamp);
        const now = new Date();
        const diffMs = now.getTime() - lastTime.getTime();
        const diffMinutes = Math.round(diffMs / 60000);

        // 正常间隔为 intervalMinutes，超过 2 倍间隔视为有断档
        if (diffMinutes > intervalMinutes * 2) {
            return {
                gapMinutes: diffMinutes,
                lastSummaryTime: lastTime.toLocaleTimeString('zh-CN')
            };
        }

        return null;
    }

    /**
     * 执行 2 分钟级别总结
     */
    async _run2min() {
        if (this._executing['2min'] || !this._isAllowed()) {
            return;
        }
        this._executing['2min'] = true;

        try {
            this.logger.info('[2min] 开始总结...');

            const baseConfig = this.config.summary.granularity[this.baseGranularity];
            if (!baseConfig || !baseConfig.enabled) {
                this.logger.warn('[2min] 未启用基础粒度，总结跳过');
                return;
            }

            // 1. 读取最近2分钟的截图
            const screenshotsPerMinute = baseConfig.screenshots_per_minute ||
                Math.floor(60 / this.config.screenshot.interval);
            const maxScreenshots = Math.max(1, screenshotsPerMinute * this.baseMinutes);
            const screenshots = this.screenshotReader.getRecentScreenshotBuffers(this.baseMinutes, maxScreenshots);

            if (screenshots.length === 0) {
                this.logger.warn('[2min] 没有可用的截图，跳过');
                return;
            }

            // 2. 截图一致性比对（如果比对器可用）
            // 所有截图完全一致则判定为屏幕无变化，跳过 API 请求
            if (this.screenshotComparer && this.screenshotComparer.allIdentical(screenshots)) {
                // 获取焦点窗口信息用于模板记录
                let activeWindowTextForSkip = '';
                if (this.activeWindowCollector) {
                    const endMs = Date.now();
                    const startMs = endMs - this.baseMinutes * 60 * 1000;
                    const timeline = this.activeWindowCollector.getTimelineInRange(startMs, endMs);
                    activeWindowTextForSkip = this.activeWindowCollector.formatForPrompt(timeline);
                }

                const noChangeRecord = this.screenshotComparer.buildNoChange2minRecord(
                    screenshots, activeWindowTextForSkip
                );
                const nowSkip = new Date();

                // 记录 prompt 日志（标记为跳过）
                if (this.promptLogger) {
                    this.promptLogger.log('2min', nowSkip, [
                        `[截图无变化 - 跳过API请求]\n截图数量: ${screenshots.length}\n焦点窗口: ${activeWindowTextForSkip || '无'}`
                    ]);
                }

                this.summaryStore.save(this.baseGranularity, nowSkip, noChangeRecord);
                this.stats['2min'].skipped++;
                this.logger.info(`[2min] 截图无变化，已使用模板记录（跳过API）`);
                return;
            }

            // 3. 读取历史2min总结
            const historyMinutes = baseConfig.history_minutes || 0;
            const historyCount = Math.max(0, Math.ceil(historyMinutes / this.baseMinutes));
            const historySummaries = historyCount > 0
                ? this.summaryStore.getRecentSummaries(this.baseGranularity, historyCount)
                : [];

            // 4. 检测时间断档
            // 如果最近一条历史总结的时间戳距离现在超过 2 倍粒度间隔，说明服务中间有空档
            const gapInfo = this._detectTimeGap(historySummaries, this.baseMinutes);
            if (gapInfo) {
                this.logger.info(`[2min] 检测到时间断档: 上次总结在 ${gapInfo.lastSummaryTime}，中断了约 ${gapInfo.gapMinutes} 分钟`);
            }

            // 5. 获取焦点窗口信息（如果采集器可用）
            let activeWindowText = '';
            if (this.activeWindowCollector) {
                const endMs = Date.now();
                const startMs = endMs - this.baseMinutes * 60 * 1000;
                const timeline = this.activeWindowCollector.getTimelineInRange(startMs, endMs);
                activeWindowText = this.activeWindowCollector.formatForPrompt(timeline);
                if (activeWindowText) {
                    this.logger.debug(`[2min] 焦点窗口信息: ${timeline.length} 条记录`);
                }
            }

            // 6. 构建请求
            const contents = this.promptBuilder.build2min(
                screenshots,
                historySummaries,
                this.config.screenshot.format,
                gapInfo,
                activeWindowText
            );

            // 6.1 记录 prompt 日志
            const now2min = new Date();
            if (this.promptLogger) {
                this.promptLogger.log('2min', now2min, contents);
            }

            // 7. 调用 Gemini
            const { text: responseText, usageMetadata } = await this.geminiClient.generate(contents);

            // 7.1 记录 token 用量
            if (this.tokenTracker && usageMetadata) {
                this.tokenTracker.record('2min', usageMetadata);
            }

            // 8. 解析响应
            const parsed = this._parseResponse(responseText);

            // 9. 保存
            this.summaryStore.save(this.baseGranularity, now2min, parsed);
            this.stats['2min'].count++;

            // 10. Todo 回写（将 AI 新建的任务/子任务/行为写入 JSON）
            if (this.todoWriter) {
                try {
                    this.todoWriter.processResponse(parsed);
                } catch (writeErr) {
                    this.logger.warn(`[2min] Todo 回写失败: ${writeErr.message}`);
                }
            }

            this.logger.info('[2min] 总结完成');

        } catch (err) {
            this.stats['2min'].errors++;
            this.logger.error(`[2min] 总结失败: ${err.message}`);
        } finally {
            this._executing['2min'] = false;
        }
    }

    /**
     * 执行 10 分钟级别总结
     */
    async _run10min() {
        if (this._executing['10min'] || !this._isAllowed()) {
            return;
        }
        this._executing['10min'] = true;

        try {
            this.logger.info('[10min] 开始总结...');

            // 1. 读取最近10分钟的2min总结
            const recentCount = Math.max(1, Math.ceil(10 / this.baseMinutes));
            const recent2min = this.summaryStore.getRecentSummaries(this.baseGranularity, recentCount);

            if (recent2min.length === 0) {
                this.logger.warn('[10min] 没有可用的2min总结，跳过');
                return;
            }

            // 2. 检查所有2min子级是否全部为"无变化"
            if (this.screenshotComparer && this.screenshotComparer.allNoChange(recent2min)) {
                const noChangeRecord = this.screenshotComparer.buildNoChange10minRecord(recent2min);
                const nowSkip10 = new Date();

                // 记录 prompt 日志（标记为跳过）
                if (this.promptLogger) {
                    this.promptLogger.log('10min', nowSkip10, [
                        `[全部2min子级无变化 - 跳过API请求]\n无变化2min记录数: ${recent2min.length}`
                    ]);
                }

                this.summaryStore.save('10min', nowSkip10, noChangeRecord);
                this.stats['10min'].skipped++;
                this.logger.info(`[10min] 所有2min子级均无变化（${recent2min.length}条），已使用模板记录（跳过API）`);
                return;
            }

            // 3. 读取历史10min总结
            const historyCount = this.config.summary.granularity['10min'].history_count;
            const history10min = this.summaryStore.getRecentSummaries('10min', historyCount);

            // 4. 获取焦点窗口信息（如果采集器可用）
            let activeWindowText10 = '';
            if (this.activeWindowCollector) {
                const endMs = Date.now();
                const startMs = endMs - 10 * 60 * 1000;
                const timeline = this.activeWindowCollector.getTimelineInRange(startMs, endMs);
                activeWindowText10 = this.activeWindowCollector.formatForPrompt(timeline);
                if (activeWindowText10) {
                    this.logger.debug(`[10min] 焦点窗口信息: ${timeline.length} 条记录`);
                }
            }

            // 5. 构建请求
            const contents = this.promptBuilder.build10min(recent2min, history10min, activeWindowText10);

            // 5.1 记录 prompt 日志
            const now10min = new Date();
            if (this.promptLogger) {
                this.promptLogger.log('10min', now10min, contents);
            }

            // 6. 调用 Gemini
            const { text: responseText, usageMetadata } = await this.geminiClient.generate(contents);

            // 6.1 记录 token 用量
            if (this.tokenTracker && usageMetadata) {
                this.tokenTracker.record('10min', usageMetadata);
            }

            // 7. 解析响应
            const parsed = this._parseResponse(responseText);

            // 8. 保存
            this.summaryStore.save('10min', now10min, parsed);
            this.stats['10min'].count++;

            this.logger.info('[10min] 总结完成');

        } catch (err) {
            this.stats['10min'].errors++;
            this.logger.error(`[10min] 总结失败: ${err.message}`);
        } finally {
            this._executing['10min'] = false;
        }
    }

    /**
     * 执行 1 小时级别总结
     */
    async _run1h() {
        if (this._executing['1h'] || !this._isAllowed()) {
            return;
        }
        this._executing['1h'] = true;

        try {
            this.logger.info('[1h] 开始总结...');

            // 1. 读取最近6条10min总结
            const recentCount = this.config.summary.granularity['1h'].recent_10min_count;
            const recent10min = this.summaryStore.getRecentSummaries('10min', recentCount);

            if (recent10min.length === 0) {
                this.logger.warn('[1h] 没有可用的10min总结，跳过');
                return;
            }

            // 2. 检查所有10min子级是否全部为"无变化"
            if (this.screenshotComparer && this.screenshotComparer.allNoChange(recent10min)) {
                const noChangeRecord = this.screenshotComparer.buildNoChange1hRecord(recent10min);
                const nowSkip1h = new Date();

                // 记录 prompt 日志（标记为跳过）
                if (this.promptLogger) {
                    this.promptLogger.log('1h', nowSkip1h, [
                        `[全部10min子级无变化 - 跳过API请求]\n无变化10min记录数: ${recent10min.length}`
                    ]);
                }

                this.summaryStore.save('1h', nowSkip1h, noChangeRecord);
                this.stats['1h'].skipped++;
                this.logger.info(`[1h] 所有10min子级均无变化（${recent10min.length}条），已使用模板记录（跳过API）`);
                return;
            }

            // 3. 读取更早6条10min总结
            const earlierCount = this.config.summary.granularity['1h'].earlier_10min_count;
            const earlier10min = this.summaryStore.getEarlierSummaries('10min', earlierCount, recentCount);

            // 4. 获取焦点窗口信息（如果采集器可用）
            let activeWindowText1h = '';
            if (this.activeWindowCollector) {
                const endMs = Date.now();
                const startMs = endMs - 60 * 60 * 1000;
                const timeline = this.activeWindowCollector.getTimelineInRange(startMs, endMs);
                activeWindowText1h = this.activeWindowCollector.formatForPrompt(timeline);
                if (activeWindowText1h) {
                    this.logger.debug(`[1h] 焦点窗口信息: ${timeline.length} 条记录`);
                }
            }

            // 5. 构建请求
            const contents = this.promptBuilder.build1h(recent10min, earlier10min, activeWindowText1h);

            // 5.1 记录 prompt 日志
            const now1h = new Date();
            if (this.promptLogger) {
                this.promptLogger.log('1h', now1h, contents);
            }

            // 6. 调用 Gemini
            const { text: responseText, usageMetadata } = await this.geminiClient.generate(contents);

            // 6.1 记录 token 用量
            if (this.tokenTracker && usageMetadata) {
                this.tokenTracker.record('1h', usageMetadata);
            }

            // 7. 解析响应
            const parsed = this._parseResponse(responseText);

            // 8. 保存
            this.summaryStore.save('1h', now1h, parsed);
            this.stats['1h'].count++;

            this.logger.info('[1h] 总结完成');

        } catch (err) {
            this.stats['1h'].errors++;
            this.logger.error(`[1h] 总结失败: ${err.message}`);
        } finally {
            this._executing['1h'] = false;
        }
    }

    /**
     * 解析 AI 响应文本为结构化对象
     * 尝试 JSON 解析，失败则保存原始文本
     * @param {string} responseText - AI 响应文本
     * @returns {Object} 解析后的对象
     */
    _parseResponse(responseText) {
        try {
            // 尝试提取 JSON（可能被 markdown 代码块包裹）
            let jsonStr = responseText.trim();

            // 去除 markdown 代码块标记
            const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1].trim();
            }

            return JSON.parse(jsonStr);
        } catch (err) {
            this.logger.warn(`响应解析为JSON失败，保存原始文本: ${err.message}`);
            return { raw_response: responseText };
        }
    }

    /**
     * 获取调度器状态
     * @returns {Object} 状态对象
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            executing: { ...this._executing },
            stats: { ...this.stats }
        };
    }
}

module.exports = SummaryScheduler;
