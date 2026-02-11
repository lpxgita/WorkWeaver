'use strict';

const ActiveWindowMonitor = require('./src/active-window-monitor');

/**
 * 焦点窗口监控 - CLI 入口
 * 
 * 用法:
 *   node main.js                    # 持续监控，间隔 1 秒
 *   node main.js --interval 2000    # 持续监控，间隔 2 秒
 *   node main.js --once             # 获取一次后退出
 *   node main.js --duration 30      # 监控 30 秒后自动停止
 *   node main.js --changes-only     # 仅在窗口变化时输出
 *   node main.js --json             # JSON 格式输出
 */

// 解析命令行参数
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        interval: 1000,
        once: false,
        duration: 0,
        changesOnly: false,
        json: false
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--interval':
            case '-i':
                options.interval = parseInt(args[++i], 10);
                if (isNaN(options.interval) || options.interval < 100) {
                    console.error('错误: 间隔时间必须 >= 100ms');
                    process.exit(1);
                }
                break;
            case '--once':
            case '-1':
                options.once = true;
                break;
            case '--duration':
            case '-d':
                options.duration = parseInt(args[++i], 10);
                if (isNaN(options.duration) || options.duration <= 0) {
                    console.error('错误: 持续时间必须为正整数（秒）');
                    process.exit(1);
                }
                break;
            case '--changes-only':
            case '-c':
                options.changesOnly = true;
                break;
            case '--json':
            case '-j':
                options.json = true;
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
                break;
            default:
                console.error(`未知参数: ${args[i]}`);
                printHelp();
                process.exit(1);
        }
    }

    return options;
}

/**
 * 打印帮助信息
 */
function printHelp() {
    console.log(`
焦点窗口监控 - 实时获取当前焦点窗口名称（macOS）

用法: node main.js [选项]

选项:
  --interval, -i <ms>    轮询间隔毫秒数（默认: 1000，最小: 100）
  --once, -1             获取一次后退出
  --duration, -d <s>     监控持续时间（秒），到时自动停止
  --changes-only, -c     仅在窗口变化时输出
  --json, -j             JSON 格式输出
  --help, -h             显示帮助信息

示例:
  node main.js                        # 持续监控（默认 1 秒间隔）
  node main.js -i 500                 # 500ms 间隔
  node main.js --once                 # 获取一次当前窗口
  node main.js -d 60 -c               # 监控 60 秒，仅输出变化
  node main.js --json --changes-only  # JSON 格式输出变化
`);
}

/**
 * 格式化时间戳
 * @param {number} timestamp - 毫秒时间戳
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

/**
 * 格式化输出窗口信息
 * @param {Object} windowInfo - 窗口信息
 * @param {Object} options - 输出选项
 * @param {string} [prefix=''] - 前缀标识
 */
function formatOutput(windowInfo, options, prefix = '') {
    if (options.json) {
        console.log(JSON.stringify(windowInfo));
    } else {
        const time = formatTime(windowInfo.timestamp);
        const prefixStr = prefix ? `${prefix} ` : '';
        const title = windowInfo.title || '(无标题)';
        console.log(`${prefixStr}[${time}] ${windowInfo.app} — ${title}`);
    }
}

/**
 * 单次获取模式
 */
async function runOnce() {
    const monitor = new ActiveWindowMonitor();
    try {
        const info = await monitor.getActiveWindow();
        formatOutput(info, parseArgs());
    } catch (error) {
        console.error(`获取窗口信息失败: ${error.message}`);
        process.exit(1);
    }
}

/**
 * 持续监控模式
 */
function runMonitor(options) {
    const monitor = new ActiveWindowMonitor({
        interval: options.interval
    });

    // 监控启动
    monitor.on('start', (info) => {
        if (!options.json) {
            console.log(`\n📡 焦点窗口监控已启动 (间隔: ${info.interval}ms)`);
            console.log('按 Ctrl+C 停止\n');
            console.log('─'.repeat(60));
        }
    });

    // 窗口变化事件
    monitor.on('change', ({ current, previous }) => {
        if (options.changesOnly || !options.changesOnly) {
            // 在 changes-only 模式下，change 事件是唯一的输出
            if (options.changesOnly) {
                formatOutput(current, options, '→');
            }
        }
    });

    // 每次轮询事件（非 changes-only 模式时输出）
    if (!options.changesOnly) {
        monitor.on('poll', (info) => {
            formatOutput(info, options);
        });
    }

    // 错误处理
    monitor.on('error', (error) => {
        if (options.json) {
            console.error(JSON.stringify({ error: error.message, timestamp: Date.now() }));
        } else {
            console.error(`✗ 错误: ${error.message}`);
        }
    });

    // 停止事件
    monitor.on('stop', (stats) => {
        if (!options.json) {
            console.log('\n' + '─'.repeat(60));
            console.log(`📊 监控统计:`);
            console.log(`   总轮询次数: ${stats.totalPolls}`);
            console.log(`   错误次数: ${stats.totalErrors}`);
            console.log(`   窗口变化记录: ${stats.historySize} 条`);
        }
    });

    // 优雅关闭
    const shutdown = () => {
        monitor.stop();

        // 输出历史摘要
        if (!options.json) {
            const history = monitor.getHistory();
            if (history.length > 0) {
                console.log(`\n📋 窗口变化历史 (最近 ${history.length} 条):`);
                history.forEach((item, index) => {
                    const time = formatTime(item.timestamp);
                    console.log(`   ${index + 1}. [${time}] ${item.app} — ${item.title || '(无标题)'}`);
                });
            }
        }

        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // 如果设置了持续时间，到时自动停止
    if (options.duration > 0) {
        setTimeout(() => {
            if (!options.json) {
                console.log(`\n⏰ 已达到设定时间 ${options.duration} 秒，自动停止`);
            }
            shutdown();
        }, options.duration * 1000);
    }

    // 启动监控
    monitor.start();
}

// 主入口
async function main() {
    const options = parseArgs();

    // 检查操作系统
    if (process.platform !== 'darwin') {
        console.error('错误: 此组件仅支持 macOS 系统');
        process.exit(1);
    }

    if (options.once) {
        await runOnce();
    } else {
        runMonitor(options);
    }
}

main().catch((error) => {
    console.error(`启动失败: ${error.message}`);
    process.exit(1);
});
