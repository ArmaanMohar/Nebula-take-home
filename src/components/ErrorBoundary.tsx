import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Last line of defense: a render error shows a message, never a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">This view hit an error and could not be displayed.</p>
          <p className="mt-1 font-mono text-xs">{this.state.error.message}</p>
          <p className="mt-2">Try another view, change filters, or load a different file.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
