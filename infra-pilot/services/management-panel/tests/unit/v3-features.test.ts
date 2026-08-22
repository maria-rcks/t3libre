import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// We test the API client methods and type definitions for v3 frontend features
import { apiClient } from '../../src/lib/api.ts';
import type {
  TopoNode,
  TopoEdge,
  HeatmapDataPoint,
  GeoRegion,
  CostBreakdown,
  Budget,
  SavingsRecommendation,
  KpiSummary,
  ChurnAnalysis,
  LTVSegment,
  CACMetrics,
  AcquisitionChannel,
  RevenueBreakdown,
  CohortData,
  DependencyNode,
  DependencyEdge,
  ImpactAnalysis,
  ReportDesign,
  ReportSchedule,
  ReportDelivery,
  ReportTemplate,
} from '../../src/lib/types.ts';

describe('v3 feature types', () => {
  it('TopoNode has correct shape', () => {
    const node: TopoNode = {
      id: 'test-1',
      name: 'Test Server',
      type: 'server',
      status: 'running',
      metrics: { cpu: 50, memory: 60, load: 1.2 },
      position: { x: 0, y: 0, z: 0 },
      metadata: { region: 'us-east' },
    };
    assert.equal(node.id, 'test-1');
    assert.equal(node.type, 'server');
    assert.equal(node.metrics.cpu, 50);
  });

  it('TopoEdge has correct shape', () => {
    const edge: TopoEdge = {
      id: 'e1',
      source: 'n1',
      target: 'n2',
      type: 'network',
      status: 'up',
      metrics: { latency: 5, throughput: 1000 },
    };
    assert.equal(edge.source, 'n1');
    assert.equal(edge.target, 'n2');
  });

  it('HeatmapDataPoint has correct shape', () => {
    const point: HeatmapDataPoint = {
      lat: 40.7128,
      lng: -74.006,
      intensity: 0.85,
      region: 'us-east',
      date: '2026-05-01',
      count: 1500,
    };
    assert.equal(point.region, 'us-east');
    assert.equal(point.count, 1500);
  });

  it('GeoRegion has correct shape', () => {
    const region: GeoRegion = {
      id: 'us-east',
      name: 'US East',
      lat: 37.09,
      lng: -95.71,
      count: 5000,
      status: 'active',
    };
    assert.equal(region.status, 'active');
  });

  it('CostBreakdown has correct shape', () => {
    const cb: CostBreakdown = {
      categories: [
        { category: 'Compute', amount: 5000, percentage: 50 },
        { category: 'Storage', amount: 3000, percentage: 30 },
      ],
      total: 10000,
      currency: 'USD',
    };
    assert.equal(cb.categories.length, 2);
    assert.equal(cb.total, 10000);
  });

  it('Budget has correct shape', () => {
    const b: Budget = {
      id: 'b1',
      name: 'Q2 Budget',
      limit: 50000,
      spent: 35000,
      period: 'monthly',
      alert_threshold: 80,
    };
    assert.equal(b.alert_threshold, 80);
  });

  it('SavingsRecommendation has correct shape', () => {
    const r: SavingsRecommendation = {
      id: 'r1',
      title: 'Downsize idle instances',
      potential_savings: 1200,
      effort: 'medium',
      category: 'compute',
    };
    assert.equal(r.potential_savings, 1200);
  });

  it('KpiSummary has correct shape', () => {
    const kpi: KpiSummary = {
      mrr: 150000,
      arr: 1800000,
      ltv: 4500,
      cac: 1200,
      churn: 3.5,
      activeCustomers: 1200,
    };
    assert.equal(kpi.mrr, 150000);
    assert.equal(kpi.churn, 3.5);
  });

  it('ChurnAnalysis has correct shape', () => {
    const ca: ChurnAnalysis = {
      rate: 3.5,
      trends: [{ month: '2026-01', rate: 3.2 }],
      reasons: [{ reason: 'Price', percentage: 40 }],
    };
    assert.equal(ca.reasons[0].percentage, 40);
  });

  it('LTVSegment has correct shape', () => {
    const seg: LTVSegment = {
      segment: 'Enterprise',
      average_ltv: 15000,
      count: 50,
      percentage: 25,
    };
    assert.equal(seg.segment, 'Enterprise');
  });

  it('CACMetrics has correct shape', () => {
    const cac: CACMetrics = {
      total: 120000,
      byChannel: [{ channel: 'Organic', cost: 30000, customers: 100 }],
    };
    assert.equal(cac.byChannel[0].channel, 'Organic');
  });

  it('AcquisitionChannel has correct shape', () => {
    const ac: AcquisitionChannel = {
      channel: 'Paid Search',
      visitors: 50000,
      conversions: 2500,
      cost: 40000,
    };
    assert.equal(ac.conversions, 2500);
  });

  it('RevenueBreakdown has correct shape', () => {
    const rb: RevenueBreakdown = {
      category: 'SaaS',
      amount: 100000,
      percentage: 60,
    };
    assert.equal(rb.percentage, 60);
  });

  it('CohortData has correct shape', () => {
    const cd: CohortData = {
      cohort: '2026-01',
      periods: [{ month: 1, retention: 80 }],
    };
    assert.equal(cd.periods[0].retention, 80);
  });

  it('DependencyNode has correct shape', () => {
    const dn: DependencyNode = {
      id: 'svc-1',
      name: 'Auth Service',
      type: 'service',
      status: 'healthy',
      metrics: { cpu: 45, memory: 60, latency: 10 },
    };
    assert.equal(dn.status, 'healthy');
  });

  it('DependencyEdge has correct shape', () => {
    const de: DependencyEdge = {
      id: 'de-1',
      source: 'svc-1',
      target: 'svc-2',
      type: 'grpc',
      status: 'healthy',
    };
    assert.equal(de.type, 'grpc');
  });

  it('ImpactAnalysis has correct shape', () => {
    const ia: ImpactAnalysis = {
      nodeId: 'svc-1',
      affected: ['svc-2', 'svc-3'],
      severity: 'high',
    };
    assert.equal(ia.severity, 'high');
    assert.equal(ia.affected.length, 2);
  });

  it('ReportDesign has correct shape', () => {
    const rd: ReportDesign = {
      id: 'design-1',
      name: 'Weekly Summary',
      widgets: [{ type: 'kpi', title: 'Uptime', dataSource: 'status' }],
      schedule: '0 9 * * 1',
      createdAt: '2026-01-01T00:00:00Z',
    };
    assert.equal(rd.widgets.length, 1);
    assert.equal(rd.widgets[0].type, 'kpi');
  });

  it('ReportSchedule has correct shape', () => {
    const rs: ReportSchedule = {
      id: 'sched-1',
      designId: 'design-1',
      cron: '0 8 * * *',
      channel: 'email',
      enabled: true,
    };
    assert.equal(rs.enabled, true);
  });

  it('ReportDelivery has correct shape', () => {
    const rd: ReportDelivery = {
      id: 'del-1',
      designId: 'design-1',
      status: 'delivered',
      channel: 'email',
      deliveredAt: '2026-05-01T08:00:00Z',
    };
    assert.equal(rd.status, 'delivered');
  });

  it('ReportTemplate has correct shape', () => {
    const rt: ReportTemplate = {
      id: 'executive-summary',
      name: 'Executive Summary',
      category: 'business',
    };
    assert.equal(rt.category, 'business');
  });
});

describe('v3 API methods exist', () => {
  it('apiClient has generic HTTP methods', () => {
    assert.equal(typeof apiClient.get, 'function');
    assert.equal(typeof apiClient.post, 'function');
    assert.equal(typeof apiClient.put, 'function');
    assert.equal(typeof apiClient.delete, 'function');
  });

  it('topology methods exist', () => {
    assert.equal(typeof apiClient.getTopologyNodes, 'function');
    assert.equal(typeof apiClient.getTopologyEdges, 'function');
  });

  it('geo heatmap methods exist', () => {
    assert.equal(typeof apiClient.getHeatmapData, 'function');
    assert.equal(typeof apiClient.getGeoRegions, 'function');
    assert.equal(typeof apiClient.getTopCities, 'function');
    assert.equal(typeof apiClient.getGeoFilterOptions, 'function');
    assert.equal(typeof apiClient.getGeoTimelapse, 'function');
  });

  it('cost analytics methods exist', () => {
    assert.equal(typeof apiClient.getCostBreakdown, 'function');
    assert.equal(typeof apiClient.getCostTrends, 'function');
    assert.equal(typeof apiClient.getUnitEconomics, 'function');
    assert.equal(typeof apiClient.getBudgets, 'function');
    assert.equal(typeof apiClient.getSavingsRecommendations, 'function');
    assert.equal(typeof apiClient.getCostForecast, 'function');
    assert.equal(typeof apiClient.createBudget, 'function');
  });

  it('BI dashboard methods exist', () => {
    assert.equal(typeof apiClient.getKpiSummary, 'function');
    assert.equal(typeof apiClient.getMRR, 'function');
    assert.equal(typeof apiClient.getARR, 'function');
    assert.equal(typeof apiClient.getChurnAnalysis, 'function');
    assert.equal(typeof apiClient.getLTVSegments, 'function');
    assert.equal(typeof apiClient.getCACMetrics, 'function');
    assert.equal(typeof apiClient.getAcquisitionChannels, 'function');
    assert.equal(typeof apiClient.getRevenueBreakdown, 'function');
    assert.equal(typeof apiClient.getRevenueForecasts, 'function');
    assert.equal(typeof apiClient.getCohortData, 'function');
  });

  it('dependency graph methods exist', () => {
    assert.equal(typeof apiClient.getDependencyGraph, 'function');
    assert.equal(typeof apiClient.getImpactAnalysis, 'function');
    assert.equal(typeof apiClient.discoverDependencies, 'function');
  });

  it('report builder methods exist', () => {
    assert.equal(typeof apiClient.listReportDesigns, 'function');
    assert.equal(typeof apiClient.createReportDesign, 'function');
    assert.equal(typeof apiClient.updateReportDesign, 'function');
    assert.equal(typeof apiClient.deleteReportDesign, 'function');
    assert.equal(typeof apiClient.generateReportNow, 'function');
    assert.equal(typeof apiClient.listReportSchedules, 'function');
    assert.equal(typeof apiClient.createReportSchedule, 'function');
    assert.equal(typeof apiClient.deleteReportSchedule, 'function');
    assert.equal(typeof apiClient.listReportDeliveries, 'function');
    assert.equal(typeof apiClient.getReportTemplates, 'function');
  });
});
