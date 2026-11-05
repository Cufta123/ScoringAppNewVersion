/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { fireEvent, render, screen, within } from './helpers/renderWithQuery';
import Navbar from '../renderer/components/Navbar';
import { requestProblemReport } from '../renderer/utils/problemReport';

jest.mock('../renderer/utils/problemReport', () => ({
  requestProblemReport: jest.fn(),
  setReportEventContext: jest.fn(),
}));
jest.mock(
  '../renderer/components/shared/HelpModal',
  () =>
    function ({ open }) {
      return open ? <div role="dialog" aria-label="Help" /> : null;
    },
);
jest.mock('../renderer/components/EventHistoryDialog', () => () => null);

const event = { event_id: 3, event_name: 'Kup' };

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const renderAt = (props, path = '/event/Kup/heat-race') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Navbar {...props} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

const sections = () =>
  screen.getByRole('navigation', { name: 'Event sections' });

beforeEach(() => jest.clearAllMocks());

describe('Navbar sections', () => {
  it('are only shown inside an event', () => {
    renderAt({}, '/');
    expect(
      screen.queryByRole('navigation', { name: 'Event sections' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open history and backups' }),
    ).not.toBeInTheDocument();
  });

  it('mark the open one and go to the others', () => {
    renderAt({ event, section: 'scoring' });
    const scoring = within(sections()).getByRole('button', {
      name: 'Scoring',
    });
    expect(scoring).toHaveAttribute('aria-current', 'page');

    fireEvent.click(scoring);
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/event/Kup/heat-race',
    );

    fireEvent.click(
      within(sections()).getByRole('button', { name: 'Leaderboard' }),
    );
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/event/Kup/leaderboard',
    );
  });

  it('go through the page’s unsaved-work check', () => {
    const guardNavigation = jest.fn();
    renderAt({ event, section: 'scoring', guardNavigation });
    fireEvent.click(
      within(sections()).getByRole('button', { name: 'Entries' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go to home page' }));
    expect(guardNavigation).toHaveBeenCalledTimes(2);
    // The check said no: the page stays.
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/event/Kup/heat-race',
    );

    guardNavigation.mock.calls[0][0]();
    expect(screen.getByTestId('where')).toHaveTextContent('/event/Kup');
  });
});

describe('Help menu', () => {
  const helpButton = () => screen.getByRole('button', { name: 'Help' });

  it('holds the help and Report a problem', () => {
    renderAt({ event, section: 'entries' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(helpButton());
    expect(helpButton()).toHaveAttribute('aria-expanded', 'true');
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();

    fireEvent.click(screen.getByRole('menuitem', { name: /Report a problem/ }));
    expect(requestProblemReport).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(helpButton());
    fireEvent.click(
      screen.getByRole('menuitem', { name: /Help and glossary/ }),
    );
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeInTheDocument();
  });

  it('moves with the arrow keys and closes on Escape, back on its button', () => {
    renderAt({});
    fireEvent.click(helpButton());
    const menu = screen.getByRole('menu');
    const [first, second] = within(menu).getAllByRole('menuitem');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(helpButton()).toHaveFocus();
  });

  it('closes on a click outside', () => {
    renderAt({});
    fireEvent.click(helpButton());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
