import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SpacesPage } from '../SpacesPage';
import { SpaceDetailPage } from '../SpaceDetailPage';
import { DashboardPage } from '../DashboardPage';
import { EverythingView } from '../../components/dashboard/EverythingView';
import { ApiClient, type SpaceWithCount } from '../../lib/api-client';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SESSION = {
  accessToken: 't',
  refreshToken: 'r',
  user: { id: 'u1', email: 'a@b.c', role: 'user', emailVerified: true },
  expiresAt: 0
};

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

/**
 * A real ApiClient with only the network methods stubbed. Using the
 * real class keeps the request plumbing under test instead of
 * replacing the whole client with an object that shares no code with
 * production.
 */
function mockApi(): ApiClient {
  const api = new ApiClient('http://localhost');
  vi.spyOn(api, 'loadStoredSession').mockReturnValue(SESSION);
  vi.spyOn(api, 'getValidAccessToken').mockResolvedValue('t');
  return api;
}

describe('SpacesPage', () => {
  it('renders each Space with its kind, count, and colour dot', async () => {
    const api = mockApi();
    vi.spyOn(api, 'listSpaces').mockResolvedValue([
      makeSpace({ id: 'm1', name: 'M&A Research', spaceType: 'manual', itemCount: 12 }),
      makeSpace({
        id: 's1',
        name: 'Logo Inspiration',
        spaceType: 'smart',
        color: 'teal',
        itemCount: 18,
        rule: { q: 'logo', filters: { kind: ['image'] } }
      })
    ]);

    render(
      <MemoryRouter>
        <SpacesPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText('M&A Research'));
    expect(screen.getByText('Logo Inspiration')).toBeTruthy();
    expect(screen.getByText('12 memories')).toBeTruthy();
    expect(screen.getByText('18 memories')).toBeTruthy();
    expect(screen.getByTestId('space-kind-manual')).toBeTruthy();
    expect(screen.getByTestId('space-kind-smart')).toBeTruthy();
  });

  it('asks the server to resolve smart counts', async () => {
    const api = mockApi();
    const list = vi.spyOn(api, 'listSpaces').mockResolvedValue([makeSpace()]);
    render(
      <MemoryRouter>
        <SpacesPage api={api} />
      </MemoryRouter>
    );
    await waitFor(() => expect(list).toHaveBeenCalledWith('t', { withCounts: true }));
  });

  it('shows the empty state and creates a manual Space', async () => {
    const api = mockApi();
    vi.spyOn(api, 'listSpaces').mockResolvedValue([]);
    const create = vi.spyOn(api, 'createSpace').mockResolvedValue(makeSpace({ id: 'new' }));

    render(
      <MemoryRouter>
        <SpacesPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => screen.getByTestId('spaces-empty'));
    await userEvent.click(screen.getByTestId('new-space-btn'));
    await userEvent.type(screen.getByTestId('space-dialog-name'), 'Thesis');
    await userEvent.click(screen.getByTestId('space-color-rose'));
    await userEvent.click(screen.getByTestId('space-dialog-submit'));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ name: 'Thesis', color: 'rose', spaceType: 'manual' }, 't')
    );
  });

  it('renders real memory previews rather than placeholders', async () => {
    const api = mockApi();
    vi.spyOn(api, 'listSpaces').mockResolvedValue([
      makeSpace({
        previewItems: [
          { id: 'a', kind: 'image', title: 'Shot A', thumbnailUrl: null, isFavorite: false },
          { id: 'b', kind: 'text', title: 'Note B', thumbnailUrl: null, isFavorite: false }
        ]
      })
    ]);
    render(
      <MemoryRouter>
        <SpacesPage api={api} />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText('img'));
    expect(screen.getByText('note')).toBeTruthy();
  });
});

describe('SpaceDetailPage — manual', () => {
  function renderDetail(api: ApiClient) {
    return render(
      <MemoryRouter initialEntries={['/app/spaces/space-1']}>
        <Routes>
          <Route path="/app/spaces/:id" element={<SpaceDetailPage api={api} />} />
          <Route path="/app/spaces" element={<div>all spaces</div>} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('lists the Space members and offers removal', async () => {
    const api = mockApi();
    vi.spyOn(api, 'getSpace').mockResolvedValue(makeSpace({ itemCount: 2 }));
    vi.spyOn(api, 'listSpaceItems').mockResolvedValue({
      ids: ['i1', 'i2'],
      source: 'manual'
    } as never);
    vi.spyOn(api, 'getItem').mockImplementation((itemId: string) =>
      Promise.resolve({
        id: itemId,
        kind: 'text',
        title: `Memory ${itemId}`,
        raw_text: 'body',
        captured_at: new Date().toISOString()
      } as never)
    );
    const remove = vi.spyOn(api, 'removeItemFromSpace').mockResolvedValue(undefined);

    renderDetail(api);
    await waitFor(() => screen.getByTestId('space-detail-title'));
    expect(screen.getByText('M&A Research')).toBeTruthy();
    expect(screen.getByTestId('space-kind-manual')).toBeTruthy();

    // The delete entry is the manual membership action here.
    await userEvent.click(screen.getByTestId('item-more-i1'));
    expect(screen.getByTestId('item-menu-delete-i1')).toBeTruthy();
    await userEvent.click(screen.getByTestId('item-menu-delete-i1'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('space-1', 'i1', 't'));
  });

  it('shows the manual empty state', async () => {
    const api = mockApi();
    vi.spyOn(api, 'getSpace').mockResolvedValue(makeSpace({ itemCount: 0 }));
    vi.spyOn(api, 'listSpaceItems').mockResolvedValue({ ids: [], source: 'manual' } as never);

    renderDetail(api);
    await waitFor(() => screen.getByTestId('space-empty'));
    expect(screen.getByText('No memories here yet.')).toBeTruthy();
  });

  it('confirms before deleting, and states that memories survive', async () => {
    const api = mockApi();
    vi.spyOn(api, 'getSpace').mockResolvedValue(makeSpace());
    vi.spyOn(api, 'listSpaceItems').mockResolvedValue({ ids: [], source: 'manual' } as never);
    const del = vi.spyOn(api, 'deleteSpace').mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderDetail(api);
    await waitFor(() => screen.getByTestId('space-delete-btn'));
    await userEvent.click(screen.getByTestId('space-delete-btn'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(confirmSpy.mock.calls[0][0]).toContain('Your memories will remain in Mnemonics.');
    await waitFor(() => expect(del).toHaveBeenCalledWith('space-1', 't'));
  });

  it('keeps the Space when the user declines the delete', async () => {
    const api = mockApi();
    vi.spyOn(api, 'getSpace').mockResolvedValue(makeSpace());
    vi.spyOn(api, 'listSpaceItems').mockResolvedValue({ ids: [], source: 'manual' } as never);
    const del = vi.spyOn(api, 'deleteSpace').mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderDetail(api);
    await waitFor(() => screen.getByTestId('space-delete-btn'));
    await userEvent.click(screen.getByTestId('space-delete-btn'));
    expect(del).not.toHaveBeenCalled();
  });
});

describe('SpaceDetailPage — smart', () => {
  function renderDetail(api: ApiClient) {
    return render(
      <MemoryRouter initialEntries={['/app/spaces/smart-1']}>
        <Routes>
          <Route path="/app/spaces/:id" element={<SpaceDetailPage api={api} />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('shows the saved criteria in readable form', async () => {
    const api = mockApi();
    vi.spyOn(api, 'getSpace').mockResolvedValue(
      makeSpace({
        id: 'smart-1',
        name: 'Logo Inspiration',
        spaceType: 'smart',
        rule: { q: 'logo', filters: { kind: ['image'], tags: ['design'] } }
      })
    );
    vi.spyOn(api, 'listSpaceItems').mockResolvedValue({
      ids: [],
      items: [],
      source: 'smart'
    } as never);

    renderDetail(api);
    await waitFor(() => screen.getByTestId('space-detail-rules'));
    const rules = screen.getByTestId('space-detail-rules').textContent ?? '';
    expect(rules).toContain('Image');
    expect(rules).toContain('#design');
    expect(rules).toContain('Search: logo');
  });

  it('does not offer "remove from Space", because membership is derived', async () => {
    const api = mockApi();
    vi.spyOn(api, 'getSpace').mockResolvedValue(
      makeSpace({ id: 'smart-1', spaceType: 'smart', rule: { q: 'logo' } })
    );
    vi.spyOn(api, 'listSpaceItems').mockResolvedValue({
      ids: ['i1'],
      items: [],
      source: 'smart'
    } as never);
    vi.spyOn(api, 'getItem').mockResolvedValue({
      id: 'i1',
      kind: 'image',
      title: 'A logo',
      raw_text: '',
      captured_at: new Date().toISOString()
    } as never);

    renderDetail(api);
    await waitFor(() => screen.getByTestId('item-card-i1'));
    await userEvent.click(screen.getByTestId('item-more-i1'));
    // The menu exists (it can open the detail) but no membership action.
    expect(screen.queryByTestId('item-menu-delete-i1')).toBeNull();
  });

  it('uses the smart empty state, not the manual one', async () => {
    const api = mockApi();
    vi.spyOn(api, 'getSpace').mockResolvedValue(
      makeSpace({ id: 'smart-1', spaceType: 'smart', rule: { q: 'nothing matches' } })
    );
    vi.spyOn(api, 'listSpaceItems').mockResolvedValue({
      ids: [],
      items: [],
      source: 'smart'
    } as never);

    renderDetail(api);
    await waitFor(() => screen.getByTestId('space-empty'));
    expect(screen.getByText('No memories currently match this Space.')).toBeTruthy();
  });
});

describe('multi-select', () => {
  const items = [
    { id: 'm1', kind: 'text', title: 'One' },
    { id: 'm2', kind: 'text', title: 'Two' },
    { id: 'm3', kind: 'text', title: 'Three' }
  ];

  const addToSpace = vi.fn();

  function renderView(api: ApiClient) {
    return render(
      <MemoryRouter>
        <EverythingView
          items={items}
          loading={false}
          error={null}
          query=""
          onQueryChange={vi.fn()}
          filter="all"
          onFilterChange={vi.fn()}
          onOpen={vi.fn()}
          onCapture={vi.fn()}
          onAddToSpace={addToSpace}
        />
      </MemoryRouter>
    );
  }

  it('enters selection mode and reports the chosen ids', async () => {
    renderView(mockApi());
    await userEvent.click(screen.getByTestId('enter-selection'));
    expect(screen.getByTestId('selection-bar')).toBeTruthy();

    await userEvent.click(screen.getByTestId('item-select-m1'));
    await userEvent.click(screen.getByTestId('item-select-m3'));
    expect(screen.getByTestId('selection-count').textContent).toContain('2 memories');

    await userEvent.click(screen.getByTestId('selection-add-to-space'));
    expect(addToSpace).toHaveBeenCalledWith(['m1', 'm3']);
  });

  it('deselects on a second click and cancels cleanly', async () => {
    renderView(mockApi());
    await userEvent.click(screen.getByTestId('enter-selection'));
    await userEvent.click(screen.getByTestId('item-select-m1'));
    await userEvent.click(screen.getByTestId('item-select-m1'));
    expect(screen.getByTestId('selection-count').textContent).toContain('0 memories');

    await userEvent.click(screen.getByTestId('selection-cancel'));
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('keeps the add action disabled with nothing selected', async () => {
    renderView(mockApi());
    await userEvent.click(screen.getByTestId('enter-selection'));
    expect((screen.getByTestId('selection-add-to-space') as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides the selection affordance entirely when bulk actions are off', () => {
    render(
      <MemoryRouter>
        <EverythingView
          items={items}
          loading={false}
          error={null}
          query=""
          onQueryChange={vi.fn()}
          filter="all"
          onFilterChange={vi.fn()}
          onOpen={vi.fn()}
          onCapture={vi.fn()}
        />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('enter-selection')).toBeNull();
  });
});

describe('save search as smart space', () => {
  function renderDashboard(api: ApiClient) {
    return render(
      <MemoryRouter>
        <DashboardPage api={api} />
      </MemoryRouter>
    );
  }

  const emptyList = { items: [], total: 0, limit: 50, offset: 0 };

  it('hides the affordance until a search or filter is active', async () => {
    const api = mockApi();
    vi.spyOn(api, 'listItems').mockResolvedValue(emptyList);
    renderDashboard(api);
    await waitFor(() => expect(screen.queryByTestId('save-as-space')).toBeNull());
  });

  it('offers it once a query is typed, and saves criteria rather than ids', async () => {
    const api = mockApi();
    vi.spyOn(api, 'listItems').mockResolvedValue(emptyList);
    vi.spyOn(api, 'search').mockResolvedValue({ hits: [], total: 0, took_ms: 1 } as never);
    const create = vi.spyOn(api, 'createSmartSpace').mockResolvedValue(
      makeSpace({ id: 'smart-new', spaceType: 'smart', rule: { q: 'logo' } })
    );

    renderDashboard(api);
    await userEvent.type(screen.getByLabelText('Search your memories'), 'logo');

    await waitFor(() => expect(screen.getByTestId('save-as-space')).toBeTruthy());
    await userEvent.click(screen.getByTestId('save-as-space'));

    // The dialog states the criteria and the automatic behaviour.
    const criteria = screen.getByTestId('space-dialog-criteria').textContent ?? '';
    expect(criteria).toContain('Search: logo');

    await userEvent.type(screen.getByTestId('space-dialog-name'), 'Logo Inspiration');
    await userEvent.click(screen.getByTestId('space-dialog-submit'));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        { name: 'Logo Inspiration', color: 'violet', rule: { q: 'logo' } },
        't'
      )
    );
    // Criteria only — result ids are never part of the payload.
    const payload = create.mock.calls[0][0] as unknown as { rule: Record<string, unknown> };
    expect(Object.keys(payload.rule)).not.toContain('itemIds');
  });

  it('folds the active type chip into the saved criteria', async () => {
    const api = mockApi();
    vi.spyOn(api, 'listItems').mockResolvedValue(emptyList);
    vi.spyOn(api, 'search').mockResolvedValue({ hits: [], total: 0, took_ms: 1 } as never);
    const create = vi.spyOn(api, 'createSmartSpace').mockResolvedValue(
      makeSpace({ id: 'smart-new', spaceType: 'smart' })
    );

    renderDashboard(api);
    await userEvent.click(await screen.findByRole('button', { name: /image/i }));
    await waitFor(() => expect(screen.getByTestId('save-as-space')).toBeTruthy());
    await userEvent.click(screen.getByTestId('save-as-space'));
    await userEvent.type(screen.getByTestId('space-dialog-name'), 'Images');
    await userEvent.click(screen.getByTestId('space-dialog-submit'));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ rule: { q: '', filters: { kind: ['image'] } } }),
        't'
      )
    );
  });
});
