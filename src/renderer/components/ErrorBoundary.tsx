import React from 'react';
import { useNavigate } from 'react-router-dom';
import { reportError } from '../utils/userFeedback';

interface ErrorBoundaryState {
  hasError: boolean;
}

interface ErrorBoundaryBaseProps {
  children: React.ReactNode;
  // Optional callback used to route back to the home screen. Supplied by the
  // wrapper below so the class stays a pure, router-agnostic unit.
  // eslint-disable-next-line react/require-default-props -- defaultProps is deprecated and the class already handles absence explicitly.
  onNavigateHome?: () => void;
}

/**
 * Catches render-time errors anywhere in the subtree below it and shows a
 * friendly recovery screen instead of a blank Electron window. React error
 * boundaries must be class components — this is the class.
 */
class ErrorBoundaryBase extends React.Component<
  ErrorBoundaryBaseProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryBaseProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    // Update state so the next render shows the fallback UI.
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Keep the raw technical detail (component stack, error object) for
    // diagnosis in devtools, then surface a plain-language message to the race
    // officer via the existing feedback toast.
    // eslint-disable-next-line no-console
    console.error(
      'A screen crashed while rendering. Use the buttons below to recover.',
      error,
      errorInfo?.componentStack,
    );
    reportError(
      'Something went wrong displaying this screen. Your event data is safe — reload the screen or go back to the home page.',
      error,
    );
  }

  private handleReload = (): void => {
    // Reset the boundary so the crashed subtree re-renders. If it throws again
    // the boundary catches it again and shows this same fallback.
    this.setState({ hasError: false });
  };

  private handleGoHome = (): void => {
    const { onNavigateHome } = this.props;
    this.setState({ hasError: false });
    if (onNavigateHome) {
      onNavigateHome();
    }
  };

  render(): React.ReactNode {
    const { children, onNavigateHome } = this.props;
    const { hasError } = this.state;

    if (hasError) {
      return (
        <div className="error-boundary" role="alert">
          <div className="error-boundary-card card">
            <div className="error-boundary-icon" aria-hidden="true">
              <i className="fa fa-triangle-exclamation" />
            </div>
            <h1 className="error-boundary-title">Something went wrong</h1>
            <p className="error-boundary-description">
              This screen hit an unexpected error and could not be displayed.
              Your event data is safe. Reload the screen, or go back to the home
              page.
            </p>
            <div className="error-boundary-actions">
              <button type="button" onClick={this.handleReload}>
                <i className="fa fa-rotate-right" aria-hidden="true" />
                Reload
              </button>
              {onNavigateHome && (
                <button
                  type="button"
                  className="btn-outline"
                  onClick={this.handleGoHome}
                >
                  <i className="fa fa-house" aria-hidden="true" />
                  Go home
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return children;
  }
}

/**
 * Router-aware wrapper. Supplies the "Go home" navigation via `useNavigate`,
 * keeping the class boundary a pure, self-contained unit that renders children
 * normally when there is no error.
 */
function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <ErrorBoundaryBase onNavigateHome={() => navigate('/')}>
      {children}
    </ErrorBoundaryBase>
  );
}

export default ErrorBoundary;
