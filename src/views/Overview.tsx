import { useMemo } from 'react';
import { SMALL_N } from '../lib/config';
import { overview } from '../lib/metrics';
import type { OrderModel } from '../lib/types';
import { CurrentStageChart } from '../components/CurrentStageChart';
import { StatTile } from '../components/StatTile';
import { fmtDays, fmtInt, fmtPct } from '../components/format';

interface Props {
  models: OrderModel[];
  onOpenStuck: () => void;
}

export function Overview({ models, onOpenStuck }: Props) {
  const o = useMemo(() => overview(models), [models]);
  const t = o.turnaround;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Orders"
          value={fmtInt(o.orders)}
          sub={`${fmtInt(o.kitOrders)} kit · ${fmtInt(o.byProduct.upload_only)} upload-only`}
        />
        <StatTile
          label="In progress"
          value={fmtInt(o.inProgress)}
          sub="Paid kit orders, not finished"
        />
        <StatTile
          label="Finished"
          value={fmtInt(o.finished)}
          sub={`Report ready · ${fmtPct(o.finishedShare)} of kit orders`}
        />
        <StatTile
          label="Stuck"
          tone="critical"
          value={fmtInt(o.stuck)}
          sub="Over target for next stage → view list"
          onClick={onOpenStuck}
        />
        <StatTile
          label="Median turnaround"
          value={fmtDays(t.median)}
          muted={t.n < SMALL_N}
          sub={`Order → report · p90 ${fmtDays(t.p90)} · n=${fmtInt(t.n)}${t.n < SMALL_N ? ` · greyed: under ${SMALL_N} finished orders, not reliable` : ''}`}
        />
        <StatTile
          label="Refunded / cancelled"
          value={fmtInt(o.byStatus.refunded + o.byStatus.cancelled)}
          sub={`${fmtInt(o.byStatus.refunded)} refunded · ${fmtInt(o.byStatus.cancelled)} cancelled`}
        />
      </div>
      <section className="rounded-md border border-slate-200 bg-white px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Where kit orders are now</h2>
        <p className="mb-2 text-xs text-slate-500">
          Latest step on each order&apos;s active kit. Refunded / cancelled orders that never finished are shown separately in grey.
        </p>
        <CurrentStageChart rows={o.current} />
      </section>
    </div>
  );
}
