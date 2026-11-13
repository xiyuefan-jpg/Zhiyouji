import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// What antd-mobile expects from a browser that jsdom does not have.
if (!window.matchMedia)
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO;
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= RO;
window.scrollTo = () => {};

afterEach(() => {
  cleanup();
  localStorage.clear();
});
