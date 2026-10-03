import { useSyncExternalStore } from 'react';
import type { ObservableObject } from './ObservableObject';

/** Binds a View to a ViewModel. The React side of MVVM data binding. */
export function useViewModel<T>(vm: ObservableObject<T>): T {
  return useSyncExternalStore(vm.subscribe, vm.getSnapshot);
}
