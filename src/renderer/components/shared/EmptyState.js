import React from 'react';
import PropTypes from 'prop-types';

function EmptyState({
  title,
  description,
  actionLabel = null,
  onAction = null,
}) {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <div className="empty-state-icon" aria-hidden="true">
        <i className="fa fa-compass" />
      </div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
      {actionLabel && onAction && (
        <button type="button" className="btn-ghost" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

EmptyState.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  actionLabel: PropTypes.string,
  onAction: PropTypes.func,
};

export default EmptyState;
