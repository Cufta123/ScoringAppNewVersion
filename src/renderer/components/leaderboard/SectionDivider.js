import React from 'react';
import PropTypes from 'prop-types';

/** A horizontal rule with a centred label, used between table sections. */
function SectionDivider({ label, marginTop }) {
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
          fontSize: '0.78rem',
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

SectionDivider.propTypes = {
  label: PropTypes.string.isRequired,
  marginTop: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};

SectionDivider.defaultProps = {
  marginTop: '4px',
};

export default SectionDivider;
