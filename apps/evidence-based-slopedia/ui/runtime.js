(() => {
  const base = '/api/apps/evidence-based-slopedia';
  async function parse(response) {
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Gateway request failed');
    return data;
  }
  async function run(input) {
    const created = await parse(await fetch(`${base}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }));
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const events = await parse(await fetch(`/api/runs/${encodeURIComponent(created.id)}/events`, { cache: 'no-store' }));
      const finished = events.findLast((event) => ['run.failed', 'run.cancelled', 'run.completed'].includes(event.type));
      if (finished) {
        if (finished.type !== 'run.completed') throw new Error(finished.data?.message || 'ジョブの登録に失敗しました');
        return events.findLast((event) => event.type === 'result.completed')?.data?.result || {};
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Gatewayの応答がタイムアウトしました');
  }
  async function read(name, input = {}) {
    const params = new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)]));
    return parse(await fetch(`${base}/resources/${encodeURIComponent(name)}${params.size ? `?${params}` : ''}`, { cache: 'no-store' }));
  }
  async function remove(name, id) {
    return parse(await fetch(`${base}/resources/${encodeURIComponent(name)}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
  }
  globalThis.evidenceBasedSlopedia = { run, read, remove };
})();
