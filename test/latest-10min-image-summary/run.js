#!/usr/bin/env node

/**
 * 最新10分钟截图回放测试程序
 * 功能:
 * 1. 优先读取当天最新10分钟截图数据（5个2分钟片段）。
 * 2. 如果当天数据不足，自动回退读取前一天。
 * 3. 逐段生成2分钟级结果，再基于5条2分钟结果生成10分钟级结果。
 * 4. 将窗口信息、Prompt文本、原始响应与解析结果写入测试目录。
 */

const fs = require('fs');
const path = require('path');
const Config = require('../../ai_summary/src/config');
const Logger = require('../../ai_summary/src/logger');
const ScreenshotReader = require('../../ai_summary/src/screenshot-reader');
const GeminiClient = require('../../ai_summary/src/gemini-client');
const PromptBuilder = require('../../ai_summary/src/prompt-builder');
const ScreenshotComparer = require('../../ai_summary/src/screenshot-comparer');

const TWO_MINUTES_MS = 2 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const SEGMENT_COUNT = 5;

/**
 * 解析命令行参数
 * @param {Array<string>} argv - 命令行参数
 * @returns {Object} 参数对象
 */
function parseArgs(argv) {
    const args = {
        config: 'config.yaml',
        legacy: false,
        todoDir: '',
        outputDir: 'test/latest-10min-image-summary/output',
        help: false
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            args.help = true;
        } else if (arg === '--legacy') {
            args.legacy = true;
        } else if (arg === '--config' || arg === '-c') {
            if (i + 1 >= argv.length) {
                throw new Error(`${arg} 缺少路径参数`);
            }
            args.config = argv[++i];
        } else if (arg === '--todo-dir') {
            if (i + 1 >= argv.length) {
                throw new Error('--todo-dir 缺少目录参数');
            }
            args.todoDir = argv[++i];
        } else if (arg === '--output-dir' || arg === '-o') {
            if (i + 1 >= argv.length) {
                throw new Error(`${arg} 缺少目录参数`);
            }
            args.outputDir = argv[++i];
        } else {
            throw new Error(`未知参数: ${arg}`);
        }
    }

    return args;
}

/**
 * 显示帮助信息
 */
function showHelp() {
    console.log(`
最新10分钟截图回放测试程序

用法:
  node test/latest-10min-image-summary/run.js [选项]

选项:
  -c, --config <path>       配置文件路径（默认: config.yaml）
  --legacy                  使用 ai_summary 独立配置模式
  --todo-dir <path>         Todo 数据目录（可选，传给 PromptBuilder）
  -o, --output-dir <path>   测试输出目录（默认: test/latest-10min-image-summary/output）
  -h, --help                显示帮助信息

行为:
  - 优先读取“今天”最新10分钟截图，若5个2分钟片段中任一片段无图，则回退“昨天”
  - 调用 Gemini 生成 2min x 5 + 10min x 1 结果
  - 产物写入 output/<日期_结束时间>/ 目录
`);
}

/**
 * 格式化日期为 YYYY-MM-DD
 * @param {Date} date - 日期对象
 * @returns {string} 日期字符串
 */
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 格式化时间为 HH:mm:ss
 * @param {Date} date - 日期对象
 * @returns {string} 时间字符串
 */
function formatClock(date) {
    return date.toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

/**
 * 格式化时间为 HH-mm-ss（文件命名）
 * @param {Date} date - 日期对象
 * @returns {string} 时间字符串
 */
function formatFileTime(date) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${hh}-${mm}-${ss}`;
}

/**
 * 确保目录存在
 * @param {string} dirPath - 目录路径
 */
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * 写入 JSON 文件
 * @param {string} filePath - 文件路径
 * @param {Object} data - 数据对象
 */
function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 写入文本文件
 * @param {string} filePath - 文件路径
 * @param {string} content - 文本内容
 */
function writeText(filePath, content) {
    fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * 序列化 Gemini contents，图片以占位符形式写入
 * @param {Array} contents - Gemini contents 数组
 * @param {string} title - 标题
 * @returns {string} 可读文本
 */
function serializeContents(contents, title) {
    const lines = [
        `=== ${title} ===`,
        `时间: ${new Date().toISOString()}`,
        '========================================',
        ''
    ];

    for (let i = 0; i < contents.length; i++) {
        const part = contents[i];
        if (typeof part === 'string') {
            lines.push(part);
            lines.push('');
            continue;
        }

        if (part && part.inlineData) {
            const mimeType = part.inlineData.mimeType || 'unknown';
            const dataLen = part.inlineData.data ? part.inlineData.data.length : 0;
            lines.push(`[图片#${i + 1}: ${mimeType}, base64长度: ${dataLen}]`);
            lines.push('');
            continue;
        }

        lines.push(JSON.stringify(part, null, 2));
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * 扫描某一天的截图文件
 * @param {ScreenshotReader} screenshotReader - 截图读取器
 * @param {Date} date - 日期（本地日）
 * @param {Logger} logger - 日志器
 * @returns {{dateStr: string, dateDir: string, screenshots: Array}} 扫描结果
 */
function collectDayScreenshots(screenshotReader, date, logger) {
    const dateStr = formatDate(date);
    const dateDir = path.join(screenshotReader.baseDirectory, dateStr);
    const ext = screenshotReader.format === 'png' ? '.png' : '.jpeg';

    if (!fs.existsSync(dateDir)) {
        logger.warn(`[数据扫描] 日期目录不存在: ${dateDir}`);
        return { dateStr, dateDir, screenshots: [] };
    }

    const screenshots = fs.readdirSync(dateDir)
        .filter(file => file.endsWith(ext))
        .map(file => {
            const timestamp = screenshotReader._parseTimestamp(file);
            return {
                fileName: file,
                path: path.join(dateDir, file),
                timestamp
            };
        })
        .filter(item => item.timestamp instanceof Date && !Number.isNaN(item.timestamp.getTime()))
        .sort((a, b) => a.timestamp - b.timestamp);

    logger.info(`[数据扫描] ${dateStr} 有效截图: ${screenshots.length}`);
    return { dateStr, dateDir, screenshots };
}

/**
 * 从某一天的截图中构建“最新10分钟窗口”
 * @param {Array<{path: string, timestamp: Date}>} dayScreenshots - 当天截图
 * @returns {{ok: boolean, reason?: string, startTime?: Date, endTime?: Date, segments?: Array}}
 */
function buildLatestTenMinuteWindow(dayScreenshots) {
    if (!dayScreenshots || dayScreenshots.length === 0) {
        return { ok: false, reason: '无截图数据' };
    }

    const endTime = dayScreenshots[dayScreenshots.length - 1].timestamp;
    const startTime = new Date(endTime.getTime() - TEN_MINUTES_MS);
    const segments = [];

    for (let i = 0; i < SEGMENT_COUNT; i++) {
        const segStart = new Date(startTime.getTime() + i * TWO_MINUTES_MS);
        const segEnd = new Date(segStart.getTime() + TWO_MINUTES_MS);

        const segmentShots = dayScreenshots.filter(shot => {
            if (i === SEGMENT_COUNT - 1) {
                return shot.timestamp >= segStart && shot.timestamp <= segEnd;
            }
            return shot.timestamp >= segStart && shot.timestamp < segEnd;
        });

        segments.push({
            index: i + 1,
            startTime: segStart,
            endTime: segEnd,
            screenshots: segmentShots
        });
    }

    const emptySegmentIndexes = segments
        .filter(seg => seg.screenshots.length === 0)
        .map(seg => seg.index);

    if (emptySegmentIndexes.length > 0) {
        return {
            ok: false,
            reason: `2分钟片段缺失截图: ${emptySegmentIndexes.join(',')}`,
            startTime,
            endTime,
            segments
        };
    }

    return {
        ok: true,
        startTime,
        endTime,
        segments
    };
}

/**
 * 选择可用测试窗口：今天优先，不足时回退昨天
 * @param {ScreenshotReader} screenshotReader - 截图读取器
 * @param {Logger} logger - 日志器
 * @returns {Object} 选中的窗口信息
 */
function selectTestWindow(screenshotReader, logger) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const candidates = [
        { id: 'today', label: '今天', date: today },
        { id: 'yesterday', label: '昨天', date: yesterday }
    ];

    const reasons = [];

    for (const candidate of candidates) {
        const dayData = collectDayScreenshots(screenshotReader, candidate.date, logger);
        const window = buildLatestTenMinuteWindow(dayData.screenshots);

        if (window.ok) {
            logger.info(
                `[窗口选择] 使用${candidate.label}数据: ${dayData.dateStr} ` +
                `${formatClock(window.startTime)} - ${formatClock(window.endTime)}`
            );
            return {
                sourceId: candidate.id,
                sourceLabel: candidate.label,
                dateStr: dayData.dateStr,
                dateDir: dayData.dateDir,
                startTime: window.startTime,
                endTime: window.endTime,
                segments: window.segments
            };
        }

        const reason = `${candidate.label}(${dayData.dateStr}) 数据不足: ${window.reason}`;
        logger.warn(`[窗口选择] ${reason}`);
        reasons.push(reason);
    }

    throw new Error(`今天和昨天都无法提供完整10分钟截图数据: ${reasons.join('；')}`);
}

/**
 * 读取单个2分钟片段的截图Buffer
 * @param {Object} segment - 片段信息
 * @param {ScreenshotReader} screenshotReader - 截图读取器
 * @returns {Array<{buffer: Buffer, timestamp: Date, path: string}>} 可用截图
 */
function readSegmentBuffers(segment, screenshotReader) {
    const buffers = [];
    for (const shot of segment.screenshots) {
        const buffer = screenshotReader.readAsBuffer(shot.path);
        if (buffer) {
            buffers.push({
                buffer,
                timestamp: shot.timestamp,
                path: shot.path
            });
        }
    }
    return buffers;
}

/**
 * 检测2分钟历史是否存在时间断档
 * @param {Array<Object>} historySummaries - 历史2min总结（按时间升序）
 * @param {Date} currentEndTime - 当前窗口结束时间
 * @param {number} intervalMinutes - 粒度分钟数
 * @returns {Object|null} 断档信息
 */
function detectGap(historySummaries, currentEndTime, intervalMinutes = 2) {
    if (!historySummaries || historySummaries.length === 0) {
        return null;
    }

    const lastSummary = historySummaries[historySummaries.length - 1];
    if (!lastSummary.timestamp) {
        return null;
    }

    const lastTime = new Date(lastSummary.timestamp);
    if (Number.isNaN(lastTime.getTime())) {
        return null;
    }

    const diffMinutes = Math.round((currentEndTime.getTime() - lastTime.getTime()) / 60000);
    if (diffMinutes > intervalMinutes * 2) {
        return {
            gapMinutes: diffMinutes,
            lastSummaryTime: lastTime.toLocaleTimeString('zh-CN')
        };
    }

    return null;
}

/**
 * 解析 Gemini 响应文本
 * @param {string} responseText - 原始响应文本
 * @param {Logger} logger - 日志器
 * @returns {Object} 解析结果
 */
function parseResponse(responseText, logger) {
    try {
        let jsonStr = responseText.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1].trim();
        }
        return JSON.parse(jsonStr);
    } catch (err) {
        logger.warn(`响应解析为JSON失败，改为保存原始文本: ${err.message}`);
        return { raw_response: responseText };
    }
}

/**
 * 程序主流程
 */
async function main() {
    const repoRoot = path.resolve(__dirname, '..', '..');
    process.chdir(repoRoot);

    const args = parseArgs(process.argv);
    if (args.help) {
        showHelp();
        return;
    }

    const configPath = path.isAbsolute(args.config)
        ? args.config
        : path.resolve(repoRoot, args.config);

    const outputBaseDir = path.isAbsolute(args.outputDir)
        ? args.outputDir
        : path.resolve(repoRoot, args.outputDir);

    const config = args.legacy
        ? Config.load(configPath)
        : Config.loadUnified(configPath);

    const logger = new Logger({
        level: config.logging.level,
        file: null,
        console: true
    });

    logger.info(`[启动] 配置文件: ${configPath} (${args.legacy ? '独立模式' : '统一模式'})`);

    const screenshotReader = new ScreenshotReader(config.screenshot, logger);
    if (!fs.existsSync(screenshotReader.baseDirectory)) {
        throw new Error(`截图基础目录不存在: ${screenshotReader.baseDirectory}`);
    }
    logger.info(`[启动] 截图目录: ${screenshotReader.baseDirectory}`);

    const geminiClient = new GeminiClient(config.gemini, logger);
    logger.info(`[启动] Gemini模型: ${config.gemini.model}`);

    const promptBuilderOptions = {};
    if (args.todoDir) {
        promptBuilderOptions.todoDataDir = path.isAbsolute(args.todoDir)
            ? args.todoDir
            : path.resolve(repoRoot, args.todoDir);
        logger.info(`[启动] Todo目录: ${promptBuilderOptions.todoDataDir}`);
    }
    const promptBuilder = new PromptBuilder(geminiClient, logger, promptBuilderOptions);
    const screenshotComparer = new ScreenshotComparer(logger);

    const selectedWindow = selectTestWindow(screenshotReader, logger);
    const runId = `${selectedWindow.dateStr}_${formatFileTime(selectedWindow.endTime)}`;
    const runDir = path.join(outputBaseDir, runId);
    const promptDir = path.join(runDir, 'prompts');
    const rawDir = path.join(runDir, 'raw');

    ensureDir(outputBaseDir);
    ensureDir(runDir);
    ensureDir(promptDir);
    ensureDir(rawDir);

    const historyMinutes = (
        config.summary &&
        config.summary.granularity &&
        config.summary.granularity['2min'] &&
        config.summary.granularity['2min'].history_minutes
    ) || 0;
    const historyCount = Math.max(0, Math.ceil(historyMinutes / 2));

    const twoMinResults = [];
    const twoMinMeta = [];

    for (const segment of selectedWindow.segments) {
        const segmentLabel = `2min-${String(segment.index).padStart(2, '0')}`;
        logger.info(
            `[${segmentLabel}] 开始处理，时间: ${formatClock(segment.startTime)}-${formatClock(segment.endTime)}，` +
            `截图: ${segment.screenshots.length}`
        );

        const screenshotBuffers = readSegmentBuffers(segment, screenshotReader);
        if (screenshotBuffers.length === 0) {
            throw new Error(`[${segmentLabel}] 无可读取截图，无法继续测试`);
        }

        const history = historyCount > 0
            ? twoMinResults.slice(-historyCount)
            : [];
        const gapInfo = detectGap(history, segment.endTime, 2);

        let promptContents = [];
        let parsedRecord = null;
        let rawResponse = '';
        let usageMetadata = null;
        let skippedByNoChange = false;

        if (screenshotComparer.allIdentical(screenshotBuffers)) {
            parsedRecord = screenshotComparer.buildNoChange2minRecord(screenshotBuffers, '');
            skippedByNoChange = true;
            writeText(
                path.join(promptDir, `${segmentLabel}.txt`),
                `[截图无变化跳过]\n片段: ${segmentLabel}\n截图数: ${screenshotBuffers.length}`
            );
            writeText(path.join(rawDir, `${segmentLabel}.txt`), '[无原始响应：截图无变化，跳过API]');
        } else {
            promptContents = promptBuilder.build2min(
                screenshotBuffers,
                history,
                config.screenshot.format,
                gapInfo,
                ''
            );
            writeText(
                path.join(promptDir, `${segmentLabel}.txt`),
                serializeContents(promptContents, `${segmentLabel} Prompt`)
            );

            const generated = await geminiClient.generate(promptContents);
            rawResponse = generated.text;
            usageMetadata = generated.usageMetadata || null;
            parsedRecord = parseResponse(rawResponse, logger);

            writeText(path.join(rawDir, `${segmentLabel}.txt`), rawResponse);
        }

        const normalizedRecord = {
            timestamp: segment.endTime.toISOString(),
            granularity: '2min',
            ...parsedRecord
        };
        twoMinResults.push(normalizedRecord);
        writeJson(path.join(runDir, `${segmentLabel}.json`), normalizedRecord);

        twoMinMeta.push({
            segment: segmentLabel,
            start_time: segment.startTime.toISOString(),
            end_time: segment.endTime.toISOString(),
            screenshot_count: screenshotBuffers.length,
            skipped_by_no_change: skippedByNoChange,
            usage_metadata: usageMetadata,
            screenshot_files: segment.screenshots.map(s => s.path)
        });

        logger.info(`[${segmentLabel}] 完成`);
    }

    let tenMinParsed = null;
    let tenMinRaw = '';
    let tenMinUsage = null;
    let tenMinSkippedByNoChange = false;

    if (screenshotComparer.allNoChange(twoMinResults)) {
        tenMinParsed = screenshotComparer.buildNoChange10minRecord(twoMinResults);
        tenMinSkippedByNoChange = true;
        writeText(path.join(promptDir, '10min.txt'), '[全部2min子级无变化，跳过10min API调用]');
        writeText(path.join(rawDir, '10min.txt'), '[无原始响应：全部2min子级无变化，跳过API]');
    } else {
        const tenMinContents = promptBuilder.build10min(twoMinResults, [], '');
        writeText(
            path.join(promptDir, '10min.txt'),
            serializeContents(tenMinContents, '10min Prompt')
        );

        const generated10 = await geminiClient.generate(tenMinContents);
        tenMinRaw = generated10.text;
        tenMinUsage = generated10.usageMetadata || null;
        tenMinParsed = parseResponse(tenMinRaw, logger);

        writeText(path.join(rawDir, '10min.txt'), tenMinRaw);
    }

    const tenMinRecord = {
        timestamp: selectedWindow.endTime.toISOString(),
        granularity: '10min',
        ...tenMinParsed
    };

    writeJson(path.join(runDir, '10min.json'), tenMinRecord);
    writeJson(path.join(runDir, '2min-results.json'), twoMinResults);
    writeJson(path.join(runDir, 'window.json'), {
        source: selectedWindow.sourceLabel,
        source_date: selectedWindow.dateStr,
        start_time: selectedWindow.startTime.toISOString(),
        end_time: selectedWindow.endTime.toISOString(),
        segments: selectedWindow.segments.map(seg => ({
            index: seg.index,
            start_time: seg.startTime.toISOString(),
            end_time: seg.endTime.toISOString(),
            screenshot_count: seg.screenshots.length,
            screenshot_files: seg.screenshots.map(s => s.path)
        }))
    });

    writeJson(path.join(runDir, 'report.json'), {
        executed_at: new Date().toISOString(),
        config: {
            path: configPath,
            mode: args.legacy ? 'legacy' : 'unified',
            screenshot_directory: screenshotReader.baseDirectory,
            screenshot_format: config.screenshot.format,
            gemini_model: config.gemini.model
        },
        selected_data_source: {
            day: selectedWindow.sourceLabel,
            date: selectedWindow.dateStr
        },
        two_minute: {
            expected_segments: SEGMENT_COUNT,
            generated_segments: twoMinResults.length,
            details: twoMinMeta
        },
        ten_minute: {
            skipped_by_no_change: tenMinSkippedByNoChange,
            usage_metadata: tenMinUsage,
            result_file: path.join(runDir, '10min.json')
        }
    });

    logger.info(`[完成] 测试结果已输出: ${runDir}`);
    logger.close();
}

main().catch(err => {
    console.error(`[测试失败] ${err.message}`);
    process.exit(1);
});
