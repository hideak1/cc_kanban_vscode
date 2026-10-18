// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToHost, ToWebview } from '../src/types';

const sent: ToHost[] = [];

function state(n: number): ToWebview {
  return {
    type: 'state',
    error: null,
    defaultCwd: '/w',
    view: {
      waitingCount: 0,
      columns: [
        {
          id: 'inbox',
          title: '未归类',
          removable: false,
          cards: [
            {
              id: 's:aaaaaaaa',
              type: 'session',
              title: `poll ${n}`,
              cwd: '/w',
              folder: 'w',
              badge: { label: '运行中', tone: 'running' },
              interactive: false,
              startedAt: null,
            },
          ],
        },
      ],
    },
  };
}

function post(m: ToWebview): void {
  window.dispatchEvent(new MessageEvent('message', { data: m }));
}

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  (globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
    postMessage: (m: ToHost) => sent.push(m),
  });
  await import('../src/webview/main');
});

describe('webview composer', () => {
  it('keeps focus and typed text in the new-task form while polls re-render the board', () => {
    post(state(1));
    const open = [...document.querySelectorAll('button')].find((b) => b.textContent === '新建 Task')!;
    open.click();
    const title = document.querySelector<HTMLInputElement>('#composer-title')!;
    title.focus();
    title.value = '修复登录';
    expect(document.activeElement).toBe(title);

    post(state(2));
    post(state(3));

    expect(document.activeElement).toBe(title);
    expect(document.querySelector<HTMLInputElement>('#composer-title')?.value).toBe('修复登录');
    expect(document.querySelector('.card-title')?.textContent).toBe('poll 3');
  });
});
