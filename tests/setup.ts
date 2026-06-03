import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

if (!window.URL.createObjectURL) {
  window.URL.createObjectURL = () => 'blob:mock-url';
}

// Cleanup after each test (for React component tests)
afterEach(() => {
  cleanup();
});
