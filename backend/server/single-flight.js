// Share work only while an identical request is already in progress.
// Completed values are never cached, so callers always revalidate later.
export function createSingleFlight() {
  const inFlight = new Map();
  return (key, work) => {
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = Promise.resolve().then(work);
    inFlight.set(key, promise);
    return promise.finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
  };
}
