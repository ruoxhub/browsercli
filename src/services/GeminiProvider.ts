/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';

import {
  decodeImageInput,
  formatProviderError,
  type FormattedProviderError,
} from './image-helpers.js';
import type {AIProvider, AIMessage, AIResponse, ChatOptions} from './AIService.js';

export interface GeminiConfig {
  apiKey?: string;
  cliPath?: string;
  useAPI?: boolean;
  model?: string;
}

const CLI_TIMEOUT_MS = 60_000;
const CLI_AVAILABILITY_TIMEOUT_MS = 1_500;

export class GeminiProvider implements AIProvider {
  private static readonly cliAvailabilityCache = new Map<string, boolean>();

  private readonly apiKey?: string;
  private readonly cliPath: string;
  private readonly useAPI: boolean;
  private readonly defaultModel: string;
  private cliAvailable?: boolean;

  constructor(config: GeminiConfig) {
    this.apiKey = config.apiKey;
    this.cliPath = config.cliPath || 'gemini-cli';
    this.defaultModel = config.model || 'gemini-2.0-flash-exp';
    // Fall back to CLI mode if API mode was requested but no key was provided.
    this.useAPI = (config.useAPI ?? !!config.apiKey) && !!this.apiKey;
  }

  chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    return this.useAPI
      ? this.chatAPI(messages, options)
      : this.chatCLI(messages, options);
  }

  analyzeImage(imageInput: string, prompt: string, isFilePath = false): Promise<string> {
    return this.useAPI
      ? this.analyzeImageAPI(imageInput, prompt, isFilePath)
      : this.analyzeImageCLI(imageInput, prompt, isFilePath);
  }

  private async chatAPI(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    if (!this.apiKey) {
      throw new Error('Gemini API key is required for API mode.');
    }

    const model = options?.model || this.defaultModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

    const systemMessage = messages.find(msg => msg.role === 'system');
    const contents = messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{text: msg.content}],
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens,
      },
    };

    if (systemMessage) {
      body.systemInstruction = {parts: [{text: systemMessage.content}]};
    }

    try {
      const data = await this.postJSON<GeminiChatResponse>(url, body);

      const candidate = data.candidates?.[0];
      const firstPart = candidate?.content?.parts?.[0];
      if (!candidate || !firstPart) {
        throw new Error('No response content from Gemini API');
      }

      return {
        content: firstPart.text || '',
        usage: data.usageMetadata
          ? {
              promptTokens: data.usageMetadata.promptTokenCount,
              completionTokens: data.usageMetadata.candidatesTokenCount,
              totalTokens: data.usageMetadata.totalTokenCount,
            }
          : undefined,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private async chatCLI(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    this.ensureCLIAvailable();
    const prompt = this.formatMessagesForCLI(messages);
    const response = await this.executeCLI(prompt, options);
    // CLI mode does not provide token usage.
    return {content: response};
  }

  private async analyzeImageAPI(
    imageInput: string,
    prompt: string,
    isFilePath: boolean,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Gemini API key is required for API mode.');
    }

    if (isFilePath && !existsSync(imageInput)) {
      throw new Error(`Image file not found: ${imageInput}`);
    }

    const {mediaType, data} = decodeImageInput(imageInput, isFilePath);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.defaultModel}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: [
        {
          parts: [
            {inlineData: {mimeType: mediaType, data}},
            {text: prompt},
          ],
        },
      ],
    };

    try {
      const response = await this.postJSON<GeminiChatResponse>(url, body);
      const firstPart = response.candidates?.[0]?.content?.parts?.[0];
      if (!firstPart) {
        throw new Error('No response content from Gemini API');
      }
      return firstPart.text || '';
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private async analyzeImageCLI(
    imageInput: string,
    prompt: string,
    isFilePath: boolean,
  ): Promise<string> {
    this.ensureCLIAvailable();
    if (!isFilePath) {
      throw new Error(
        'CLI mode requires image file paths. Please provide a file path or use API mode.',
      );
    }
    if (!existsSync(imageInput)) {
      throw new Error(`Image file not found: ${imageInput}`);
    }
    return this.executeCLI(prompt, undefined, imageInput);
  }

  private async postJSON<T>(url: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Gemini API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    return (await response.json()) as T;
  }

  private formatMessagesForCLI(messages: AIMessage[]): string {
    return messages
      .map(msg => {
        const label = msg.role === 'system'
          ? 'System'
          : msg.role === 'user'
            ? 'User'
            : 'Assistant';
        return `${label}: ${msg.content}`;
      })
      .join('\n\n');
  }

  private executeCLI(
    prompt: string,
    options?: ChatOptions,
    imagePath?: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = this.buildCLIArgs(prompt, options, imagePath);
      const child = spawn(this.cliPath, args, {stdio: ['pipe', 'pipe', 'pipe']});

      let settled = false;
      let stdout = '';
      let stderr = '';

      const settleResolve = (value: string): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve(value);
      };

      const settleReject = (reason: Error): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        reject(reason);
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        child.kill();
        settleReject(
          new Error(`gemini-cli execution timed out after ${CLI_TIMEOUT_MS / 1000} seconds`),
        );
      }, CLI_TIMEOUT_MS);

      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });

      child.once('error', error => {
        settleReject(new Error(`Failed to execute gemini-cli: ${error.message}`));
      });

      child.once('close', code => {
        if (code !== 0) {
          const detail = stderr ? `\nError: ${stderr}` : '';
          settleReject(new Error(`gemini-cli exited with code ${code}${detail}`));
          return;
        }
        settleResolve(this.parseCliOutput(stdout));
      });
    });
  }

  private buildCLIArgs(prompt: string, options?: ChatOptions, imagePath?: string): string[] {
    const args: string[] = [];

    const model = options?.model || this.defaultModel;
    if (model) args.push('--model', model);

    if (options?.temperature !== undefined) {
      args.push('--temperature', options.temperature.toString());
    }

    if (options?.maxTokens !== undefined) {
      args.push('--max-tokens', options.maxTokens.toString());
    }

    if (imagePath) args.push('--image', imagePath);

    args.push(prompt);
    return args;
  }

  private parseCliOutput(output: string): string {
    return output.trim();
  }

  private ensureCLIAvailable(): void {
    if (this.checkCLIAvailable()) return;
    throw new Error(
      'gemini-cli is not available. Please install it:\n' +
        '  npm install -g @google/generative-ai-cli\n' +
        'Or set GEMINI_API_KEY to use API mode.',
    );
  }

  private checkCLIAvailable(): boolean {
    if (this.cliAvailable !== undefined) {
      return this.cliAvailable;
    }

    const cached = GeminiProvider.cliAvailabilityCache.get(this.cliPath);
    if (cached !== undefined) {
      this.cliAvailable = cached;
      return cached;
    }

    const available = (() => {
      try {
        const result = spawnSync(this.cliPath, ['--version'], {
          stdio: 'pipe',
          timeout: CLI_AVAILABILITY_TIMEOUT_MS,
        });
        return result.status === 0;
      } catch {
        return false;
      }
    })();

    this.cliAvailable = available;
    GeminiProvider.cliAvailabilityCache.set(this.cliPath, available);
    return available;
  }

  private handleError(error: unknown): FormattedProviderError {
    return error instanceof Error
      ? (error as FormattedProviderError)
      : formatProviderError('Unknown error', error);
  }
}

interface GeminiChatResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{text?: string}>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}
