// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToHost, ToWebview, ViewCard, ViewColumn } from '../src/types';

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
          builtIn: true,
          collapsed: false,
          waitingCount: 0,
          cards: [
            {
              id: 's:aaaaaaaa',
              type: 'session',
              title: `poll ${n}`,
              cwd: '/w',
              folder: 'w',
              badge: { label: '运行中', tone: 'running' },
              detail: null,
              interactive: false,
              startedAt: null,
              canStop: true,
              canResume: false,
            },
          ],
        },
      ],
    },
  };
}

function sessionCard(id: string, over: Partial<ViewCard> = {}): ViewCard {
  return {
    id,
    type: 'session',
    title: id,
    cwd: '/w',
    folder: 'w',
    badge: { label: '运行中', tone: 'running' },
    detail: null,
    interactive: false,
    startedAt: null,
    canStop: true,
    canResume: false,
    ...over,
  };
}

function column(id: string, cards: ViewCard[], over: Partial<ViewColumn> = {}): ViewColumn {
  return { id, title: id, builtIn: false, collapsed: false, waitingCount: 0, cards, ...over };
}

function boardState(columns: ViewColumn[]): ToWebview {
  return { type: 'state', error: null, defaultCwd: '/w', view: { waitingCount: 0, columns } };
}

const buttonsOf = (cardId: string) =>
  [...document.querySelectorAll(`[data-card="${cardId}"] .card-actions button`)].map((b) => b.textContent);

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

describe('webview columns and card actions', () => {
  it('renders a collapsed column as a strip with its count, and toggles it on click', () => {
    post(boardState([column('inbox', [sessionCard('s:a')], { builtIn: true }), column('done', [sessionCard('s:b'), sessionCard('s:c')], { builtIn: true, collapsed: true, waitingCount: 1 })]));
    const strip = document.querySelector<HTMLElement>('[data-column="done"]')!;
    expect(strip.classList.contains('is-collapsed')).toBe(true);
    expect(strip.querySelectorAll('.card')).toHaveLength(0);
    expect(strip.querySelector('.count')?.textContent).toBe('2');
    expect(strip.querySelector('.waiting-dot')?.textContent).toBe('1');
    sent.length = 0;
    strip.click();
    expect(sent).toEqual([{ type: 'toggleColumn', columnId: 'done' }]);
  });

  it('expanded columns have a collapse button', () => {
    post(boardState([column('inbox', [], { builtIn: true })]));
    sent.length = 0;
    document.querySelector<HTMLButtonElement>('[data-column="inbox"] .collapse')!.click();
    expect(sent).toEqual([{ type: 'toggleColumn', columnId: 'inbox' }]);
  });

  it('offers 停止 and 完成 on a running session, 恢复 and 完成 on a stopped one, nothing to hide', () => {
    post(boardState([
      column('inbox', [
        sessionCard('s:run'),
        sessionCard('s:off', { canStop: false, canResume: true, badge: { label: '已中断', tone: 'failed' } }),
        sessionCard('s:term', { interactive: true, canStop: false }),
      ], { builtIn: true }),
      column('done', [sessionCard('s:fin', { canStop: false })], { builtIn: true }),
    ]));
    expect(buttonsOf('s:run')).toEqual(['停止', '完成']);
    expect(buttonsOf('s:off')).toEqual(['恢复', '完成']);
    expect(buttonsOf('s:term')).toEqual(['完成']);
    expect(buttonsOf('s:fin')).toEqual([]);
    expect(document.body.textContent).not.toContain('隐藏');
  });

  it('sends complete and resume for the clicked card', () => {
    post(boardState([column('inbox', [sessionCard('s:run'), sessionCard('s:off', { canStop: false, canResume: true })], { builtIn: true })]));
    sent.length = 0;
    const click = (cardId: string, label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>(`[data-card="${cardId}"] button`)].find((b) => b.textContent === label)!.click();
    click('s:run', '完成');
    click('s:off', '恢复');
    expect(sent).toEqual([{ type: 'complete', cardId: 's:run' }, { type: 'resume', cardId: 's:off' }]);
  });

  it('shows what a session is waiting for', () => {
    post(boardState([column('inbox', [sessionCard('s:w', { detail: 'input needed', badge: { label: '等待输入', tone: 'waiting' } })], { builtIn: true })]));
    expect(document.querySelector('[data-card="s:w"] .card-detail')?.textContent).toBe('input needed');
  });
});
