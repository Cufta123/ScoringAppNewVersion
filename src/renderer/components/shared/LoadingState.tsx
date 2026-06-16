import React from 'react';

interface LoadingStateProps {
  label?: string;
}

function LoadingState({ label = 'Loading data...' }: LoadingStateProps) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <i className="fa fa-spinner fa-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export default LoadingState;
