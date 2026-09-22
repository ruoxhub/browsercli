/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const require = createRequire(import.meta.url);

describe('ast-deobfuscation decodeObfuscator compatibility pass', () => {
  it('normalizes safe OB constructs without evaluating source code', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ast-deobfuscation-'));
    const inputPath = path.join(tempDir, 'input.js');
    const outputPath = path.join(tempDir, 'output.js');

    try {
      await writeFile(
        inputPath,
        String.raw`var _0xobj = { answer: 1 };
_0xobj["label"] = "\x6f\x6b";
while (!![]) console.log("\x68\x69", 1 + 2);`,
        'utf8',
      );

      await execFileAsync(process.execPath, [
        path.join(
          repoRoot,
          'skills/ast-deobfuscation/scripts/decode-obfuscator-pass.js',
        ),
        inputPath,
        outputPath,
      ]);

      const output = await readFile(outputPath, 'utf8');
      assert.match(output, /["']?label["']?\s*:\s*["']ok["']/);
      assert.doesNotMatch(output, /_0xobj\[["']label["']\]\s*=/);
      assert.match(output, /while \(true\) \{/);
      assert.match(output, /console\.log\(["']hi["'], 3\)/);
    } finally {
      await rm(tempDir, {recursive: true, force: true});
    }
  });

  it('wires the pass into OB pipelines and documents its safety boundary', async () => {
    const [pipelineConfig, skill] = await Promise.all([
      readFile(
        path.join(
          repoRoot,
          'skills/ast-deobfuscation/scripts/pipeline-config.js',
        ),
        'utf8',
      ),
      readFile(
        path.join(repoRoot, 'skills/ast-deobfuscation/SKILL.md'),
        'utf8',
      ),
    ]);

    assert.match(pipelineConfig, /decode-obfuscator-pass\.js/);
    assert.match(pipelineConfig, /decodeObfuscatorPass/);
    const {
      buildPipeline,
    } = require('../../../skills/ast-deobfuscation/scripts/pipeline-config.js');
    for (const patternId of ['cn-bidding-ob', 'mps-ob']) {
      assert.ok(
        buildPipeline(patternId).some(
          (step: {id: string}) => step.id === 'decode_obfuscator_pass',
        ),
        `missing decodeObfuscator pass in ${patternId}`,
      );
    }
    for (const patternId of ['generic', 'reese84', 'dingxiang']) {
      assert.ok(
        buildPipeline(patternId).every(
          (step: {id: string}) => step.id !== 'decode_obfuscator_pass',
        ),
        `unexpected decodeObfuscator pass in ${patternId}`,
      );
    }
    assert.match(skill, /decodeObfuscator/);
    assert.match(skill, /eval/);
  });

  it('keeps the deeply nested decodeObfuscator demo parseable', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ast-deobfuscation-'));
    const outputPath = path.join(tempDir, 'output.js');

    try {
      await execFileAsync(process.execPath, [
        path.join(
          repoRoot,
          'skills/ast-deobfuscation/scripts/decode-obfuscator-pass.js',
        ),
        path.join(repoRoot, 'open-source/decodeObfuscator-main/input/demo.js'),
        outputPath,
      ]);
      await execFileAsync(process.execPath, ['--check', outputPath]);
    } finally {
      await rm(tempDir, {recursive: true, force: true});
    }
  });

  it('references current browsercli tools for source collection and runtime verification', async () => {
    const [skill, browsercliReference] = await Promise.all([
      readFile(
        path.join(repoRoot, 'skills/ast-deobfuscation/SKILL.md'),
        'utf8',
      ),
      readFile(
        path.join(
          repoRoot,
          'skills/ast-deobfuscation/references/browsercli-tools.md',
        ),
        'utf8',
      ),
    ]);

    assert.match(skill, /references\/browsercli-tools\.md/);
    assert.match(skill, /browsercli/);
    for (const command of [
      'browsercli status',
      'browsercli call list_pages',
      'browsercli call list_scripts',
      'browsercli call search_in_sources --query',
      'browsercli call get_script_source --scriptId',
      '--filePath',
      'browsercli call list_targets',
      'browsercli call dump_target_scripts --targetId',
      'browsercli call hook_function --target',
      'browsercli call get_hook_data',
    ]) {
      assert.ok(
        browsercliReference.includes(command),
        `missing browsercli reference: ${command}`,
      );
    }
    assert.doesNotMatch(browsercliReference, /--prettyPrint|--offset/);
  });

  describe('ast-deobfuscation all-in-one deobfuscate.js script', () => {
    const deobfuscateScript = path.join(
      repoRoot,
      'skills/ast-deobfuscation/scripts/deobfuscate.js',
    );
    const {
      deobfuscate,
      unpack,
    } = require('../../../skills/ast-deobfuscation/scripts/deobfuscate.js');

    it('unpacks Dean Edwards Packer correctly', () => {
      const packed =
        "eval(function(p,a,c,k,e,r){e=String;if(!''.replace(/^/,String)){while(c--)r[c]=k[c]||c;k=[function(e){return r[e]}];e=function(){return'\\\\w+'};c=1};while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c]);return p}('0 1=\"2\";',3,3,'var|msg|hello'.split('|'),0,{}))";
      const unpacked = unpack(packed);
      assert.match(unpacked, /var\s+msg\s*=\s*["']hello["']/);
    });

    it('performs AST constant folding, dead code elimination, and string decoding', () => {
      const input = String.raw`
        var _0xstr = "\x68\x65\x6c\x6c\x6f";
        var _0xcalc = 1 + 2 * 3;
        var _0xbool = !0;
        if (false) {
          console.log("dead code");
        } else {
          console.log(_0xstr, _0xcalc, _0xbool);
        }
      `;
      const result = deobfuscate(input);
      assert.equal(result.success, true);
      assert.doesNotMatch(result.code, /dead code/);
      assert.match(result.code, /"hello"/);
      assert.match(result.code, /7/);
      assert.match(result.code, /true/);
    });

    it('flattens while-switch control flow state machines', () => {
      const input = String.raw`
        var _0xseq = "1|0|2".split("|");
        var _0xidx = 0;
        while (true) {
          switch (_0xseq[_0xidx++]) {
            case "0":
              stepB();
              break;
            case "1":
              stepA();
              break;
            case "2":
              stepC();
              break;
          }
        }
      `;
      const result = deobfuscate(input);
      assert.equal(result.success, true);
      assert.match(result.code, /stepA\(\);[\s\S]*stepB\(\);[\s\S]*stepC\(\);/);
    });

    it('runs as a standalone CLI executable', async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ast-deobf-cli-'));
      const inputPath = path.join(tempDir, 'input.js');
      const outputPath = path.join(tempDir, 'output.js');

      try {
        await writeFile(
          inputPath,
          'var a = 10 + 20; if (false) { drop(); } else { keep(a); }',
          'utf8',
        );

        await execFileAsync(process.execPath, [
          deobfuscateScript,
          inputPath,
          outputPath,
        ]);

        const output = await readFile(outputPath, 'utf8');
        assert.match(output, /var a = 30;/);
        assert.match(output, /keep\(a\);/);
        assert.doesNotMatch(output, /drop/);
      } finally {
        await rm(tempDir, {recursive: true, force: true});
      }
    });

    it('sub-modules (unpacker, ast-optimizer, control-flow, utils) work standalone', () => {
      const {
        detectAAEncode,
        unpackAAEncode,
        detectURLEncode,
        unpackURLEncode,
      } = require('../../../skills/ast-deobfuscation/scripts/deobfuscate/unpacker.js');
      const {
        parseCode,
        generateCode,
        isObfuscatorIdentifier,
      } = require('../../../skills/ast-deobfuscation/scripts/deobfuscate/utils.js');
      const {
        runOptimizationPass,
      } = require('../../../skills/ast-deobfuscation/scripts/deobfuscate/ast-optimizer.js');
      const {
        unflattenControlFlow,
      } = require('../../../skills/ast-deobfuscation/scripts/deobfuscate/control-flow.js');

      assert.equal(isObfuscatorIdentifier('_0x123abc'), true);
      assert.equal(isObfuscatorIdentifier('myVar'), false);
      assert.equal(detectAAEncode('console.log("o゜)")'), true);
      assert.equal(
        unpackAAEncode('console.log("normal")'),
        'console.log("normal")',
      );
      assert.equal(detectURLEncode('%20%21%22%23%24%25%26%27%28%29%2A'), true);
      assert.equal(
        unpackURLEncode('%68%65%6c%6c%6f%20%77%6f%72%6c%64%21%21%21'),
        'hello world!!!',
      );

      // Test ast-optimizer standalone
      const ast = parseCode('var x = 100 + 200; if (true) { live(); }');
      runOptimizationPass(ast);
      const optCode = generateCode(ast);
      assert.match(optCode, /var x = 300;/);
      assert.match(optCode, /live\(\);/);

      // Test control-flow standalone
      const cfAst = parseCode(
        'var _s = "0|1".split("|"); var _i = 0; while (true) { switch (_s[_i++]) { case "0": a(); break; case "1": b(); break; } }',
      );
      unflattenControlFlow(cfAst);
      const cfCode = generateCode(cfAst);
      assert.match(cfCode, /a\(\);[\s\S]*b\(\);/);
    });
  });

  describe('ast-deobfuscation newly integrated modular scripts', () => {
    it('strip-invisible-unicode decodes zero-width characters and String.fromCharCode', () => {
      const {
        stripInvisibleUnicode,
      } = require('../../../skills/ast-deobfuscation/scripts/strip-invisible-unicode.js');
      // 'H' in binary: 01001000 -> \u200B\u200C\u200B\u200B\u200C\u200B\u200B\u200B
      const encoded =
        'var msg = "\u200B\u200C\u200B\u200B\u200C\u200B\u200B\u200B"; var call = String.fromCharCode(104, 105);';
      const result = stripInvisibleUnicode(encoded);
      assert.equal(result.success, true);
      assert.match(result.code, /"H"/);
      assert.match(result.code, /"hi"/);
    });

    it('detect-obfuscator-types identifies multi-label obfuscation techniques', () => {
      const {
        detectObfuscationTypes,
      } = require('../../../skills/ast-deobfuscation/scripts/detect-obfuscator-types.js');
      const code = `
        var _0x1234 = ["hello"];
        while (true) { switch (_0x1234[0]) { case 0: break; } }
      `;
      const types = detectObfuscationTypes(code);
      assert.ok(types.includes('javascript-obfuscator'));
      assert.ok(types.includes('control-flow-flattening'));
    });

    it('prune-opaque-predicates eliminates algebraic and numeric dead branches', () => {
      const {
        pruneOpaquePredicates,
      } = require('../../../skills/ast-deobfuscation/scripts/prune-opaque-predicates.js');
      const code = `
        if (5 > 3) {
          live1();
        } else {
          dead1();
        }
        if (num * 0 === 0) {
          live2();
        }
      `;
      const result = pruneOpaquePredicates(code);
      assert.equal(result.success, true);
      assert.match(result.code, /live1\(\);/);
      assert.match(result.code, /live2\(\);/);
      assert.doesNotMatch(result.code, /dead1/);
    });

    it('sandbox-evaluator evaluates prelude statements safely in isolated VM', () => {
      const parser = require('@babel/parser');
      const {
        evaluatePrelude,
        evaluateExpression,
      } = require('../../../skills/ast-deobfuscation/scripts/sandbox-evaluator.js');
      const ast = parser.parse(
        'var table = ["foo", "bar"]; function dec(i) { return table[i]; }',
        {
          sourceType: 'unambiguous',
        },
      );
      const {sandbox, executedCount} = evaluatePrelude(ast);
      assert.equal(executedCount, 2);
      const evalRes = evaluateExpression('dec(1)', sandbox);
      assert.equal(evalRes.ok, true);
      assert.equal(evalRes.value, 'bar');
    });

    it('fold-wrappers inlines operator and dispatch helper methods', () => {
      const {
        foldWrappers,
      } = require('../../../skills/ast-deobfuscation/scripts/fold-wrappers.js');
      const code = `
        var _0xdispatcher = {
          add: function(a, b) { return a + b; },
          msg: "secret"
        };
        var r = _0xdispatcher.add(10, 20);
        var s = _0xdispatcher.msg;
      `;
      const result = foldWrappers(code);
      assert.equal(result.success, true);
      assert.match(result.code, /var r = 10 \+ 20;/);
      assert.match(result.code, /var s = "secret";/);
    });

    it('babelpack-enhancer-pass executes normalization and declarations pass', () => {
      const {
        runBabelPackPasses,
      } = require('../../../skills/ast-deobfuscation/scripts/babelpack-enhancer-pass.js');
      const code = `
        var a = 1, b = 2;
        var obj = {};
        obj["prop"] = "val";
      `;
      const result = runBabelPackPasses(code, {callExpress: false});
      assert.equal(result.success, true);
      assert.match(result.code, /var a = 1;[\s\S]*var b = 2;/);
      assert.match(result.code, /["']?prop["']?\s*:\s*["']val["']/);
    });

    it('unpack-webcrack unrolls webpack bundles into constituent modules', async () => {
      const {
        unpackWithWebcrack,
      } = require('../../../skills/ast-deobfuscation/scripts/unpack-webcrack.js');
      const webpackCode = `
        (function(modules) {
          return modules[0]();
        })([
          function() { console.log("module 0"); },
          function() { console.log("module 1"); }
        ]);
      `;
      const result = await unpackWithWebcrack(webpackCode);
      assert.equal(result.success, true);
      assert.ok(result.bundle.moduleCount >= 2);
    });

    it('deobfuscate-vm-protection analyzes VM patterns and opcodes', () => {
      const {
        detectVMProtection,
        analyzeVMStructure,
      } = require('../../../skills/ast-deobfuscation/scripts/deobfuscate-vm-protection.js');
      const vmCode = `
        var opcodes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
        var pc = 0;
        var stack = [];
        while (true) {
          switch (opcodes[pc++]) {
            case 1: stack.push(10); break;
            case 2: stack.pop(); break;
            case 3: break;
            case 4: break;
            case 5: break;
            case 6: break;
            case 7: break;
            case 8: break;
          }
        }
      `;
      const detection = detectVMProtection(vmCode);
      assert.equal(detection.detected, true);
      const structure = analyzeVMStructure(vmCode);
      assert.equal(structure.hasInterpreter, true);
      assert.equal(structure.hasStack, true);
    });

    it('deobfuscate-jsvmp identifies VM features and opcode classifications', () => {
      const {
        detectJSVMP,
        analyzeJSVMP,
      } = require('../../../skills/ast-deobfuscation/scripts/deobfuscate-jsvmp.js');
      const jsvmpCode = `
        var bc = [0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8, 0x9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15];
        var pc = 0;
        var stack = [];
        while (1) {
          switch (bc[pc++]) {
            case 0: stack.push(1); break;
            case 1: stack.pop(); break;
            case 2: fn.apply(null, []); break;
            case 3: break;
            case 4: break;
            case 5: break;
            case 6: break;
            case 7: break;
            case 8: break;
            case 9: break;
            case 10: break;
          }
        }
      `;
      const features = detectJSVMP(jsvmpCode);
      assert.ok(features);
      assert.equal(features.isJSVMP, true);
      const analysis = analyzeJSVMP(jsvmpCode);
      assert.equal(analysis.isJSVMP, true);
      assert.ok(analysis.instructionCount >= 10);
    });
  });
});
