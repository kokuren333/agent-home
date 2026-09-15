export function createApp() {
  return {
    async run(input, { emit, signal }) {
      if (signal.aborted) return;
      emit('message.delta', { text: `Hello from ${input?.name || 'demo-app'}!` });
      emit('message.completed', { result: { ok: true, app: 'demo-app' } });
    },
    async resources() { return { status: 404, data: { error: { code: 'not_found', message: 'This demo has no resources.' } } }; }
  };
}
