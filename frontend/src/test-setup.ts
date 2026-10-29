// Node 26 exposes a non-functional global localStorage/sessionStorage unless
// --localstorage-file is passed. Vitest copies those undefined values over
// jsdom's own storage, so restore them from the underlying jsdom window.
const domWindow = (globalThis as { jsdom?: { window?: Window } }).jsdom?.window;

for (const name of ["localStorage", "sessionStorage"] as const) {
  if (typeof window === "undefined" || globalThis[name]) continue;
  const storage = domWindow?.[name];
  if (storage) {
    Object.defineProperty(globalThis, name, {
      value: storage,
      configurable: true,
    });
  }
}
