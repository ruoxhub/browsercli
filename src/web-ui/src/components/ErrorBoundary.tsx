/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {AlertTriangle, RefreshCw} from 'lucide-react';
import React, {Component, type ReactNode} from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {hasError: false, error: null, errorInfo: null};
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {hasError: true, error};
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({errorInfo});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[var(--color-bg-primary)] overflow-auto">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-3">
            <AlertTriangle size={22} />
          </div>
          <p className="text-sm font-semibold text-rose-400">
            {this.props.fallbackTitle || '页面渲染出错'}
          </p>
          <p className="text-xs text-[var(--color-text-muted)] max-w-lg mt-1 font-mono break-all">
            {this.state.error?.message}
          </p>
          {this.state.error?.stack && (
            <pre className="mt-4 p-4 rounded-xl bg-black/50 border border-[var(--color-border-default)] text-left text-[11px] font-mono text-rose-300 max-w-2xl max-h-60 overflow-auto whitespace-pre-wrap">
              {this.state.error.stack}
            </pre>
          )}
          <button
            onClick={() =>
              this.setState({hasError: false, error: null, errorInfo: null})
            }
            className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]"
          >
            <RefreshCw size={14} />
            <span>重试</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
