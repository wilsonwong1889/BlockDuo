import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * The last thing between a thrown render and a white screen.
 *
 * React unmounts the whole tree when a render throws, so without this a single
 * bad component leaves the player looking at nothing at all — no message, no
 * way back, and no idea whether the game is broken or their connection is.
 *
 * A class is not a style choice: this is the one thing React still has no hook
 * for.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Nothing collects these yet. Logging keeps them in the console for a
    // player who reports a problem, and marks the one place a reporting
    // service is wired in later.
    console.error('BLOKDUO crashed while rendering', error, info.componentStack);
  }

  private reload = () => {
    // Home, not the screen that just failed — reloading straight back into a
    // broken game would only break again.
    window.location.hash = '#/';
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="screen crash">
        <h1 className="home-title">
          BLOK<span className="accent">DUO</span>
        </h1>
        <p className="crash-note">
          Something went wrong on this screen. Your saved game and your score are
          still safe.
        </p>
        <button className="btn primary big" onClick={this.reload}>
          Back to the menu
        </button>
      </div>
    );
  }
}
