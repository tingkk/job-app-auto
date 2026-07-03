Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: () => '00000000-0000-4000-8000-000000000000'
  },
  configurable: true
});

if (!globalThis.CSS) {
  Object.defineProperty(globalThis, 'CSS', {
    value: {
      escape: (value: string) => value.replace(/["\\]/g, '\\$&')
    }
  });
}
