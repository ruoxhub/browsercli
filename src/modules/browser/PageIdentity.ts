import type {Page} from 'patchright';

export interface PageSelector {
  pageId?: string;
  pageIdx?: number;
  fallbackToSelected?: boolean;
}

export interface ResolvedPage {
  page: Page;
  pageId: string;
  pageIdx: number;
}
