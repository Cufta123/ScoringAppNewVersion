import React from 'react';
import Flag from 'react-world-flags';
import type { LeaderboardEntry } from '../../types';

/**
 * Pieces the qualifying table and the final-fleet table render identically:
 * the identity columns, the Total / Net cells, the race column header and the
 * row style. Only what differs between the tables stays in them.
 */

/** A total that opens "how was this calculated?" when `onExplain` is given. */
export function ExplainableScore({
  value,
  entry,
  onExplain = undefined,
}: {
  value: number | null | undefined;
  entry: LeaderboardEntry;
  onExplain?: (entry: LeaderboardEntry) => void;
}) {
  if (value == null || Number.isNaN(value)) return '–';
  if (!onExplain) return value;
  return (
    <button
      type="button"
      className="score-explain-btn"
      aria-label={`How ${value} points was calculated for sail ${entry.boat_number}`}
      title="How was this calculated?"
      onClick={(event) => {
        event.stopPropagation();
        onExplain(entry);
      }}
    >
      {value}
    </button>
  );
}

/** The Rank, Name, Country, Sail # (and Type) header cells. */
export function IdentityHeaders({
  showType,
  background,
}: {
  showType: boolean;
  background: string;
}) {
  return (
    <>
      {['Rank', 'Name', 'Country', 'Sail #']
        .concat(showType ? ['Type'] : [])
        .map((h) => (
          <th
            scope="col"
            key={h}
            style={{
              textAlign: 'left',
              padding: '9px 12px',
              fontWeight: 600,
              color: 'white',
              whiteSpace: 'nowrap',
              background,
            }}
          >
            {h}
          </th>
        ))}
    </>
  );
}

/** One race column header ("Q3", "F1"), highlighted when the race is shared. */
export function RaceColumnHeader({
  label,
  shared,
}: {
  label: string;
  shared: boolean;
}) {
  return (
    <th
      scope="col"
      aria-label={shared ? `${label} shared race` : label}
      title={shared ? 'Shared race with compared competitor' : undefined}
      style={{
        textAlign: 'center',
        padding: '7px 10px',
        fontWeight: 600,
        color: 'white',
        whiteSpace: 'nowrap',
        background: shared
          ? 'rgba(255, 210, 0, 0.55)'
          : 'rgba(255,255,255,0.15)',
        borderLeft: '1px solid rgba(255,255,255,0.18)',
      }}
    >
      {label}
    </th>
  );
}

/** Rank, Name, Country + flag, Sail # and (when shown) Type cells of a row. */
export function IdentityCells({
  rank,
  entry,
  showType,
  getFlagCode,
}: {
  rank: number;
  entry: LeaderboardEntry;
  showType: boolean;
  getFlagCode: (iocCode: string) => string;
}) {
  return (
    <>
      {/* Rank */}
      <td
        style={{
          padding: '8px 12px',
          fontWeight: 700,
          color: 'var(--navy)',
        }}
      >
        {rank}
      </td>

      {/* Name */}
      <td style={{ padding: '8px 12px' }}>
        {entry.name} {entry.surname}
      </td>

      {/* Country + flag */}
      <td style={{ padding: '8px 12px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Flag
            code={getFlagCode(entry.country ?? '')}
            style={{ width: '24px' }}
          />
          {entry.country}
        </div>
      </td>

      {/* Sail number */}
      <td style={{ padding: '8px 12px', fontWeight: 600 }}>
        {entry.boat_number}
      </td>

      {/* Boat type: only when more than one model sails */}
      {showType && (
        <td style={{ padding: '8px 12px', color: '#555' }}>
          {entry.boat_type}
        </td>
      )}
    </>
  );
}

/** Gross total: all race points added up, discarded ones included. */
export function GrossTotalCell({ total }: { total: number }) {
  return (
    <td
      data-col="total"
      style={{
        padding: '8px 10px',
        textAlign: 'center',
        fontWeight: 600,
        color: 'var(--text-muted, #5A7389)',
        background: 'rgba(0,0,0,0.02)',
        borderLeft: '2px solid rgba(0,0,0,0.1)',
        borderRight: '1px solid rgba(0,0,0,0.08)',
        fontSize: '0.9rem',
      }}
    >
      {total > 0 ? total : '–'}
    </td>
  );
}

/** Net total (SHRS 5.4): the figure that decides the ranking. */
export function NetCell({ children }: { children: React.ReactNode }) {
  return (
    <td
      data-col="net"
      style={{
        padding: '8px 10px',
        textAlign: 'center',
        fontWeight: 700,
        color: 'var(--teal-hover, #0B7A63)',
        background: 'rgba(42,157,143,0.05)',
        borderLeft: '2px solid rgba(42,157,143,0.3)',
        borderRight: '2px solid rgba(42,157,143,0.3)',
      }}
    >
      {children}
    </td>
  );
}

/** Style of one body row: striped, highlighted when selected for comparing. */
export const leaderboardRowStyle = (
  index: number,
  isSelected: boolean,
  compareMode: boolean,
): React.CSSProperties => {
  const stripeBackground =
    index % 2 === 0 ? '#fff' : 'var(--surface-2, #f8fbff)';
  return {
    background: isSelected ? 'rgba(42, 157, 143, 0.15)' : stripeBackground,
    borderBottom: '1px solid var(--border, #dde3ea)',
    cursor: compareMode ? 'pointer' : 'default',
    outline: isSelected ? '2px solid var(--teal, #2a9d8f)' : 'none',
    outlineOffset: '-2px',
  };
};
