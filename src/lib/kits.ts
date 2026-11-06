import {
  EVENT_RANK,
  KIT_PRODUCTS,
  MS_PER_DAY,
  NEXT_STAGE_AFTER,
  OPTIONAL_START_STAGES,
  PIPELINE_STEPS,
  STAGES,
  STAGE_BY_ID,
  type EventType,
  type StageDef,
  type StageId,
} from './config';
import type { QualityRecorder } from './clean';
import type { FlagReason, Kit, KitEvent, Order, OrderModel, StageInstance, StageStatus } from './types';

const days = (from: number, to: number) => (to - from) / MS_PER_DAY;

const byTime = (a: KitEvent, b: KitEvent) =>
  a.at - b.at || EVENT_RANK[a.type] - EVENT_RANK[b.type] || a.raw.row - b.raw.row;

interface KitBuild {
  kit: Kit;
  /** First occurrence of each type: the events that drive stage timing. */
  firstEvent: Partial<Record<EventType, KitEvent>>;
  /** Event types that arrived after a later pipeline step. */
  outOfOrder: Set<EventType>;
}

function buildKit(kitId: string, orderId: string, evs: KitEvent[], q: QualityRecorder): KitBuild {
  const events = [...evs].sort(byTime);
  const firstEvent: Partial<Record<EventType, KitEvent>> = {};
  const outOfOrder = new Set<EventType>();
  let maxRank = 0;

  for (const ev of events) {
    if (firstEvent.kit_replaced) {
      q.flag('events', ev, 'event_after_replaced', `kit ${kitId} was replaced earlier`);
      continue;
    }
    if (firstEvent[ev.type]) {
      q.flag('events', ev, 'repeated_stage', `${ev.type} already seen on kit ${kitId}`);
      continue;
    }
    if (ev.type !== 'kit_replaced') {
      const rank = EVENT_RANK[ev.type];
      if (rank < maxRank) {
        q.flag('events', ev, 'out_of_order', `${ev.type} arrived after a later step on kit ${kitId}`);
        outOfOrder.add(ev.type);
      }
      maxRank = Math.max(maxRank, rank);
    }
    firstEvent[ev.type] = ev;
  }

  const used = Object.values(firstEvent) as KitEvent[];

  // Missing scans: one flag per absent step below the furthest step reached, on the first event after the gap.
  const pipelineEvents = used.filter((e) => e.type !== 'kit_replaced').sort(byTime);
  for (const step of PIPELINE_STEPS) {
    const rank = EVENT_RANK[step[0]!];
    if (rank >= maxRank || step.some((t) => firstEvent[t])) continue;
    const after = pipelineEvents.find((e) => EVENT_RANK[e.type] > rank)!;
    const missing = step.join(' / ');
    q.flag('events', after, 'missing_scan', `${missing} missing before ${after.type} on kit ${kitId}`, missing);
  }
  const lastEvent = used.reduce((best, ev) =>
    EVENT_RANK[ev.type] > EVENT_RANK[best.type] ||
    (EVENT_RANK[ev.type] === EVENT_RANK[best.type] && ev.at > best.at)
      ? ev
      : best,
  );
  const firstAt: Kit['firstAt'] = {};
  for (const ev of used) firstAt[ev.type] = ev.at;

  return {
    kit: {
      kitId,
      orderId,
      events,
      firstAt,
      state: firstAt.kit_replaced !== undefined ? 'replaced' : firstAt.report_ready !== undefined ? 'complete' : 'open',
      lastEvent,
      flags: [],
    },
    firstEvent,
    outOfOrder,
  };
}

function openInstance(stage: StageDef, kitId: string | null, start: number, asOf: number): StageInstance {
  // Starts after the data date (e.g. order created after asOf): not started yet, no days, not open.
  if (start > asOf) return { stageId: stage.id, kitId, start, status: 'excluded', excludedBy: 'starts_after_asof' };
  const d = days(start, asOf);
  return { stageId: stage.id, kitId, start, days: d, status: d > stage.targetDays ? 'open_over' : 'open_ok' };
}

function kitStages(b: KitBuild, shipStart: number, isActive: boolean, asOf: number): StageInstance[] {
  const { kit, firstEvent, outOfOrder } = b;
  const waitingOn: StageId | null = kit.state === 'open' && isActive ? NEXT_STAGE_AFTER[kit.lastEvent.type] : null;
  const out: StageInstance[] = [];

  for (const stage of STAGES) {
    const start = stage.start === null ? shipStart : kit.firstAt[stage.start];
    const endEvent = stage.end
      .map((t) => firstEvent[t])
      .filter((e): e is KitEvent => e !== undefined)
      .sort(byTime)[0];
    const base = { stageId: stage.id, kitId: kit.kitId };

    if (start === undefined && endEvent === undefined) continue;

    if (start === undefined) {
      if (OPTIONAL_START_STAGES.includes(stage.id)) continue;
      out.push({ ...base, end: endEvent!.at, status: 'excluded', excludedBy: 'missing_scan' });
      continue;
    }

    if (endEvent === undefined) {
      if (waitingOn === stage.id) out.push(openInstance(stage, kit.kitId, start, asOf));
      else if (kit.state === 'replaced') out.push({ ...base, start, status: 'excluded', excludedBy: 'kit_closed' });
      else if (kit.state === 'complete' || isActive) out.push({ ...base, start, status: 'excluded', excludedBy: 'missing_scan' });
      continue;
    }

    const end = endEvent.at;
    const d = days(start, end);
    let status: StageStatus = d > stage.targetDays ? 'done_over' : 'done_ok';
    let excludedBy: StageInstance['excludedBy'];
    if ((stage.start && outOfOrder.has(stage.start)) || outOfOrder.has(endEvent.type)) excludedBy = 'out_of_order';
    else if (d < 0) excludedBy = 'negative_duration';
    if (excludedBy) status = 'excluded';
    out.push({ ...base, start, end, days: d, status, ...(excludedBy ? { excludedBy } : {}) });
  }
  return out;
}

/**
 * Orders + cleaned events → one model per order: kit chain, stage instances,
 * current state and stuck status. Deterministic given (orders, events, asOf).
 * Kit-level flags (repeated, out-of-order, missing scan, after-replaced) are
 * recorded through the same recorder as clean.ts.
 */
export function buildModels(orders: Order[], events: KitEvent[], asOf: number, q: QualityRecorder): OrderModel[] {
  const byOrder = new Map<string, Map<string, KitEvent[]>>();
  for (const ev of events) {
    let kits = byOrder.get(ev.orderId);
    if (!kits) byOrder.set(ev.orderId, (kits = new Map()));
    const list = kits.get(ev.kitId);
    if (list) list.push(ev);
    else kits.set(ev.kitId, [ev]);
  }

  return orders.map((order) => {
    const inPipelineStats = order.status === 'paid' && KIT_PRODUCTS.includes(order.product);
    const base = { order, inPipelineStats, stuck: false };
    if (!KIT_PRODUCTS.includes(order.product)) {
      return { ...base, kits: [], state: 'not_in_pipeline', stages: [] } satisfies OrderModel;
    }

    const builds = [...(byOrder.get(order.orderId) ?? new Map<string, KitEvent[]>())]
      .map(([kitId, evs]) => buildKit(kitId, order.orderId, evs, q))
      .sort((a, b) => byTime(a.kit.events[0]!, b.kit.events[0]!));

    // Replacement chain: successor = next unlinked kit whose first event is after kit_replaced.
    for (let i = 0; i < builds.length; i++) {
      const prev = builds[i]!.kit;
      const replacedAt = prev.firstAt.kit_replaced;
      if (replacedAt === undefined) continue;
      const next = builds.slice(i + 1).find((b) => !b.kit.replaces && b.kit.events[0]!.at > replacedAt);
      if (next) {
        prev.replacedBy = next.kit.kitId;
        next.kit.replaces = prev.kitId;
      }
    }
    // A later kit with no kit_replaced predecessor breaks the replacement rule: flag it and the kit before it.
    for (let i = 1; i < builds.length; i++) {
      const kit = builds[i]!.kit;
      if (kit.replaces) continue;
      const prev = builds[i - 1]!.kit;
      q.flag('events', kit.events[0]!, 'unlinked_kit', `kit ${kit.kitId} follows ${prev.kitId} with no kit_replaced link`);
      q.flag('events', prev.events[0]!, 'unlinked_kit', `kit ${prev.kitId} is followed by ${kit.kitId} with no kit_replaced link`);
    }
    const kitById = new Map(builds.map((b) => [b.kit.kitId, b.kit]));

    const stages: StageInstance[] = [];
    builds.forEach((b, i) => {
      const pred = b.kit.replaces ? kitById.get(b.kit.replaces) : undefined;
      const shipStart = pred?.firstAt.kit_replaced ?? order.createdAt;
      stages.push(...kitStages(b, shipStart, i === builds.length - 1, asOf));
    });

    const kits = builds.map((b) => b.kit);
    for (const kit of kits) kit.flags = [...new Set(kit.events.flatMap((e) => e.flags))] as FlagReason[];
    const activeKit = kits[kits.length - 1];
    const ship = STAGE_BY_ID.ship;

    let state: OrderModel['state'];
    let openStage: StageInstance | undefined;
    if (!activeKit) {
      state = 'awaiting_shipment';
      openStage = openInstance(ship, null, order.createdAt, asOf);
      stages.push(openStage);
    } else if (activeKit.state === 'replaced') {
      state = 'awaiting_replacement';
      openStage = openInstance(ship, null, activeKit.firstAt.kit_replaced!, asOf);
      stages.push(openStage);
    } else if (activeKit.state === 'complete') {
      state = 'complete';
    } else {
      state = 'in_progress';
      openStage = stages.find((s) => s.kitId === activeKit.kitId && s.status.startsWith('open'));
    }

    const reportAt = activeKit?.state === 'complete' ? activeKit.firstAt.report_ready : undefined;
    const lastEventAt = kits.length ? Math.max(...kits.flatMap((k) => k.events.map((e) => e.at))) : undefined;

    return {
      ...base,
      kits,
      activeKit,
      state,
      stages,
      openStage,
      lastEventAt,
      turnaroundDays: reportAt !== undefined ? days(order.createdAt, reportAt) : undefined,
      stuck: inPipelineStats && !order.isTest && openStage?.status === 'open_over',
    } satisfies OrderModel;
  });
}
