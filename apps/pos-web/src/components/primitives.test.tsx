import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import tokens from '../styles/tokens.css?raw';
import primitives from '../styles/primitives.css?raw';
import { ScreenFrame } from './ScreenFrame';
import { ContextPill, type OrderContext } from './ContextPill';
import { TableGrid } from './TableGrid';
import { ConfirmSheet } from './ConfirmSheet';
import { StatusColumns } from './StatusColumns';
import { ThemeChoice, kitchenThemeClass } from './ThemeChoice';
import {
  MAX_DEPTH, MAX_FLOW_SCREENS, STAFF_FLOWS, STAFF_SCREENS, contrastRatio, darkThemeAllowed, needsConfirm, tableGridColumns,
} from '../design/rules';


function tokenValue(name: string, block = ':root'): string {
  const start = tokens.indexOf(`${block} {`);
  const body = tokens.slice(start, tokens.indexOf('}', start));
  const m = body.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!m) throw new Error(`token ${name} missing in ${block}`);
  return m[1];
}
const px = (name: string) => Number(tokens.match(new RegExp(`--${name}:\\s*(\\d+)px`))?.[1]);

describe('ScreenFrame (REQ-005, REQ-088)', () => {
  it('REQ-088: HOME is always present and reaches the dashboard in one tap', () => {
    const onHome = vi.fn();
    render(<ScreenFrame title="Tables" onBack={() => {}} onHome={onHome}>{null}</ScreenFrame>);
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '← Back' })).toBeInTheDocument();
  });

  it('REQ-005: the screen has exactly one pinned primary action', () => {
    render(
      <ScreenFrame title="Choose food" onHome={() => {}} primaryAction={<button className="btn btn--primary">Send</button>}>
        <p>long cart</p>
      </ScreenFrame>,
    );
    const pinned = screen.getByTestId('pinned-action');
    expect(document.querySelectorAll('.btn--primary')).toHaveLength(1);
    expect(within(pinned).getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(primitives).toMatch(/\.pinned-action \{\s*position: fixed;[^}]*bottom: 0;/);
  });

  it('REQ-093: the context pill sits in the sticky header, not in the scrolling body', () => {
    render(
      <ScreenFrame title="Choose food" onHome={() => {}} context={<ContextPill context={{ kind: 'table', table: '5' }} />}>
        <div>cart expanded</div>
      </ScreenFrame>,
    );
    expect(screen.getByRole('banner')).toContainElement(screen.getByTestId('context-pill'));
    expect(primitives).toMatch(/\.screen__header \{\s*position: sticky; top: 0;/);
  });
});

describe('ContextPill (REQ-093)', () => {
  it('REQ-093: switching from Table 5 to Token T-012 updates the pill in the same render', () => {
    const table: OrderContext = { kind: 'table', table: '5' };
    const { rerender } = render(<ContextPill context={table} />);
    expect(screen.getByTestId('context-pill')).toHaveTextContent('Table 5');
    rerender(<ContextPill context={{ kind: 'token', token: 'T-012' }} />);
    expect(screen.getByTestId('context-pill')).toHaveTextContent('Token T-012');
    expect(screen.getByTestId('context-pill')).toHaveClass('context-pill--token');
  });
});

describe('Table grid (REQ-013, REQ-085, REQ-086)', () => {
  const tables = [
    { id: '1', number: '01', status: 'AVAILABLE' as const, seats: 4 },
    { id: '2', number: '02', status: 'OCCUPIED' as const, amount: '460', minutesOpen: 18 },
    { id: '3', number: '03', status: 'READY_TO_CLOSE' as const, amount: '620', minutesOpen: 32 },
  ];

  it('REQ-086: every status is told apart by icon and word, not colour alone', () => {
    render(<TableGrid tables={tables} onOpen={() => {}} />);
    const labels = ['Available', 'Occupied', 'Ready to close'].map((w) => screen.getByText(w).parentElement!);
    const icons = labels.map((l) => l.querySelector('.status-label__icon')!.textContent);
    expect(new Set(icons).size).toBe(3);
    expect(icons.every((i) => i && i.trim().length > 0)).toBe(true);
  });

  it('REQ-085: table numbers use the 40 px bold class', () => {
    render(<TableGrid tables={tables} onOpen={() => {}} />);
    expect(screen.getByText('01')).toHaveClass('text-table-number');
    expect(px('text-table-number')).toBeGreaterThanOrEqual(40);
    expect(primitives).toMatch(/\.text-table-number \{[^}]*font-weight: 700/);
  });

  it('REQ-013: the grid switches from 2 to 4 columns between 767 and 768 px', () => {
    expect(tableGridColumns(360)).toBe(2);
    expect(tableGridColumns(767)).toBe(2);
    expect(tableGridColumns(768)).toBe(4);
    expect(primitives).toMatch(/@media \(min-width: 768px\) \{\s*\.table-grid \{ grid-template-columns: repeat\(4,/);
    expect(primitives).toMatch(/\.table-grid \{[^}]*repeat\(2,/);
  });

  it('REQ-084: a tap opens the table', () => {
    const onOpen = vi.fn();
    render(<TableGrid tables={tables} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table 02, Occupied' }));
    expect(onOpen).toHaveBeenCalledWith(tables[1]);
  });
});

describe('Type, targets and contrast tokens (REQ-084, REQ-085, REQ-086, REQ-092)', () => {
  it('REQ-084: targets are at least 56 px, primary actions 64 px, gaps 12 px', () => {
    expect(px('target-min')).toBeGreaterThanOrEqual(56);
    expect(px('bottom-action')).toBe(64);
    expect(px('gap-tap')).toBeGreaterThanOrEqual(12);
  });

  it('REQ-085: body 18, item 20, price 24 px', () => {
    expect(px('text-body')).toBeGreaterThanOrEqual(18);
    expect(px('text-item')).toBeGreaterThanOrEqual(20);
    expect(px('text-price')).toBeGreaterThanOrEqual(24);
  });

  it('REQ-086: price/total text meets 7:1 on every card background', () => {
    for (const bg of ['color-surface', 'color-bg', 'color-success-bg', 'color-danger-bg', 'color-warning-bg']) {
      expect(contrastRatio(tokenValue('color-text'), tokenValue(bg))).toBeGreaterThanOrEqual(7);
    }
  });

  it('REQ-092: the palette keeps the defined colours', () => {
    expect(tokenValue('color-success')).toBe('#15803d');
    expect(tokenValue('color-danger')).toBe('#b91c1c');
    expect(tokenValue('color-warning')).toBe('#c2410c');
    expect(tokenValue('color-info')).toBe('#1d4ed8');
    expect(tokenValue('color-amber')).toBe('#a16207');
  });

  it('REQ-092: in the kitchen dark theme status text is at least 4.5:1', () => {
    const block = '.theme-kitchen-dark';
    for (const [fg, bg] of [
      ['color-info', 'color-info-bg'], ['color-amber', 'color-amber-bg'], ['color-success', 'color-success-bg'],
      ['color-danger', 'color-danger-bg'], ['color-text', 'color-surface'], ['color-text-muted', 'color-surface'],
    ]) {
      expect(contrastRatio(tokenValue(fg, block), tokenValue(bg, block))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('ConfirmSheet (REQ-090, REQ-091)', () => {
  it('REQ-090: NO is on the left, YES on the right, and NO sends nothing', () => {
    const sendKot = vi.fn();
    const onNo = vi.fn();
    render(<ConfirmSheet open title="Send to Kitchen?" onYes={sendKot} onNo={onNo} />);
    const buttons = within(screen.getByRole('dialog')).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['NO', 'YES']);
    fireEvent.click(screen.getByRole('button', { name: 'NO' }));
    expect(onNo).toHaveBeenCalled();
    expect(sendKot).not.toHaveBeenCalled();
  });

  it('REQ-090: only send, payment and cancel ask for confirmation; adding an item does not', () => {
    expect(needsConfirm('sendToKitchen')).toBe(true);
    expect(needsConfirm('pay')).toBe(true);
    expect(needsConfirm('cancelItem')).toBe(true);
    expect(needsConfirm('addItem')).toBe(false);
  });

  it('REQ-091: with reduced motion the sheet has no slide animation; press feedback is 150 ms', () => {
    expect(primitives).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.sheet \{ animation: none; \}/);
    expect(tokens).toMatch(/--motion-press: 150ms/);
    expect(tokens).toMatch(/--motion-sheet: 150ms/);
  });
});

describe('Kitchen layout and dark theme (REQ-091, REQ-092)', () => {
  it('REQ-091: NEW, PREPARING and READY are three side-by-side columns on a landscape tablet', () => {
    render(<StatusColumns columns={[{ status: 'NEW', count: 2 }, { status: 'PREPARING', count: 1 }, { status: 'READY', count: 0 }]} />);
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['New', 'Preparing', 'Ready']);
    expect(primitives).toMatch(/@media \(min-width: 768px\) and \(orientation: landscape\)[^{]*\{\s*\.status-columns \{ grid-template-columns: repeat\(3,/);
  });

  it('REQ-092: a cashier phone is offered no dark theme', () => {
    const { container } = render(<ThemeChoice deviceRole="CASHIER" dark={false} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    expect(darkThemeAllowed('ADMIN')).toBe(false);
    expect(kitchenThemeClass('CASHIER', true)).toBe('');
  });

  it('REQ-092: the kitchen tablet can switch to the dark screen', () => {
    const onChange = vi.fn();
    render(<ThemeChoice deviceRole="KITCHEN" dark={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dark screen' }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(kitchenThemeClass('KITCHEN', true)).toBe('theme-kitchen-dark');
  });
});

describe('Shallow navigation (REQ-088)', () => {
  it('REQ-088: no staff screen is deeper than 2 levels', () => {
    for (const s of Object.values(STAFF_SCREENS)) expect(s.depth).toBeLessThanOrEqual(MAX_DEPTH);
  });

  it('REQ-088: every workflow reaches its green confirmation within three screens', () => {
    for (const [name, steps] of Object.entries(STAFF_FLOWS)) {
      expect(steps.length, name).toBeLessThanOrEqual(MAX_FLOW_SCREENS);
      for (const s of steps) expect(STAFF_SCREENS[s], `${name}:${s}`).toBeDefined();
    }
  });
});

describe('No horizontal scroll at 360 px (REQ-013)', () => {
  it('REQ-013: the frame hides horizontal overflow and grid tracks can shrink', () => {
    expect(tokens).toMatch(/body \{[^}]*overflow-x: hidden/);
    expect(primitives).toMatch(/\.screen \{[^}]*overflow-x: hidden/);
    expect(primitives).toMatch(/minmax\(0, 1fr\)/);
  });
});
