import React from 'react';
import PropTypes from 'prop-types';

function Breadcrumbs({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={`${item.label}-${index}`} className="breadcrumbs-item">
            {item.onClick && !isLast ? (
              <button
                type="button"
                className="breadcrumbs-link"
                onClick={item.onClick}
              >
                {item.label}
              </button>
            ) : (
              <span aria-current={isLast ? 'page' : undefined}>{item.label}</span>
            )}
            {!isLast && <span className="breadcrumbs-separator">/</span>}
          </span>
        );
      })}
    </nav>
  );
}

Breadcrumbs.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      onClick: PropTypes.func,
    }),
  ).isRequired,
};

export default Breadcrumbs;
