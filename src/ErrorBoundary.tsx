// If a screen crashes, show a calm message with a way out instead of a blank page. Your trip is not touched:
// nothing is saved or lost by this screen. Moving to another page tries again.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { COVER, Scene } from './scenes.tsx';

interface Props {
  children: ReactNode;
  /** When this changes (the address in the bar), the screen is tried again. */
  resetKey: string;
}

export class ErrorBoundary extends Component<Props, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(p: Props, s: { error: Error | null; key: string }) {
    return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null;
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen crashed', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth">
        <Scene region="TraiLilo" theme={COVER} seed="cover" photo={false} className="auth-scene" />
        <main className="auth-card">
          <span className="wordmark">TraiLilo</span>
          <h1>Something went wrong on this screen</h1>
          <p className="auth-note">Your trip is safe: everything you saved is still there, and changes waiting to upload are kept on this phone. Reloading usually fixes it.</p>
          <button type="button" className="auth-primary" onClick={() => location.reload()}>Reload</button>
          <a className="auth-link" href="#/">Back to your trips</a>
        </main>
      </div>
    );
  }
}
