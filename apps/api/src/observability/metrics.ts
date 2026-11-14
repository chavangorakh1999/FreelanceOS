/** A small in-process registry in the Prometheus text format. No dependency, bounded cardinality (routes are patterns). */
const BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

class Registry {
  private counts = new Map<string, number>();
  private hist = new Map<string, { buckets: number[]; sum: number; count: number }>();

  observe(method: string, route: string, status: number, seconds: number) {
    const k = `method="${method}",route="${route}",status="${status}"`;
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
    const hk = `method="${method}",route="${route}"`;
    const h = this.hist.get(hk) ?? { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
    BUCKETS.forEach((b, i) => { if (seconds <= b) h.buckets[i]! += 1; });
    h.sum += seconds; h.count += 1;
    this.hist.set(hk, h);
  }

  render(gauges: Record<string, number>): string {
    const out: string[] = ['# TYPE http_requests_total counter'];
    for (const [k, v] of this.counts) out.push(`http_requests_total{${k}} ${v}`);
    out.push('# TYPE http_request_duration_seconds histogram');
    for (const [k, h] of this.hist) {
      BUCKETS.forEach((b, i) => out.push(`http_request_duration_seconds_bucket{${k},le="${b}"} ${h.buckets[i]}`));
      out.push(`http_request_duration_seconds_bucket{${k},le="+Inf"} ${h.count}`, `http_request_duration_seconds_sum{${k}} ${h.sum.toFixed(6)}`, `http_request_duration_seconds_count{${k}} ${h.count}`);
    }
    for (const [name, v] of Object.entries(gauges)) out.push(`# TYPE ${name} gauge`, `${name} ${v}`);
    out.push('# TYPE process_resident_memory_bytes gauge', `process_resident_memory_bytes ${process.memoryUsage().rss}`);
    out.push('# TYPE process_uptime_seconds gauge', `process_uptime_seconds ${Math.round(process.uptime())}`);
    return out.join('\n') + '\n';
  }
}
export const metrics = new Registry();
