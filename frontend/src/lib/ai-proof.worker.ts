// A bounded proof of work slows scripted session creation without blocking the UI.
self.onmessage = async (event: MessageEvent<string>) => {
  try {
    if (typeof event.data !== 'string' || event.data.length > 1500) throw new Error();
    const encoder = new TextEncoder(), deadline = Date.now() + 20000;
    for (let counter = 0; counter < 2000000 && Date.now() < deadline; counter++) {
      const solution = counter.toString(16);
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${event.data}:${solution}`)));
      if (hash[0] === 0 && hash[1] === 0) { self.postMessage({ solution }); return; }
    }
    self.postMessage({ error: 'The browser check timed out. Retry the AI connection.' });
  } catch { self.postMessage({ error: 'The browser check could not run. Retry the AI connection.' }); }
};
export {};
