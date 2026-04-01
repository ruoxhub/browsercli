/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 日志工具
 */
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import chalk from 'chalk';
import { safeStringify } from './safeJson.js';
var Logger = /** @class */ (function () {
    function Logger(level) {
        if (level === void 0) { level = 'info'; }
        this.level = level;
    }
    Logger.prototype.shouldLog = function (level) {
        return Logger.LEVELS.indexOf(level) >= Logger.LEVELS.indexOf(this.level);
    };
    Logger.prototype.formatMessage = function (level, message) {
        var args = [];
        for (var _i = 2; _i < arguments.length; _i++) {
            args[_i - 2] = arguments[_i];
        }
        var timestamp = new Date().toISOString();
        var prefix = "[".concat(timestamp, "] [").concat(level.toUpperCase(), "]");
        // ✅ 修复：使用 safeStringify 处理循环引用和特殊对象
        var formattedArgs = args.length > 0 ? ' ' + safeStringify(args) : '';
        return "".concat(prefix, " ").concat(message).concat(formattedArgs);
    };
    Logger.prototype.debug = function (message) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        if (this.shouldLog('debug')) {
            // 使用 stderr 避免干扰 MCP 的 stdout 通信
            console.error(chalk.gray(this.formatMessage.apply(this, __spreadArray(['debug', message], args, false))));
        }
    };
    Logger.prototype.info = function (message) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        if (this.shouldLog('info')) {
            // 使用 stderr 避免干扰 MCP 的 stdout 通信
            console.error(chalk.blue(this.formatMessage.apply(this, __spreadArray(['info', message], args, false))));
        }
    };
    Logger.prototype.warn = function (message) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        if (this.shouldLog('warn')) {
            console.error(chalk.yellow(this.formatMessage.apply(this, __spreadArray(['warn', message], args, false))));
        }
    };
    Logger.prototype.error = function (message) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        if (this.shouldLog('error')) {
            console.error(chalk.red(this.formatMessage.apply(this, __spreadArray(['error', message], args, false))));
        }
    };
    Logger.prototype.success = function (message) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        if (this.shouldLog('info')) {
            // 使用 stderr 避免干扰 MCP 的 stdout 通信
            console.error(chalk.green(this.formatMessage.apply(this, __spreadArray(['info', message], args, false))));
        }
    };
    Logger.prototype.setLevel = function (level) {
        this.level = level;
    };
    // ✅ 修复：性能优化 - 使用静态常量避免重复创建数组
    Logger.LEVELS = ['debug', 'info', 'warn', 'error'];
    return Logger;
}());
// ✅ 修复：安全的环境变量解析
function parseLogLevel(value) {
    var validLevels = ['debug', 'info', 'warn', 'error'];
    if (value && validLevels.includes(value)) {
        return value;
    }
    return 'info';
}
// 导出单例
export var logger = new Logger(parseLogLevel(process.env.LOG_LEVEL));
