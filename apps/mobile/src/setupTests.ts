// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/extend-expect';

// Mock matchmedia — guarded: this file is the global `setupFiles` for every
// vitest run, but some test files (e.g. cardLocalizer.test.ts, ROADMAP.md
// G4c — real OpenCV.js WASM hangs under jsdom) opt into
// `// @vitest-environment node`, where `window` doesn't exist at all.
if (typeof window !== 'undefined') {
  window.matchMedia = window.matchMedia || function() {
    return {
        matches: false,
        addListener: function() {},
        removeListener: function() {}
    };
  };
}
