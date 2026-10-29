import React from 'react';

interface SectionDividerProps {
  label: string;
  marginTop?: string | number;
}

/** A horizontal rule with a centred label, used between table sections. */
function SectionDivider({ label, marginTop = '4px' }: SectionDividerProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '8px',
        marginTop: marginTop ?? '4px',
      }}
    >
      <span
        style={{
          fontWeight: 700,
          // Sentence case at normal size, like the "Qualifying Series" heading:
          // small uppercase labels are hard to read outdoors (AGENTS.md).
          fontSize: '1rem',
          // Full-strength navy; half-transparent navy was ~3:1.
          color: 'var(--navy)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <div
        style={{ flex: 1, height: '1px', background: 'var(--border, #dde3ea)' }}
      />
    </div>
  );
}

export default SectionDivider;
