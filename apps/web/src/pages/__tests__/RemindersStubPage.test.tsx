import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RemindersStubPage } from '../RemindersStubPage';

describe('RemindersStubPage', () => {
  it('renders the coming-soon stub without a session', () => {
    render(
      <MemoryRouter>
        <RemindersStubPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/coming soon/i)).toBeTruthy();
  });
});