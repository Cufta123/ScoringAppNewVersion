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
          fontSize: '0.88rem',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--navy)',
          opacity: 0.5,
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
