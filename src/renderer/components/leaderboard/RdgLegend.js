import React from 'react';
import PropTypes from 'prop-types';
import { RDG_TYPES } from '../../utils/leaderboardUtils';

/**
 * Shows a summary of all RDG redress entries currently in the editable
 * leaderboard. Only rendered when edit mode is active and at least one
 * RDG cell exists.
 */
function RdgLegend({ editableLeaderboard, rdgMeta }) {
  const rdgEntries = editableLeaderboard.flatMap((entry) =>
    (entry.race_statuses || [])
      .map((status, ri) => ({ status, ri, entry }))
      .filter(({ status }) => RDG_TYPES.includes(status)),
  );

  if (rdgEntries.length === 0) return null;

  return (
    <div
      style={{
        marginTop: '12px',
        padding: '10px 14px',
        background: 'rgba(42,157,143,0.07)',
        borderRadius: '8px',
        border: '1px solid rgba(42,157,143,0.25)',
        marginBottom: '6px',
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: '0.88rem',
          marginBottom: '6px',
          color: 'var(--teal,#2a9d8f)',
        }}
      >
        RDG – Redress Legend
      </div>

      {rdgEntries.map(({ status, ri, entry }) => {
        const key = `${entry.boat_id}-${ri}`;
        const meta = rdgMeta[key];
        const score = entry.races?.[ri];
        let desc;
        if (status === 'RDG1') {
          desc = 'Average of all series races';
        } else if (status === 'RDG2') {
          desc = `Average of selected races${
            meta?.selectedRaceLabels
              ? `: ${meta.selectedRaceLabels.join(', ')}`
              : ''
          }`;
        } else {
          desc = 'Manual entry';
        }

        return (
          <div
            key={key}
            style={{ fontSize: '0.88rem', color: '#444', marginBottom: '3px' }}
          >
            <strong style={{ color: 'var(--teal,#2a9d8f)' }}>{status}</strong>{' '}
            {entry.name} {entry.surname} — R{ri + 1}: {desc} ={' '}
            <strong>{score}</strong>
          </div>
        );
      })}
    </div>
  );
}

RdgLegend.propTypes = {
  editableLeaderboard: PropTypes.arrayOf(PropTypes.object).isRequired,
  rdgMeta: PropTypes.object.isRequired,
};

export default RdgLegend;
