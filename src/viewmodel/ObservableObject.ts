/**
 * Minimal observable base class, the React equivalent of
 * INotifyPropertyChanged in WPF/MVVM. A ViewModel publishes an
 * immutable snapshot; Views subscribe and re-render when it changes.
 */
export abstract class ObservableObject<TState> {
  private listeners = new Set<() => void>();
  private snapshot!: TState;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TState => this.snapshot;

  protected publish(next: TState): void {
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }
}
