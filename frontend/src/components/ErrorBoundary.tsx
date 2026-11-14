import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Brand, Button } from './ui';
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Private note text is never sent to telemetry. */
  }
  render() {
    return this.state.failed ? (
      <div className="connection-screen">
        <Brand />
        <div className="connection-card">
          <h1>Let’s reopen your study space.</h1>
          <p>
            The interface encountered a problem. Reload to reconnect to your saved workspace.
            Unsubmitted choices may be lost.
          </p>
          <Button onClick={() => window.location.reload()}>Reload workspace</Button>
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
}
