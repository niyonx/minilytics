// 24h traffic line with a bar per payment (DataFast-style). Bar height follows the payment's amount relative to
// `maxAmount`, which the caller shares across cards so bars compare between sites.
const W = 300;
const H = 80;
const PAD = 4;

function smoothPath(pts: [number, number][]): string {
  // Monotone cubic (Fritsch–Carlson): smooth, and never overshoots below zero or above a peak.
  const n = pts.length;
  if (n < 2) return '';
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i][0]);
  const m = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / dx[i]);
  const t = pts.map((_, i) => (i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2));
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

export function Sparkline({
  series,
  payments,
  maxAmount,
  money,
  id,
}: {
  series: number[];
  payments: { at: number; amount: number }[];
  maxAmount: number;
  money: (minor: number) => string;
  id: string;
}) {
  const peak = Math.max(1, ...series);
  const step = (W - PAD * 2) / Math.max(1, series.length - 1);
  const pts = series.map((v, i) => [PAD + i * step, H - PAD - (v / peak) * (H - PAD * 2 - 6)] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z`;
  const barW = 7;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-20 w-full overflow-visible" role="img" aria-label="Visitors and payments in the last 24 hours">
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8dbdf0" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#8dbdf0" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#fill-${id})`} />
      <path d={line} fill="none" stroke="#8dbdf0" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {payments.map((p, i) => {
        const h = 10 + (Math.max(0, p.amount) / Math.max(1, maxAmount)) * (H - 14);
        const x = Math.min(W - barW, Math.max(0, PAD + (p.at / 24) * (W - PAD * 2) - barW / 2));
        return (
          <rect key={i} x={x} y={H - h} width={barW} height={h} rx="1.5" fill="#e07b5f">
            <title>{money(p.amount)}</title>
          </rect>
        );
      })}
    </svg>
  );
}
