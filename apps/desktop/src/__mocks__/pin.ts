import { vi } from 'vitest';

export const mockApiFetch = vi.fn();

export const apiFetch = (...args: any[]) => mockApiFetch(...args);
export const authHeaders = () => ({});
export const authJsonHeaders = () => ({ 'Content-Type': 'application/json' });
export const apiUrl = (path: string) => path;
