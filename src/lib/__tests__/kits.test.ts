import { describe, expect, it } from 'vitest';
import { clean } from '../clean';
import { buildModels } from '../kits';
import { parseCsv } from '../parse';
import type { CsvKind } from '../config';
import happyO from './fixtures/kits-happy/orders.csv?raw';
import happyE from './fixtures/kits-happy/kit_events.csv?raw';
import replO from './fixtures/kits-replacement/orders.csv?raw';
import replE from './fixtures/kits-replacement/kit_events.csv?raw';
import messyO from './fixtures/kits-messy/orders.csv?raw';
import messyE from './fixtures/kits-messy/kit_events.csv?raw';
import stuckO from './fixtures/kits-stuck/orders.csv?raw';
import stuckE from './fixtures/kits-stuck/kit_events.csv?raw';
import unlinkedO from './fixtures/kits-unlinked/orders.csv?raw';
import unlinkedE from './fixtures/kits-unlinked/kit_events.csv?raw';

function load(ordersCsv: string, eventsCsv: string) {
  const rows = (text: string, kind: CsvKind) => {
    const r = parseCsv(text, kind);
    if (!r.ok) throw new Error(r.error);
    return r.rows;
  };
  const c = clean(rows(ordersCsv, 'orders'), rows(eventsCsv, 'events'));
  const models = buildModels(c.orders, c.events, c.asOf!, c.recorder);
  const get = (id: string) => models.find((m) => m.order.orderId === id)!;
  const stage = (id: string, stageId: string, kitId?: string | null) =>
    get(id).stages.find((s) => s.stageId === stageId && (kitId === undefined || s.kitId === kitId));
  return { ...c, models, get, stage };
}

describe('kits: happy path', () => {
  it('measures every stage and completes the order', () => {
    const { get } = load(happyO, happyE);
    const m = get('ord_h');
    expect(m.state).toBe('complete');
    expect(m.stuck).toBe(false);
    expect(m.openStage).toBeUndefined();
    expect(m.stages.map((s) => [s.stageId, s.days, s.status])).toEqual([
      ['ship', 1, 'done_ok'],
      ['deliver', 3, 'done_ok'],
      ['mail', 10, 'done_ok'],
      ['receive', 5, 'done_ok'],
      ['qc', 2, 'done_ok'],
      ['sequence', 19, 'done_ok'],
      ['report', 2, 'done_ok'],
    ]);
    expect(m.turnaroundDays).toBe(42);
  });
});

describe('kits: replacement chain', () => {
  it('closes the replaced kit and measures the successor ship stage from kit_replaced', () => {
    const { get, stage } = load(replO, replE);
    const m = get('ord_r');
    expect(m.kits.map((k) => [k.kitId, k.state, k.replaces, k.replacedBy])).toEqual([
      ['kit_1', 'replaced', undefined, 'kit_2'],
      ['kit_2', 'open', 'kit_1', undefined],
    ]);
    expect(stage('ord_r', 'replace')).toMatchObject({ kitId: 'kit_1', days: 2, status: 'done_ok' });
    expect(stage('ord_r', 'ship', 'kit_2')).toMatchObject({ start: Date.UTC(2026, 2, 22), days: 4, status: 'done_over' });
    expect(m.activeKit?.kitId).toBe('kit_2');
    expect(m.openStage).toMatchObject({ stageId: 'mail', kitId: 'kit_2', status: 'open_ok' });
    expect(m.stuck).toBe(false);
  });

  it('replaced with no successor → awaiting replacement, stuck after the ship target', () => {
    const { get, stage } = load(replO, replE);
    const m = get('ord_w');
    expect(m.state).toBe('awaiting_replacement');
    expect(m.openStage).toMatchObject({ stageId: 'ship', kitId: null, start: Date.UTC(2026, 2, 5), days: 23, status: 'open_over' });
    expect(m.stuck).toBe(true);
    // The closed kit's unfinished stage is not counted as a missing scan.
    expect(stage('ord_w', 'deliver', 'kit_3')).toMatchObject({ status: 'excluded', excludedBy: 'kit_closed' });
  });
});

describe('kits: messy timelines', () => {
  it('missing scan: flags the event, excludes both affected stages, later stages still measured', () => {
    const { get, stage, report } = load(messyO, messyE);
    expect(stage('ord_m', 'mail')).toMatchObject({ status: 'excluded', excludedBy: 'missing_scan' });
    expect(stage('ord_m', 'receive')).toMatchObject({ status: 'excluded', excludedBy: 'missing_scan' });
    expect(stage('ord_m', 'qc')).toMatchObject({ days: 2, status: 'done_ok' });
    expect(get('ord_m').openStage?.stageId).toBe('sequence');
    expect(get('ord_m').kits[0]!.flags).toContain('missing_scan');
    expect(report.flagged.missing_scan.examples.filter((e) => e.row.fields.order_id === 'ord_m')).toHaveLength(1);
  });

  it('missing scan: counts each missing step, even when two gaps precede the same event', () => {
    const { events, report, stage } = load(messyO, messyE);
    const n2 = events.find((e) => e.eventId === 'n2')!;
    expect(n2.flags).toEqual(['missing_scan']);
    const details = report.flagged.missing_scan.examples.filter((e) => e.row.fields.event_id === 'n2').map((e) => e.detail);
    expect(details).toEqual([
      'kit_delivered missing before sample_received on kit kit_m2',
      'sample_mailed missing before sample_received on kit kit_m2',
    ]);
    // ord_m: 1 (no mailed) + ord_m2: 2 (no delivered, no mailed). Out-of-order ord_o adds none.
    expect(report.flagged.missing_scan.count).toBe(3);
    expect(events.filter((e) => e.orderId === 'ord_o').some((e) => e.flags.includes('missing_scan'))).toBe(false);
    expect(stage('ord_m2', 'deliver')).toMatchObject({ status: 'excluded', excludedBy: 'missing_scan' });
  });

  it('repeated stage uses the first occurrence; out-of-order excludes affected stages', () => {
    const { get, stage, events } = load(messyO, messyE);
    const flags = (id: string) => events.find((e) => e.eventId === id)!.flags;
    expect(flags('o3')).toContain('repeated_stage');
    expect(flags('o5')).toContain('out_of_order');
    expect(stage('ord_o', 'deliver')).toMatchObject({ days: 2, status: 'done_ok' });
    expect(stage('ord_o', 'mail')).toMatchObject({ status: 'excluded', excludedBy: 'out_of_order' });
    expect(stage('ord_o', 'receive')).toMatchObject({ status: 'excluded', excludedBy: 'out_of_order' });
    expect(get('ord_o').openStage?.stageId).toBe('qc'); // current stage = furthest step reached
  });

  it('events after kit_replaced are kept and flagged; the kit stays closed', () => {
    const { get, events } = load(messyO, messyE);
    expect(events.find((e) => e.eventId === 'a3')!.flags).toContain('event_after_replaced');
    expect(get('ord_a').kits[0]!.state).toBe('replaced');
    expect(get('ord_a').state).toBe('awaiting_replacement');
  });
});

describe('kits: unlinked kit', () => {
  it('flags both kits when a later kit has no kit_replaced link; newest kit is active', () => {
    const { get, stage, events, report } = load(unlinkedO, unlinkedE);
    const flags = (id: string) => events.find((e) => e.eventId === id)!.flags;
    expect(flags('u1')).toContain('unlinked_kit');
    expect(flags('u3')).toContain('unlinked_kit');
    expect(report.flagged.unlinked_kit.count).toBe(2);
    const m = get('ord_u');
    expect(m.activeKit?.kitId).toBe('kit_u2');
    expect(m.kits.every((k) => k.flags.includes('unlinked_kit'))).toBe(true);
    expect(stage('ord_u', 'ship', 'kit_u2')).toMatchObject({ start: Date.UTC(2026, 0, 1), days: 9 });
    // Control: a proper replacement chain is not flagged.
    expect(get('ord_c').kits.flatMap((k) => k.flags)).toEqual([]);
  });
});

describe('kits: stuck', () => {
  it('only paid, non-test kit orders over target are stuck', () => {
    const { get } = load(stuckO, stuckE);
    expect(get('ord_noev')).toMatchObject({ state: 'awaiting_shipment', stuck: true });
    expect(get('ord_noev').openStage).toMatchObject({ stageId: 'ship', days: 19 });
    expect(get('ord_refund').stuck).toBe(false);
    expect(get('ord_cancel').stuck).toBe(false);
    expect(get('ord_refund').inPipelineStats).toBe(false);
    expect(get('ord_test').stuck).toBe(false);
    expect(get('ord_up')).toMatchObject({ state: 'not_in_pipeline', stuck: false, stages: [] });
    expect(get('ord_fresh').stuck).toBe(false); // 1 day, within 3-day target
    expect(get('ord_cust')).toMatchObject({ stuck: true });
    expect(get('ord_cust').openStage).toMatchObject({ stageId: 'mail', days: 80 });
    expect(get('ord_ok').stuck).toBe(false);
  });
});
