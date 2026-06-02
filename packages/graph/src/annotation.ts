export interface AnnotationConfig<T> {
  reducer: (current: T, update: T) => T;
  default: () => T;
}

export interface Annotation<T> {
  reducer: (current: T, update: T) => T;
  default: () => T;
}

export function Annotation<T>(config: AnnotationConfig<T>): Annotation<T> {
  return {
    reducer: config.reducer,
    default: config.default,
  };
}
