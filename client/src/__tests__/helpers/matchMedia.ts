// setupTests installs a window.matchMedia stub hard-wired to `matches: false`, so
// responsive/mobile branches (MobileNav, Topbar drawer, ui/sheet) can never render
// under test. Call `mockMatchMedia(true)` in a test to force the mobile match, and
// `restoreMatchMedia()` in afterEach so the override does not leak to other tests.
const DESKTOP = false;

export function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  });
}

/** Reset to the desktop default installed by setupTests. */
export function restoreMatchMedia(): void {
  mockMatchMedia(DESKTOP);
}
