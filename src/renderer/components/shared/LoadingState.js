import React from 'react';
import PropTypes from 'prop-types';

function LoadingState({ label = 'Loading data...' }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <i className="fa fa-spinner fa-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

LoadingState.propTypes = {
  label: PropTypes.string,
};

export default LoadingState;
