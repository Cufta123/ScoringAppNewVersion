/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React, { useEffect } from 'react';
import { render, screen } from './helpers/renderWithQuery';
import useEventSettings from '../renderer/hooks/useEventSettings';
import AdvancedEventSettings from '../renderer/components/AdvancedEventSettings';
import {
  getDiscardExamples,
  getDiscardSummary,
  getOverflowPolicyLabel,
} from '../renderer/utils/discardProfileForm';

const baseEvent = {
  event_id: 1,
  event_name: 'Kup',
  event_location: 'Split',
  start_date: '2026-05-01',
  end_date: '2026-05-03',
  shrs_version: '2026-1',
  shrs_qualifying_assignment_mode: 'progressive',
  shrs_discard_profile_qualifying: 'standard',
  shrs_discard_profile_final: 'standard',
  shrs_discard_locked_qualifying: 0,
  shrs_discard_locked_final: 0,
  shrs_heat_overflow_policy: 'auto-increase',
};

function Harness({ event }) {
  const settings = useEventSettings();
  useEffect(() => {
    settings.loadFrom(event);
    settings.setAdvancedEnabled(true);
    // Load once, as the edit form does when editing starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <AdvancedEventSettings idPrefix="t" settings={settings} />;
}

const assignment = () => screen.getByLabelText(/Qualifying Assignment Mode/);
const overflow = () => screen.getByLabelText(/Final fleets over 20 boats/);

describe('advanced settings fixed once their series has begun', () => {
  it('leaves everything editable before any race', () => {
    render(<Harness event={baseEvent} />);
    expect(assignment()).toBeEnabled();
    expect(overflow()).toBeEnabled();
    expect(screen.queryByText(/^Locked:/)).not.toBeInTheDocument();
  });

  it('locks the assignment mode once the qualifying series has started', () => {
    render(<Harness event={{ ...baseEvent, qualifying_started: 1 }} />);
    expect(assignment()).toBeDisabled();
    expect(
      screen.getByText(/Locked: the qualifying series has started/),
    ).toBeVisible();
    expect(overflow()).toBeEnabled();
  });

  it('locks the final fleets setting once the fleets are split', () => {
    render(
      <Harness
        event={{ ...baseEvent, qualifying_started: 1, final_series_started: 1 }}
      />,
    );
    expect(overflow()).toBeDisabled();
    expect(screen.getByText(/Locked: the Final Series/)).toBeVisible();
  });

  it('says what the final fleets setting is for', () => {
    render(<Harness event={baseEvent} />);
    expect(
      screen.getByText(/Used only when the Final Series is split/),
    ).toBeVisible();
    expect(
      getOverflowPolicyLabel({
        ...baseEvent,
        shrs_heat_overflow_policy: 'confirm-allow-oversize',
      }),
    ).toBe('Final fleets over 20 if confirmed');
  });
});

describe('custom discard list wording', () => {
  it('says the exclusions stop growing after the last threshold', () => {
    expect(getDiscardSummary('custom', '4,8,16,24')).toMatch(
      /From 24 races on, 4 races are excluded and no more are added/,
    );
    expect(getDiscardSummary('custom', '5')).toMatch(
      /From 5 races on, 1 race is excluded/,
    );
  });

  it('shows an example past the last threshold', () => {
    expect(getDiscardExamples('custom', '4,8,16,24')).toBe(
      '4 races = 1 discard | 8 races = 2 discards | 16 races = 3 discards | 24 races = 4 discards | 32 races = 4 discards',
    );
  });
});
