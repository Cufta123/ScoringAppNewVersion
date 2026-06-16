import React from 'react';

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string | null;
  onAction?: (() => void) | null;
}

function EmptyState({
  title,
  description,
  actionLabel = null,
  onAction = null,
}: EmptyStateProps) {
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

export default EmptyState;
