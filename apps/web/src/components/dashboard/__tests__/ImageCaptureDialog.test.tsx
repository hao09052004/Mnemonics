import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ImageCaptureDialog } from '../ImageCaptureDialog';
import { ApiClient } from '../../../lib/api-client';

function makeApi(over: Partial<ApiClient> = {}): ApiClient {
  const base: Partial<ApiClient> = {
    getValidAccessToken: vi.fn(async () => 'AT'),
    uploadImageCapture: vi.fn(async () => ({ id: 'i1', status: 'pending' })),
    loadStoredSession: vi.fn(() => null),
    saveSession: vi.fn(),
    isAccessTokenExpired: vi.fn(() => false)
  };
  return { ...base, ...over } as unknown as ApiClient;
}

describe('ImageCaptureDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders initially with open=false and transitions to open=true without hook order violations', () => {
    const { rerender } = render(
      <ImageCaptureDialog api={makeApi()} open={false} onClose={vi.fn()} />
    );
    expect(screen.queryByTestId('image-capture-dialog')).toBeNull();

    // Re-rendering with open=true previously triggered "Rendered more hooks than during previous render"
    expect(() => {
      rerender(
        <ImageCaptureDialog api={makeApi()} open={true} onClose={vi.fn()} />
      );
    }).not.toThrow();

    expect(screen.getByTestId('image-capture-dialog')).toBeDefined();
  });
});
