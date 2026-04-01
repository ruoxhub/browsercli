/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import { SkillRegistry } from './SkillRunner.js';
import { logger } from '../utils/logger.js';
/**
 * 构建默认环境代码
 */
function buildDefaultEnvCode() {
    return [
        'globalThis.window = globalThis;',
        'globalThis.self = globalThis;',
        'globalThis.global = globalThis;',
        'globalThis.document ??= {cookie: "", location: {href: ""}};',
        'globalThis.navigator ??= {userAgent: "js-reverse-mcp"};',
        'globalThis.location ??= {href: ""};',
        'globalThis.atob ??= (value) => Buffer.from(value, "base64").toString("utf8");',
        'globalThis.btoa ??= (value) => Buffer.from(value, "utf8").toString("base64");',
        'globalThis.crypto ??= {subtle: {}};',
    ].join('\n');
}
/**
 * 构建 localStorage/sessionStorage shim 代码
 */
function buildStorageShimCode(name, values) {
    var entries = Object.entries(values);
    return [
        "const ".concat(name, "Seed = new Map(").concat(JSON.stringify(entries), ");"),
        "globalThis.".concat(name, " = {"),
        '  getItem(key) { return this._store.has(key) ? this._store.get(key) : null; },',
        '  setItem(key, value) { this._store.set(String(key), String(value)); },',
        '  removeItem(key) { this._store.delete(String(key)); },',
        '  clear() { this._store.clear(); },',
        '  key(index) { return Array.from(this._store.keys())[index] ?? null; },',
        '  get length() { return this._store.size; },',
        "  _store: ".concat(name, "Seed,"),
        '};',
    ].join('\n');
}
/**
 * 构建自动环境代码
 */
function buildAutoEnvCode(capture) {
    var _a;
    var cookies = Array.isArray(capture.cookies) ? capture.cookies : [];
    var localStorageValues = capture.localStorage && typeof capture.localStorage === 'object'
        ? capture.localStorage
        : {};
    var sessionStorageValues = capture.sessionStorage && typeof capture.sessionStorage === 'object'
        ? capture.sessionStorage
        : {};
    var page = capture.page && typeof capture.page === 'object'
        ? capture.page
        : {};
    var cookieString = cookies
        .map(function (cookie) { var _a, _b; return "".concat(String((_a = cookie.name) !== null && _a !== void 0 ? _a : ''), "=").concat(String((_b = cookie.value) !== null && _b !== void 0 ? _b : '')); })
        .join('; ');
    return [
        buildDefaultEnvCode(),
        "globalThis.location = {href: ".concat(JSON.stringify(String((_a = page.url) !== null && _a !== void 0 ? _a : '')), "};"),
        "globalThis.document = {cookie: ".concat(JSON.stringify(cookieString), ", location: globalThis.location};"),
        buildStorageShimCode('localStorage', localStorageValues),
        buildStorageShimCode('sessionStorage', sessionStorageValues),
    ].join('\n\n');
}
/**
 * 构建入口代码
 */
function buildEntryCode(targetScript, capture) {
    return [
        'import "./env.js";',
        'import "./polyfills.js";',
        '',
        "const capture = ".concat(JSON.stringify(capture, null, 2), ";"),
        "capture.targetScript = ".concat(JSON.stringify(targetScript, null, 2), ";"),
        '',
        'if (capture.targetScript?.content) {',
        '  eval(capture.targetScript.content);',
        '}',
        '',
        'const targetFunction = capture.runtimeEvidence?.find((item) => typeof item.functionName === "string")?.functionName;',
        'if (targetFunction && typeof globalThis[targetFunction] === "function") {',
        '  console.log({targetFunction, result: globalThis[targetFunction]("token", "nonce")});',
        '} else {',
        '  console.log({message: "target function not callable yet", targetFunction});',
        '}',
    ].join('\n');
}
/**
 * 匹配目标文本
 */
function matchesTargetText(value, targetKeywords, targetUrlPatterns, targetFunctionNames, targetActionDescription) {
    var text = typeof value === 'string' ? value.toLowerCase() : JSON.stringify(value !== null && value !== void 0 ? value : '').toLowerCase();
    return (targetKeywords.some(function (keyword) { return text.includes(keyword.toLowerCase()); }) ||
        targetUrlPatterns.some(function (pattern) { return text.includes(pattern.toLowerCase()); }) ||
        targetFunctionNames.some(function (functionName) { return text.includes(functionName.toLowerCase()); }) ||
        (targetActionDescription.length > 0 && text.includes(targetActionDescription.toLowerCase())));
}
/**
 * 选择目标脚本
 */
function pickTargetScript(files, targetKeywords, targetUrlPatterns, targetFunctionNames, targetActionDescription) {
    var _a, _b, _c;
    if (targetKeywords.length === 0 &&
        targetUrlPatterns.length === 0 &&
        targetFunctionNames.length === 0 &&
        targetActionDescription.length === 0) {
        return (_a = files[0]) !== null && _a !== void 0 ? _a : null;
    }
    return (_c = (_b = files.find(function (file) {
        return matchesTargetText(file, targetKeywords, targetUrlPatterns, targetFunctionNames, targetActionDescription);
    })) !== null && _b !== void 0 ? _b : files[0]) !== null && _c !== void 0 ? _c : null;
}
/**
 * 过滤运行时证据
 */
function filterRuntimeEvidence(records, targetKeywords, targetUrlPatterns, targetFunctionNames, targetActionDescription, maxEvidenceItems) {
    var filtered = targetKeywords.length === 0 &&
        targetUrlPatterns.length === 0 &&
        targetFunctionNames.length === 0 &&
        targetActionDescription.length === 0
        ? records
        : records.filter(function (record) {
            return matchesTargetText(record, targetKeywords, targetUrlPatterns, targetFunctionNames, targetActionDescription);
        });
    return filtered.slice(0, maxEvidenceItems);
}
/**
 * 推断缺失的能力
 */
function inferMissingCapabilities(runtimeError, observedCapabilities) {
    var available = new Set(observedCapabilities.map(function (item) { return item.toLowerCase(); }));
    var normalizedError = runtimeError.toLowerCase();
    var candidates = [
        {
            capability: 'window',
            patterns: ['window is not defined'],
            reason: 'Browser global root is missing in local execution.',
            priority: 100,
        },
        {
            capability: 'document',
            patterns: ['document is not defined'],
            reason: 'DOM access is required by the captured browser path.',
            priority: 90,
        },
        {
            capability: 'localStorage',
            patterns: ['localstorage is not defined'],
            reason: 'Captured path reads browser storage values.',
            priority: 80,
        },
        {
            capability: 'sessionStorage',
            patterns: ['sessionstorage is not defined'],
            reason: 'Captured path reads session-scoped browser storage.',
            priority: 75,
        },
        {
            capability: 'crypto',
            patterns: ["reading 'subtle'", 'crypto is not defined'],
            reason: 'Captured path depends on browser crypto primitives.',
            priority: 85,
        },
    ];
    return candidates
        .filter(function (candidate) {
        return available.has(candidate.capability.toLowerCase()) &&
            candidate.patterns.some(function (pattern) { return normalizedError.includes(pattern); });
    })
        .sort(function (a, b) { return b.priority - a.priority; });
}
/**
 * 本地复现技能 - 构建本地 Node.js 复现环境
 */
function rebuildBundleSkill(context) {
    return __awaiter(this, void 0, void 0, function () {
        var options, runtimeEvidence, targetKeywords, targetUrlPatterns, targetFunctionNames, targetActionDescription, pageData, capture, envCode, polyfillsCode, targetScript, entryCode, result;
        var _a, _b, _c, _d, _e, _f, _g;
        return __generator(this, function (_h) {
            options = (context.options || {});
            logger.debug('[rebuild-bundle] Starting skill with options:', options);
            try {
                runtimeEvidence = [];
                if (options.taskId) {
                    logger.debug('[rebuild-bundle] Reading runtime evidence for task:', options.taskId);
                    // 在实际运行时会从 ReverseTaskStore 读取
                    // 这里返回空数组，由实际运行时填充
                }
                targetKeywords = (_a = options.targetKeywords) !== null && _a !== void 0 ? _a : [];
                targetUrlPatterns = (_b = options.targetUrlPatterns) !== null && _b !== void 0 ? _b : [];
                targetFunctionNames = (_c = options.targetFunctionNames) !== null && _c !== void 0 ? _c : [];
                targetActionDescription = (_d = options.goal) !== null && _d !== void 0 ? _d : '';
                logger.debug('[rebuild-bundle] Target filtering:', {
                    targetKeywords: targetKeywords,
                    targetUrlPatterns: targetUrlPatterns,
                    targetFunctionNames: targetFunctionNames,
                });
                pageData = {
                    url: (_f = (_e = context.url) !== null && _e !== void 0 ? _e : options.targetUrl) !== null && _f !== void 0 ? _f : '',
                    cookies: [],
                    localStorage: {},
                    sessionStorage: {},
                };
                capture = {
                    page: {
                        url: pageData.url,
                        title: '',
                    },
                    cookies: pageData.cookies,
                    localStorage: pageData.localStorage,
                    sessionStorage: pageData.sessionStorage,
                    runtimeEvidence: runtimeEvidence,
                    targetScript: null,
                };
                envCode = buildAutoEnvCode(capture);
                polyfillsCode = '';
                targetScript = pickTargetScript([], targetKeywords, targetUrlPatterns, targetFunctionNames, targetActionDescription);
                entryCode = buildEntryCode(targetScript, capture);
                result = {
                    url: (_g = context.url) !== null && _g !== void 0 ? _g : options.targetUrl,
                    bundlePath: '',
                    evidenceCount: runtimeEvidence.length,
                    files: {
                        entryCode: entryCode,
                        envCode: envCode,
                        polyfillsCode: polyfillsCode,
                        capture: capture,
                    },
                    targetContext: {
                        targetKeywords: targetKeywords,
                        targetUrlPatterns: targetUrlPatterns,
                        targetFunctionNames: targetFunctionNames,
                        targetActionDescription: targetActionDescription,
                    },
                };
                logger.info('[rebuild-bundle] Skill completed successfully');
                return [2 /*return*/, {
                        success: true,
                        message: '本地复现完成',
                        data: result,
                    }];
            }
            catch (error) {
                logger.error('[rebuild-bundle] Skill failed:', error);
                return [2 /*return*/, {
                        success: false,
                        error: error instanceof Error ? error.message : String(error),
                    }];
            }
            return [2 /*return*/];
        });
    });
}
/**
 * 获取技能定义并注册
 */
export function registerRebuildBundleSkill() {
    var registry = SkillRegistry.getInstance();
    registry.register({
        name: 'rebuild-bundle',
        description: '本地复现：构建 Node.js 环境复现目标代码，支持参数提取',
        category: 'rebuild',
        execute: rebuildBundleSkill,
    });
    logger.debug('[rebuild-bundle] Skill registered');
}
