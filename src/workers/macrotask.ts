/**
 * Yields to the event loop for one task, so a message already waiting (a newer k) is delivered before the next
 * k-means iteration. A MessageChannel is used instead of setTimeout(0): timers are clamped (4 ms once nested, and
 * coarser still on some platforms), which added up to 20 clamped waits to every run.
 */
export const macrotask = (): Promise<void> =>
  new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });
