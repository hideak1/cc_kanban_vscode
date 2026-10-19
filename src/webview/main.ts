import type { ToHost, ToWebview, View, ViewCard, ViewColumn } from '../types';
import { dropIndex, formatAge, summary } from './format';

declare function acquireVsCodeApi(): { postMessage(m: ToHost): void };
const vscode = acquireVsCodeApi();
const send = (m: ToHost) => vscode.postMessage(m);

type State = Extract<ToWebview, { type: 'state' }>;

let latest: State | null = null;
let pending = false;
let dragging: { cardId: string } | null = null;
let composerOpen = false;
let composerCwd = '';
let addingColumn = false;
let renaming: string | null = null;

const app = document.getElementById('app')!;
const toolbarSlot = document.createElement('div');
const bannerSlot = document.createElement('div');
const composerSlot = document.createElement('div');
const boardEl = document.createElement('main');
for (const slot of [toolbarSlot, bannerSlot, composerSlot]) slot.className = 'slot';
boardEl.className = 'board';
app.replaceChildren(toolbarSlot, bannerSlot, composerSlot, boardEl);

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

function button(label: string, onClick: (e: MouseEvent) => void, cls = 'btn'): HTMLButtonElement {
  const b = h('button', { class: cls, type: 'button', text: label });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return b;
}

/* ---------- toolbar & composer ---------- */

function toolbar(view: View): HTMLElement {
  const tones = view.columns.flatMap((c) => c.cards.map((x) => x.badge?.tone ?? ''));
  return h(
    'header',
    { class: 'toolbar' },
    h('p', { class: 'summary', text: summary(tones) }),
    h(
      'div',
      { class: 'toolbar-actions' },
      button('New task', () => {
        composerOpen = true;
        render();
        document.querySelector<HTMLInputElement>('#composer-title')?.focus();
      }, 'btn btn-primary'),
      button('New column', () => {
        addingColumn = true;
        render();
        document.querySelector<HTMLInputElement>('#new-column')?.focus();
      }),
    ),
  );
}

function composer(defaultCwd: string): HTMLElement {
  const cwd = composerCwd || defaultCwd;
  const title = h('input', { id: 'composer-title', class: 'input', placeholder: 'What should Claude do? e.g. Fix the login redirect' });
  const prompt = h('textarea', {
    class: 'input',
    rows: '4',
    placeholder: 'Instructions for Claude. Leave empty to use the title.',
  });
  const submit = () => {
    if (!title.value.trim()) {
      title.focus();
      return;
    }
    send({ type: 'createDraft', title: title.value, prompt: prompt.value, cwd: composerCwd || latest?.defaultCwd || cwd });
    composerOpen = false;
    composerCwd = '';
    render();
  };
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') closeComposer();
  });
  prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
    if (e.key === 'Escape') closeComposer();
  });
  return h(
    'section',
    { class: 'composer', 'aria-label': 'New task' },
    title,
    prompt,
    h(
      'div',
      { class: 'composer-row' },
      h('span', { class: 'composer-cwd', title: cwd, text: `Runs in ${cwd}` }),
      button('Change folder', () => send({ type: 'pickCwd' }), 'btn btn-link'),
      h('span', { class: 'spacer' }),
      button('Cancel', closeComposer),
      button('Create', submit, 'btn btn-primary'),
    ),
  );
}

function closeComposer(): void {
  composerOpen = false;
  composerCwd = '';
  render();
}

/* ---------- board ---------- */

function card(c: ViewCard, now: number, inDone: boolean): HTMLElement {
  const tone = c.badge?.tone ?? 'draft';
  const el = h('article', {
    class: `card tone-${tone}`,
    draggable: 'true',
    tabindex: '0',
    'data-card': c.id,
    title: c.type === 'session' && !c.interactive ? 'Click to open this session in a terminal' : '',
  });

  const meta = h(
    'div',
    { class: 'card-meta' },
    c.badge ? h('span', { class: 'status', text: c.badge.label }) : h('span', { class: 'status', text: 'Draft' }),
    h('span', { class: 'folder', title: c.cwd, text: c.folder }),
    c.interactive ? h('span', { class: 'tag', text: 'Terminal' }) : null,
    h('span', { class: 'age', text: formatAge(c.startedAt, now) }),
  );

  const actions = h('div', { class: 'card-actions' });
  if (c.type === 'draft') {
    const draftId = c.id.slice(2);
    actions.append(
      button('Start', () => send({ type: 'startDraft', draftId }), 'btn btn-primary btn-small'),
      button('Delete', () => send({ type: 'deleteDraft', draftId }), 'btn btn-small'),
    );
  } else {
    if (c.canResume) actions.append(button('Resume', () => send({ type: 'resume', cardId: c.id }), 'btn btn-primary btn-small'));
    if (c.canStop) actions.append(button('Stop', () => send({ type: 'stop', cardId: c.id }), 'btn btn-small'));
    if (!inDone) actions.append(button('Complete', () => send({ type: 'complete', cardId: c.id }), 'btn btn-small'));
  }

  el.append(h('h3', { class: 'card-title', text: c.title }));
  if (c.detail) el.append(h('p', { class: 'card-detail', text: c.detail }));
  if (c.prompt && c.prompt.trim() && c.prompt.trim() !== c.title) {
    el.append(h('p', { class: 'card-prompt', text: c.prompt }));
  }
  el.append(meta, actions);

  const open = () => {
    if (c.type === 'session') send({ type: 'attach', cardId: c.id });
  };
  el.addEventListener('click', open);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === el) open();
  });
  el.addEventListener('dragstart', (e) => {
    dragging = { cardId: c.id };
    e.dataTransfer?.setData('text/plain', c.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => el.classList.add('is-dragging'));
  });
  el.addEventListener('dragend', () => {
    dragging = null;
    clearMarkers();
    if (pending) render();
    else el.classList.remove('is-dragging');
  });
  return el;
}

function clearMarkers(): void {
  document.querySelectorAll('.drop-marker').forEach((m) => m.remove());
  document.querySelectorAll('.column.is-target').forEach((c) => c.classList.remove('is-target'));
}

function slotFor(list: HTMLElement, y: number): number {
  const cards = [...list.querySelectorAll<HTMLElement>('.card:not(.is-dragging)')];
  return dropIndex(cards.map((c) => {
    const r = c.getBoundingClientRect();
    return r.top + r.height / 2;
  }), y);
}

function columnHeader(col: ViewColumn): HTMLElement {
  const header = h('header', { class: 'column-header' });
  if (renaming === col.id) {
    const input = h('input', { class: 'input input-inline', value: col.title, 'aria-label': 'Column name' });
    const done = (save: boolean) => {
      if (renaming !== col.id) return;
      renaming = null;
      if (save) send({ type: 'renameColumn', columnId: col.id, title: input.value });
      render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true));
    header.append(input);
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return header;
  }
  const title = h('h2', { class: 'column-title', text: col.title });
  if (!col.builtIn) {
    title.title = 'Double-click to rename';
    title.addEventListener('dblclick', () => {
      renaming = col.id;
      render();
    });
  }
  const collapse = button('⌄', () => send({ type: 'toggleColumn', columnId: col.id }), 'btn btn-icon collapse');
  collapse.title = 'Collapse column';
  collapse.setAttribute('aria-label', `Collapse "${col.title}"`);
  header.append(collapse, title, h('span', { class: 'count', text: String(col.cards.length) }));
  if (!col.builtIn) {
    header.append(button('Delete column', () => send({ type: 'deleteColumn', columnId: col.id }), 'btn btn-icon btn-delete'));
  }
  return header;
}

function dropTarget(el: HTMLElement, columnId: string, indexAt: (y: number) => number, mark: (y: number) => void): void {
  el.addEventListener('dragover', (e) => {
    if (!dragging) return;
    e.preventDefault();
    clearMarkers();
    el.classList.add('is-target');
    mark(e.clientY);
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget as Node | null)) {
      el.classList.remove('is-target');
      el.querySelectorAll('.drop-marker').forEach((m) => m.remove());
    }
  });
  el.addEventListener('drop', (e) => {
    if (!dragging) return;
    e.preventDefault();
    send({ type: 'move', cardId: dragging.cardId, toColumnId: columnId, index: indexAt(e.clientY) });
    clearMarkers();
  });
}

function collapsedColumn(col: ViewColumn): HTMLElement {
  const el = h(
    'section',
    {
      class: 'column is-collapsed',
      'data-column': col.id,
      role: 'button',
      tabindex: '0',
      title: `Expand "${col.title}"`,
      'aria-label': `Expand "${col.title}", ${col.cards.length} card${col.cards.length === 1 ? '' : 's'}`,
    },
    h('span', { class: 'count', text: String(col.cards.length) }),
    col.waitingCount > 0 ? h('span', { class: 'waiting-dot', title: 'Needs input', text: String(col.waitingCount) }) : null,
    h('h2', { class: 'column-title', text: col.title }),
  );
  const toggle = () => send({ type: 'toggleColumn', columnId: col.id });
  el.addEventListener('click', toggle);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
  // Dropping onto a collapsed column puts the card on top, where it will be seen first when expanded.
  dropTarget(el, col.id, () => 0, () => {});
  return el;
}

function column(col: ViewColumn, now: number): HTMLElement {
  if (col.collapsed) return collapsedColumn(col);
  const list = h('div', { class: 'card-list' });
  for (const c of col.cards) list.append(card(c, now, col.id === 'done'));
  if (col.cards.length === 0) {
    const hint = col.id === 'inbox' ? 'New sessions appear here first' : col.id === 'done' ? 'Click Complete on a card, or drag cards here' : 'Drag cards here';
    list.append(h('p', { class: 'empty', text: hint }));
  }

  const el = h('section', { class: 'column', 'data-column': col.id }, columnHeader(col), list);
  dropTarget(
    el,
    col.id,
    (y) => slotFor(list, y),
    (y) => {
      const slot = slotFor(list, y);
      const cards = [...list.querySelectorAll<HTMLElement>('.card:not(.is-dragging)')];
      const marker = h('div', { class: 'drop-marker' });
      if (slot < cards.length) list.insertBefore(marker, cards[slot]!);
      else list.append(marker);
    },
  );
  return el;
}

function newColumnForm(): HTMLElement {
  const input = h('input', { id: 'new-column', class: 'input', placeholder: 'Column name, e.g. In progress' });
  const done = (save: boolean) => {
    if (!addingColumn) return;
    addingColumn = false;
    if (save && input.value.trim()) send({ type: 'addColumn', title: input.value });
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => done(true));
  return h('section', { class: 'column column-new' }, input);
}

/* ---------- render loop ---------- */

function isEditing(): boolean {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && !!a.closest('.board');
}

function render(): void {
  if (!latest) return;
  if (dragging || isEditing()) {
    pending = true;
    return;
  }
  pending = false;
  const { view, error, defaultCwd } = latest;
  const now = Date.now();

  toolbarSlot.replaceChildren(toolbar(view));
  bannerSlot.replaceChildren(...(error ? [h('div', { class: 'banner', role: 'alert', text: error })] : []));
  // The composer node is never re-parented while open, so focus and IME input survive every poll.
  if (!composerOpen) composerSlot.replaceChildren();
  else if (!composerSlot.firstChild) composerSlot.replaceChildren(composer(defaultCwd));

  const columns: Node[] = view.columns.map((col) => column(col, now));
  if (addingColumn) columns.push(newColumnForm());
  boardEl.replaceChildren(...columns);
}

window.addEventListener('message', (e: MessageEvent<ToWebview>) => {
  const m = e.data;
  if (m.type === 'state') {
    latest = m;
    render();
  } else if (m.type === 'cwdPicked') {
    composerCwd = m.cwd;
    const el = document.querySelector<HTMLElement>('.composer-cwd');
    if (el) {
      el.textContent = `Runs in ${m.cwd}`;
      el.title = m.cwd;
    }
  }
});

document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (pending && !isEditing()) render();
  });
});

send({ type: 'ready' });
