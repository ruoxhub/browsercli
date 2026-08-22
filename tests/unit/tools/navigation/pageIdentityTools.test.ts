import assert from 'node:assert';
import {describe, it} from 'node:test';

import {listPages} from '../../../../src/tools/navigation/listPages.js';
import {selectPage} from '../../../../src/tools/navigation/selectPage.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

describe('page identity navigation tools', () => {
  it('lists stable IDs alongside indexes', async () => {
    const page = {url: () => 'https://example.test', title: async () => 'test'};
    const response = new ToolResponseAccumulator();
    await listPages.handler({params: {}}, response, {
      getPages: () => [page],
      getSelectedPage: () => page,
      getPageId: () => 'page-7',
    } as never);
    const data = (response.toJSON().structuredContent as any).data;
    assert.equal(data.pageInfos[0].index, 0);
    assert.equal(data.pageInfos[0].pageId, 'page-7');
    assert.equal(data.selectedPageId, 'page-7');
  });

  it('rejects conflicting selectors before page side effects', async () => {
    let sideEffects = 0;
    const response = new ToolResponseAccumulator();
    await assert.rejects(
      selectPage.handler({params: {pageId: 'page-1', pageIdx: 1}}, response, {
        resolvePage: () => {
          throw new Error('pageId page-1 与 pageIdx 1 指向不同页面');
        },
        bringPageToFront: async () => {
          sideEffects += 1;
        },
        selectPage: () => {
          sideEffects += 1;
        },
      } as never),
      /指向不同页面/,
    );
    assert.equal(sideEffects, 0);
  });

  it('requires at least one selector', async () => {
    const response = new ToolResponseAccumulator();
    await assert.rejects(
      selectPage.handler({params: {}}, response, {} as never),
      /pageId 或 pageIdx/,
    );
  });
});
