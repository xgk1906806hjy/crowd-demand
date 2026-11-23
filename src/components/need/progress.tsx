/** 承诺进度条，入参为百分比（0-100+）。 */
export function Progress({ value }: { value: number }) {
  const width = Math.min(100, Math.max(0, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-emerald-500 transition-all"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
