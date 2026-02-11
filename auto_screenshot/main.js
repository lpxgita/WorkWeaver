#!/usr/bin/env node

/**
 * 自动截图服务 - 主入口
 * 
 * 使用方法:
 *   node main.js                        # 使用默认配置文件 config.yaml
 *   node main.js --config ./my.yaml     # 指定配置文件
 *   node main.js -c ./my.yaml           # 简写
 *   node main.js --help                 # 显示帮助
 */

const path = require('path');
const Config = require('./src/config');
const Logger = require('./src/logger');
const Storage = require('./src/storage');
const Screenshot = require('./src/screenshot');
const Scheduler = require('./src/scheduler');
const ScreenshotCleaner = require('./src/cleaner');

// 版本号
const VERSION = '1.0.0';

/**
 * 解析命令行参数
 * @param {Array} argv - 命令行参数
 * @returns {Object} 解析后的参数
 */
function parseArgs(argv) {
    const args = {
        config: '../config.yaml',
        legacy: false,
        help: false,
        version: false
    };
    
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        
        if (arg === '--help' || arg === '-h') {
            args.help = true;
        } else if (arg === '--version' || arg === '-v') {
            args.version = true;
        } else if (arg === '--config' || arg === '-c') {
            args.config = argv[++i];
        } else if (arg === '--legacy') {
            // 使用模块独立配置文件（向后兼容）
            args.legacy = true;
        }
    }
    
    return args;
}

/**
 * 显示帮助信息
 */
function showHelp() {
    console.log(`
自动截图服务 v${VERSION}

使用方法:
  node main.js [选项]

选项:
  -c, --config <path>  指定配置文件路径 (默认: ../config.yaml 统一配置)
  --legacy             使用模块独立配置文件模式（向后兼容）
  -h, --help           显示帮助信息
  -v, --version        显示版本号

示例:
  node main.js                                # 使用统一配置 ../config.yaml
  node main.js --config /path/to/config.yaml  # 指定统一配置路径
  node main.js --legacy -c ./config.yaml      # 向后兼容：使用模块独立配置

配置文件:
  推荐使用 work_monitor/config.yaml 统一配置（同时驱动截图和AI总结）
  也支持 --legacy 模式使用模块独立的 config.yaml
`);
}

/**
 * 解析停止时间列表
 * @param {Array<string>} stopTimes - 停止时间列表
 * @returns {Array<{label: string, hours: number, minutes: number, total: number}>}
 */
function parseStopTimes(stopTimes) {
    if (!Array.isArray(stopTimes)) {
        return [];
    }
    const normalized = stopTimes
        .map(t => (typeof t === 'string' ? t.trim() : ''))
        .filter(Boolean);
    const unique = Array.from(new Set(normalized));
    return unique
        .map(label => {
            const [hours, minutes] = label.split(':').map(Number);
            return { label, hours, minutes, total: hours * 60 + minutes };
        })
        .sort((a, b) => a.total - b.total);
}

/**
 * 获取下一次停止时间
 * @param {Array<{label: string, hours: number, minutes: number, total: number}>} stopTimes - 停止时间列表
 * @param {Array<string>|null} days - 允许的工作日（为空则不限制）
 * @returns {Date|null}
 */
function getNextStopTime(stopTimes, days) {
    if (!stopTimes || stopTimes.length === 0) {
        return null;
    }
    const now = new Date();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
        const date = new Date(now);
        date.setDate(now.getDate() + dayOffset);
        const currentDay = dayNames[date.getDay()];
        if (Array.isArray(days) && days.length > 0 && !days.includes(currentDay)) {
            continue;
        }
        for (const stop of stopTimes) {
            const target = new Date(date);
            target.setHours(stop.hours, stop.minutes, 0, 0);
            if (dayOffset === 0 && target.getTime() <= now.getTime()) {
                continue;
            }
            return target;
        }
    }
    return null;
}

/**
 * 格式化时间字符串
 * @param {Date} date - 时间对象
 * @returns {string}
 */
function formatDateTime(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
}

/**
 * 启用停止时间定时器
 * @param {Object} config - 配置对象
 * @param {Logger} logger - 日志模块
 * @param {Function} shutdown - 关闭函数
 * @returns {NodeJS.Timeout|null}
 */
function scheduleStopTimer(config, logger, shutdown) {
    const stopTimes = parseStopTimes(config.schedule?.stop_times);
    if (stopTimes.length === 0) {
        return null;
    }
    const useDays = config.schedule?.enabled === true;
    const days = useDays ? config.schedule?.days : null;
    const nextStop = getNextStopTime(stopTimes, days);
    if (!nextStop) {
        logger.warn('未找到可用的停止时间，停止机制未启用');
        return null;
    }
    const delay = Math.max(0, nextStop.getTime() - Date.now());
    logger.info(`停止时间: ${stopTimes.map(t => t.label).join(', ')}，下一次停止: ${formatDateTime(nextStop)}`);
    return setTimeout(() => {
        logger.info(`到达停止时间 ${formatDateTime(nextStop)}，服务将自动停止`);
        shutdown('STOP_TIME').catch(err => {
            logger.error(`自动停止失败: ${err.message}`);
        });
    }, delay);
}

/**
 * 主函数
 */
async function main() {
    // 解析命令行参数
    const args = parseArgs(process.argv);
    
    // 显示帮助
    if (args.help) {
        showHelp();
        process.exit(0);
    }
    
    // 显示版本
    if (args.version) {
        console.log(`v${VERSION}`);
        process.exit(0);
    }
    
    // 切换工作目录到脚本所在目录
    const scriptDir = path.dirname(require.main.filename);
    process.chdir(scriptDir);
    
    let logger = null;
    let scheduler = null;
    let stopTimer = null;
    let isStopping = false;
    
    try {
        // 1. 加载配置
        console.log(`加载配置文件: ${args.config} (${args.legacy ? '独立模式' : '统一模式'})`);
        const config = args.legacy
            ? Config.load(args.config)
            : Config.loadUnified(args.config);
        
        // 2. 初始化日志模块
        logger = new Logger(config.logging);
        logger.info('自动截图服务启动');
        logger.info(`配置: 间隔=${config.screenshot.interval}秒, 目录=${config.storage.directory}`);
        
        // 3. 初始化存储模块
        const storage = new Storage(config.storage, config.screenshot.format);
        
        // 4. 初始化截图引擎
        const screenshot = new Screenshot(config.screenshot);
        
        // 5. 初始化调度器
        scheduler = new Scheduler({
            config,
            screenshot,
            storage,
            logger
        });
        
        // 6. 注册信号处理（优雅关闭）
        const shutdown = async (signal) => {
            if (isStopping) {
                return;
            }
            isStopping = true;
            logger.info(`收到 ${signal} 信号，正在关闭...`);

            if (stopTimer) {
                clearTimeout(stopTimer);
                stopTimer = null;
            }
            
            if (scheduler) {
                await scheduler.stop();
            }
            
            logger.info('服务已停止');
            logger.close();
            
            process.exit(0);
        };
        
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        
        // 7. 启动调度器
        scheduler.start();

        // 7.5 启动时异步执行截图清理（不阻塞主流程）
        const cleaner = new ScreenshotCleaner(storage.baseDirectory, logger, config.storage.cleanup || {});
        cleaner.clean().catch(err => {
            logger.error(`截图清理失败: ${err.message}`);
        });

        // 显示时间限制信息
        if (config.schedule.enabled) {
            logger.info(`时间限制: ${config.schedule.start_time} - ${config.schedule.end_time}`);
            logger.info(`工作日: ${config.schedule.days.join(', ')}`);
        } else {
            logger.info('时间限制: 未启用（全天候截图）');
        }

        // 启用停止时间机制（与时间限制独立）
        stopTimer = scheduleStopTimer(config, logger, shutdown);
        
        logger.info('服务运行中，按 Ctrl+C 停止');
        
    } catch (err) {
        // 配置错误等致命错误
        const errorMessage = `启动失败: ${err.message}`;
        
        if (logger) {
            logger.error(errorMessage);
            logger.close();
        } else {
            console.error(errorMessage);
        }
        
        process.exit(1);
    }
}

// 运行主函数
main().catch(err => {
    console.error('未捕获的错误:', err);
    process.exit(1);
});
