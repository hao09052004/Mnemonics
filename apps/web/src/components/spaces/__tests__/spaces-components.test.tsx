import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpacePicker } from '../SpacePicker';
import { CreateSpaceDialog, SpaceRuleSummary } from '../CreateSpaceDialog';
import { SpaceColorPicker, SpaceKindBadge, SpaceDot } from '../SpaceIdentity';
import type { ApiClient, SpaceWithCount } from '../../../lib/api-client';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeSpace(overrides: Partial<SpaceWithCount> = {}): SpaceWithCount {
  return {
    id: 'space-1',
    userId: 'u1',
    name: 'M&A Research',
    description: null,
    color: 'blue',
    spaceType: 'manual',
    coverItemId: null,
    rule: null,
    ruleVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    itemCount: 12,
    previewItems: [],
    ...overrides
  };
}

function makeApi(spaces: SpaceWithCount[], extra: Partial<ApiClient> = {}): ApiClient {
  return {
    getValidAccessToken: vi.fn().mockResolvedValue('token'),
    listSpaces: vi.fn().mockResolvedValue(spaces),
    addItemsToSpace: vi.fn().mockResolvedValue({ added: ['i1'], skipped: [] }),
    createSpace: vi.fn().mockResolvedValue(makeSpace({ id: 'space-new' })),
    ...extra
  } as unknown as ApiClient;
}

describe('SpaceIdentity', () => {
  it('renders a colour swatch as a radio and reports the choice', async () => {
    const onChange = vi.fn();
    render(<SpaceColorPicker value="violet" onChange={onChange} label="Colour" />);

    const teal = screen.getByTestId('space-color-teal');
    expect(screen.getByTestId('space-color-violet').getAttribute('aria-checked')).toBe('true');
    await userEvent.click(teal);
    expect(onChange).toHaveBeenCalledWith('teal');
  });

  it('exposes exactly the curated palette', () => {
    render(<SpaceColorPicker value={null} onChange={vi.fn()} />);
    const group = screen.getByRole('radiogroup');
    // Seven muted hues — no free-form colour input exists.
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(7);
  });

  it('labels the kind in plain text, with no AI wording', () => {
    render(<SpaceKindBadge kind="smart" />);
    const badge = screen.getByTestId('space-kind-smart');
    expect(badge.textContent).toBe('smart');
    expect(badge.querySelector('svg')).toBeNull();
  });

  it('hides the decorative dot from assistive tech', () => {
    const { container } = render(<SpaceDot color="rose" />);
    expect(container.querySelector('.space-dot')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('SpaceRuleSummary', () => {
  it('renders criteria as readable chips, never JSON', () => {
    render(
      <SpaceRuleSummary
        rule={{ q: 'logo', filters: { kind: ['image'], tags: ['design'] } }}
      />
    );
    const text = screen.getByTestId('space-rule-summary').textContent ?? '';
    expect(text).toContain('Image');
    expect(text).toContain('#design');
    expect(text).toContain('Search: logo');
    expect(text).not.toContain('{');
  });

  it('says so when there are no criteria rather than rendering blanks', () => {
    render(<SpaceRuleSummary rule={{ q: '' }} />);
    expect(screen.getByTestId('space-rule-summary').className).toContain('is-empty');
  });
});

describe('CreateSpaceDialog', () => {
  it('creates a manual Space from a name and colour', async () => {
    const onSubmit = vi.fn();
    render(<CreateSpaceDialog mode="manual" onClose={vi.fn()} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByTestId('space-dialog-name'), 'M&A Research');
    await userEvent.click(screen.getByTestId('space-color-teal'));
    await userEvent.click(screen.getByTestId('space-dialog-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'M&A Research',
      description: '',
      color: 'teal'
    });
  });

  it('keeps submit disabled until a name is typed', () => {
    render(<CreateSpaceDialog mode="manual" onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect((screen.getByTestId('space-dialog-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('explains the smart behaviour and shows the criteria being saved', () => {
    render(
      <CreateSpaceDialog
        mode="smart"
        rule={{ q: 'reinforcement learning', filters: { kind: ['link'] } }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByTestId('space-dialog-criteria')).toBeTruthy();
    const explanation = screen.getByTestId('space-dialog-criteria').textContent ?? '';
    expect(explanation).toMatch(/stays up to date/i);
    expect(explanation).toContain('reinforcement learning');
  });
});

describe('SpacePicker', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('lists manual Spaces and adds the selected memories to one', async () => {
    const api = makeApi([makeSpace()]);
    const onAdded = vi.fn();
    render(<SpacePicker api={api} itemIds={['i1', 'i2']} onClose={vi.fn()} onAdded={onAdded} />);

    const row = await screen.findByTestId('space-picker-row-space-1');
    await userEvent.click(row);

    await waitFor(() => {
      expect(api.addItemsToSpace).toHaveBeenCalledWith('space-1', ['i1', 'i2'], 'token');
    });
    expect(onAdded).toHaveBeenCalled();
  });

  it('never offers a smart Space, because its membership is rule-driven', async () => {
    const api = makeApi([
      makeSpace({ id: 'manual-1', name: 'Manual', spaceType: 'manual' }),
      makeSpace({ id: 'smart-1', name: 'Smart', spaceType: 'smart', rule: { q: 'x' } })
    ]);
    render(<SpacePicker api={api} itemIds={['i1']} onClose={vi.fn()} />);

    await screen.findByTestId('space-picker-row-manual-1');
    expect(screen.queryByTestId('space-picker-row-smart-1')).toBeNull();
    // And the reason is stated, so the absence does not read as a bug.
    expect(screen.getByText(/Smart Spaces fill themselves/i)).toBeTruthy();
  });

  it('filters the list as the user types', async () => {
    const api = makeApi([
      makeSpace({ id: 'a', name: 'Alpha' }),
      makeSpace({ id: 'b', name: 'Beta' })
    ]);
    render(<SpacePicker api={api} itemIds={['i1']} onClose={vi.fn()} />);

    await screen.findByTestId('space-picker-row-a');
    await userEvent.type(screen.getByTestId('space-picker-search'), 'bet');

    await waitFor(() => {
      expect(screen.queryByTestId('space-picker-row-a')).toBeNull();
    });
    expect(screen.getByTestId('space-picker-row-b')).toBeTruthy();
  });

  it('creates a manual Space and seeds it with the selection in one flow', async () => {
    const api = makeApi([]);
    render(<SpacePicker api={api} itemIds={['i1', 'i2']} onClose={vi.fn()} />);

    await userEvent.click(await screen.findByTestId('space-picker-new'));
    await userEvent.type(screen.getByTestId('space-picker-name'), 'Research');
    await userEvent.click(screen.getByTestId('space-picker-create-submit'));

    await waitFor(() => {
      expect(api.createSpace).toHaveBeenCalledWith(
        { name: 'Research', color: 'violet', spaceType: 'manual' },
        'token'
      );
    });
    expect(api.addItemsToSpace).toHaveBeenCalledWith('space-new', ['i1', 'i2'], 'token');
  });

  it('surfaces a server rejection instead of closing silently', async () => {
    const api = makeApi(
      [makeSpace()],
      { addItemsToSpace: vi.fn().mockRejectedValue(new Error('boom')) } as Partial<ApiClient>
    );
    render(<SpacePicker api={api} itemIds={['i1']} onClose={vi.fn()} />);

    await userEvent.click(await screen.findByTestId('space-picker-row-space-1'));
    expect(await screen.findByTestId('space-picker-error')).toBeTruthy();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const api = makeApi([makeSpace()]);
    render(<SpacePicker api={api} itemIds={['i1']} onClose={onClose} />);
    await screen.findByTestId('space-picker-row-space-1');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
