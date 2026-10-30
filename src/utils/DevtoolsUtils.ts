/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type AggregatedIssue,
  Marked,
  MarkdownIssueDescription,
  I18n,
} from '../third_party/index.js';

import {ISSUE_UTILS} from './issue-descriptions.js';
import {logger} from './logger.js';

export function mapIssueToMessageObject(issue: AggregatedIssue) {
  const count = issue.getAggregatedIssuesCount();
  const markdownDescription = issue.getDescription() as unknown as {
    file?: string;
    substitutions?: Record<string, unknown>;
  } | null;
  const filename = markdownDescription?.file;
  if (!markdownDescription) {
    logger.debug(`no description found for issue:` + issue.code);
    return null;
  }
  const rawMarkdown = filename
    ? ISSUE_UTILS.getIssueDescription(filename)
    : null;
  if (!rawMarkdown) {
    logger.debug(`no markdown ${filename} found for issue:` + issue.code);
    return null;
  }
  let processedMarkdown: string;
  let title: string | null;

  try {
    processedMarkdown = MarkdownIssueDescription.substitutePlaceholders(
      rawMarkdown,
      markdownDescription.substitutions,
    );
    const markdownAst = Marked.Marked.lexer(processedMarkdown);
    title = MarkdownIssueDescription.findTitleFromMarkdownAst(markdownAst);
  } catch {
    logger.debug('error parsing markdown for issue ' + issue.code());
    return null;
  }
  if (!title) {
    logger.debug('cannot read issue title from ' + filename);
    return null;
  }
  return {
    type: 'issue',
    item: issue,
    message: title,
    count,
    description: processedMarkdown,
  };
}

I18n.DevToolsLocale.DevToolsLocale.instance({
  create: true,
  data: {
    navigatorLanguage: 'en-US',
    settingLanguage: 'en-US',
    lookupClosestDevToolsLocale: l => l,
  },
});
I18n.i18n.registerLocaleDataForTest('en-US', {});
