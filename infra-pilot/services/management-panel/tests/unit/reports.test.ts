import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildReport, reportToCsv, reportToPdf } from '../../server/reports.ts';

const fakeSupabase = {
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        gte: () => ({
          lte: () => ({
            order: () => ({
              limit: async () =>
                table === 'docker_apps'
                  ? { data: [{ id: 'app-1' }], error: null }
                  : table === 'server_metrics'
                    ? { data: [{ id: 1, recorded_at: '2026-08-01T00:00:00Z', cpu_pct: 12.5, memory_pct: 44 }], error: null }
                    : table === 'backup_status'
                      ? { data: [{ id: 1, started_at: '2026-08-01T00:00:00Z', status: 'success', size_bytes: 1024 }], error: null }
                      : { data: [{ id: 1, triggered_at: '2026-08-01T00:00:00Z', status: 'firing', message: 'cpu high' }], error: null },
            }),
          }),
        }),
      }),
    }),
  }),
} as any;

describe('reports module', () => {
  it('builds a report with real rows', async () => {
    const report = await buildReport(fakeSupabase, 'user-1');
    assert.equal(report.metrics.length, 1);
    assert.equal(report.backups.length, 1);
    assert.equal(report.alerts.length, 1);
    assert.ok(report.generated_at);
  });

  it('returns empty rows when the user has no apps', async () => {
    const empty = {
      from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
    } as any;
    const report = await buildReport(empty, 'user-1');
    assert.deepEqual(report.metrics, []);
    assert.deepEqual(report.backups, []);
    assert.deepEqual(report.alerts, []);
  });

  it('serializes to csv with a header and data rows', () => {
    const csv = reportToCsv({
      metrics: [{ id: 1, recorded_at: '2026-08-01T00:00:00Z', cpu_pct: 12.5, memory_pct: 44 }],
      backups: [],
      alerts: [],
      generated_at: '2026-08-13T00:00:00Z',
      range: { since: 's', until: 'u' },
    });
    const lines = csv.trim().split('\n');
    assert.match(lines[0], /section,id,timestamp/);
    assert.match(lines[1], /^metric,1,2026-08-01T00:00:00Z,12\.5,44,,$/);
  });

  it('escapes commas and quotes in csv cells', () => {
    const csv = reportToCsv({
      metrics: [],
      backups: [],
      alerts: [{ id: 1, triggered_at: 't', status: 'firing', message: 'high, "load"' }],
      generated_at: 'g',
      range: { since: 's', until: 'u' },
    });
    assert.match(csv, /"high, ""load"""/);
  });

  it('generates a valid pdf header and non-empty content', () => {
    const pdf = reportToPdf({
      metrics: [{ id: 1, recorded_at: '2026-08-01T00:00:00Z', cpu_pct: 12.5 }],
      backups: [],
      alerts: [],
      generated_at: '2026-08-13T00:00:00Z',
      range: { since: 's', until: 'u' },
    });
    const text = pdf.toString('latin1');
    assert.match(text, /%PDF-1\.4/);
    assert.match(text, /Infra Pilot Report/);
    assert.match(text, /%%EOF/);
  });
});