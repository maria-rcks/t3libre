/**
 * @file Reports: real report data + honest serialization (CSV, PDF).
 * No placeholders: every row comes from real data.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ReportData {
  metrics: any[];
  backups: any[];
  alerts: any[];
  generated_at: string;
  range: { since: string; until: string };
}

/** Shared report query used by both the JSON endpoint and the exports. */
export async function buildReport(
  supabase: SupabaseClient,
  userId: string,
  startDate?: string,
  endDate?: string,
): Promise<ReportData> {
  const { data: apps } = await supabase.from('docker_apps').select('id').eq('user_id', userId);
  const generated_at = new Date().toISOString();
  const since = startDate || new Date(Date.now() - 30 * 86400000).toISOString();
  const until = endDate || new Date().toISOString();
  const range = { since, until };
  if (!apps || apps.length === 0) {
    return { metrics: [], backups: [], alerts: [], generated_at, range };
  }
  const appIds = apps.map((a: any) => a.id);
  const [metricsRes, backupsRes, alertsRes] = await Promise.all([
    supabase.from('server_metrics').select('*').in('app_id', appIds).gte('recorded_at', since).lte('recorded_at', until).order('recorded_at', { ascending: false }).limit(500),
    supabase.from('backup_status').select('*, backup_jobs!inner(app_id)').in('backup_jobs.app_id', appIds).gte('started_at', since).lte('started_at', until).order('started_at', { ascending: false }).limit(500),
    supabase.from('alert_history').select('*').gte('triggered_at', since).lte('triggered_at', until).order('triggered_at', { ascending: false }).limit(500),
  ]);
  return {
    metrics: metricsRes.data || [],
    backups: backupsRes.data || [],
    alerts: alertsRes.data || [],
    generated_at,
    range,
  };
}

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize a report to RFC-4180-style CSV. */
export function reportToCsv(report: ReportData): string {
  const lines: string[] = [];
  lines.push('section,id,timestamp,cpu_pct,memory_pct,status,detail');

  const pushRow = (section: string, id: unknown, timestamp: unknown, cpu: unknown, mem: unknown, status: unknown, detail: unknown) => {
    lines.push(
      [section, csvEscape(id), csvEscape(timestamp), csvEscape(cpu), csvEscape(mem), csvEscape(status), csvEscape(detail)].join(','),
    );
  };

  for (const m of report.metrics) {
    pushRow('metric', m.id, m.recorded_at, m.cpu_pct, m.memory_pct, m.status, m.detail);
  }
  for (const b of report.backups) {
    pushRow('backup', b.id, b.started_at, '', '', b.status, `${b.size_bytes ?? ''} bytes`);
  }
  for (const a of report.alerts) {
    pushRow('alert', a.id, a.triggered_at, '', '', a.status, a.message ?? a.severity);
  }

  return lines.join('\n') + '\n';
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Build a minimal valid single-page PDF containing the report rows. */
export function reportToPdf(report: ReportData): Buffer {
  const lines: string[] = [];
  lines.push(`Infra Pilot Report`);
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Range: ${report.range.since} -> ${report.range.until}`);
  lines.push('');
  lines.push(`Metrics (${report.metrics.length})`);
  for (const m of report.metrics.slice(0, 200)) {
    lines.push(`  ${m.recorded_at}  cpu=${m.cpu_pct ?? 'n/a'}%  mem=${m.memory_pct ?? 'n/a'}%`);
  }
  lines.push('');
  lines.push(`Backups (${report.backups.length})`);
  for (const b of report.backups.slice(0, 200)) {
    lines.push(`  ${b.started_at}  ${b.status}  ${b.size_bytes ?? 'n/a'} bytes`);
  }
  lines.push('');
  lines.push(`Alerts (${report.alerts.length})`);
  for (const a of report.alerts.slice(0, 200)) {
    lines.push(`  ${a.triggered_at}  ${a.status}  ${a.message ?? a.severity ?? ''}`);
  }

  const stream: string[] = [
    '%PDF-1.4',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    'endobj',
  ];

  const content = lines
    .map((line, i) => {
      const y = 750 - i * 12;
      if (y < 50) return '';
      return `BT /F1 10 Tf ${72} ${y} Td (${escapePdfText(line)}) Tj ET`;
    })
    .filter((s) => s !== '')
    .join('\n');

  stream.push(
    '4 0 obj',
    `<< /Length ${Buffer.byteLength(content)} >>`,
    'stream',
    content,
    'endstream',
    'endobj',
    '5 0 obj',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    'endobj',
  );

  const offset = (index: number) => {
    let acc = 0;
    for (let i = 0; i < index; i++) {
      acc += Buffer.byteLength(stream[i]) + 1;
    }
    return acc;
  };

  const xrefOffset = stream.reduce((acc, line) => acc + Buffer.byteLength(line) + 1, 0);
  const xref = [
    'xref',
    `0 ${stream.length + 1}`,
    '0000000000 65535 f ',
  ];
  for (let i = 0; i < stream.length; i++) {
    xref.push(`${String(offset(i)).padStart(10, '0')} 00000 n `);
  }
  const trailer = ['trailer', `<< /Size ${stream.length + 1} /Root 1 0 R >>`, 'startxref', `${xrefOffset}`, '%%EOF'];
  return Buffer.from([...stream, ...xref, ...trailer].join('\n') + '\n', 'latin1');
}