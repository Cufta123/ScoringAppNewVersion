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
          // Full-strength secondary text (11.7:1); half-transparent navy was ~3:1.
          color: 'var(--text-secondary)',
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
