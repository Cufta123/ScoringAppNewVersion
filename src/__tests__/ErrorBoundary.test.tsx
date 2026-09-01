/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ErrorBoundary from '../renderer/components/ErrorBoundary';

// A component that throws while rendering, to trigger the boundary.
function Bomb(): never {
  throw new Error('Boom!');
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // React logs the thrown error (and our own console.error) to the console in
    // the test env — expected noise, so silence it.
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children when there is no error', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <div>All good</div>
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('renders the fallback when a child throws during render', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /go home/i }),
    ).toBeInTheDocument();
  });
});
