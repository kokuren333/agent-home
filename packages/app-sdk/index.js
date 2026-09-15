/** Small helpers for app authors. The gateway only relies on this stable shape. */
export function defineApp({ manifest, createApp }) {
  return { manifest, createApp };
}

export function event(type, data = {}) { return { type, data }; }
