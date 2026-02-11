/**
 * 调度器模块
 * 管理定时截图任务
 */

class Scheduler {
    /**
     * 创建调度器实例
     * @param {Object} options
     * @param {Object} options.config - 完整配置
     * @param {Screenshot} options.screenshot - 截图引擎
     * @param {Storage} options.storage - 存储模块
     * @param {Logger} options.logger - 日志模块
     */
    constructor(options) {
        this.config = options.config;
        this.screenshot = options.screenshot;
        this.storage = options.storage;
        this.logger = options.logger;
        
        // 状态
        this.isRunning = false;
        this.isExecuting = false;
        this.intervalId = null;
        this.lastExecuteTime = null;
        this.executeCount = 0;
        
        // 绑定方法以保持 this 上下文
        this.executeTask = this.executeTask.bind(this);
    }

    /**
     * 启动调度器
     */
    start() {
        if (this.isRunning) {
            this.logger.warn('调度器已在运行中');
            return;
        }
        
        this.isRunning = true;
        const interval = this.config.screenshot.interval * 1000; // 转换为毫秒
        
        this.logger.info(`调度器启动，截图间隔: ${this.config.screenshot.interval} 秒`);
        
        // 立即执行一次
        this.executeTask();
        
        // 启动定时器
        this.intervalId = setInterval(this.executeTask, interval);
    }

    /**
     * 停止调度器
     * @returns {Promise<void>} 等待当前任务完成
     */
    async stop() {
        if (!this.isRunning) {
            return;
        }
        
        this.logger.info('正在停止调度器...');
        
        // 停止定时器
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        
        // 等待当前任务完成
        while (this.isExecuting) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        this.isRunning = false;
        this.logger.info(`调度器已停止，共执行 ${this.executeCount} 次截图`);
    }

    /**
     * 检查是否允许截图
     * @returns {boolean}
     */
    isAllowed() {
        // 如果未启用时间限制，始终允许
        if (!this.config.schedule.enabled) {
            return true;
        }
        
        return this.isAllowedDay() && this.isWithinAllowedTime();
    }

    /**
     * 检查是否为允许的工作日
     * @returns {boolean}
     */
    isAllowedDay() {
        const days = this.config.schedule.days;
        if (!days || days.length === 0) {
            return true;
        }
        
        const now = new Date();
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const currentDay = dayNames[now.getDay()];
        
        return days.includes(currentDay);
    }

    /**
     * 检查是否在允许的时间范围内
     * @returns {boolean}
     */
    isWithinAllowedTime() {
        const { start_time, end_time } = this.config.schedule;
        
        if (!start_time || !end_time) {
            return true;
        }
        
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        
        const [startHour, startMinute] = start_time.split(':').map(Number);
        const [endHour, endMinute] = end_time.split(':').map(Number);
        
        const startTotal = startHour * 60 + startMinute;
        const endTotal = endHour * 60 + endMinute;
        
        return currentMinutes >= startTotal && currentMinutes <= endTotal;
    }

    /**
     * 执行一次截图任务
     * @returns {Promise<void>}
     */
    async executeTask() {
        // 防止并发执行
        if (this.isExecuting) {
            this.logger.debug('上一次任务尚未完成，跳过');
            return;
        }
        
        // 检查是否允许截图
        if (!this.isAllowed()) {
            this.logger.debug('当前时间不在允许范围内，跳过');
            return;
        }
        
        this.isExecuting = true;
        
        try {
            // 执行截图
            const captures = await this.screenshot.captureAll();
            
            if (captures.length === 0) {
                this.logger.warn('没有可用的显示器');
                return;
            }
            
            // 保存每个截图
            for (const { display, buffer } of captures) {
                try {
                    const filePath = this.storage.generateFilePath(display.index);
                    await this.storage.save(buffer, filePath);
                    
                    // 获取相对路径用于日志
                    const relativePath = this.storage.getRelativePath(filePath);
                    this.logger.info(`截图保存: ${relativePath}`);
                } catch (saveError) {
                    this.logger.error(`保存失败 (显示器 ${display.index}): ${saveError.message}`);
                }
            }
            
            this.executeCount++;
            this.lastExecuteTime = new Date();
            
        } catch (err) {
            this.logger.error(`截图任务失败: ${err.message}`);
        } finally {
            this.isExecuting = false;
        }
    }

    /**
     * 获取调度器状态
     * @returns {Object} 状态对象
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            isExecuting: this.isExecuting,
            lastExecuteTime: this.lastExecuteTime,
            executeCount: this.executeCount,
            interval: this.config.screenshot.interval
        };
    }
}

module.exports = Scheduler;
