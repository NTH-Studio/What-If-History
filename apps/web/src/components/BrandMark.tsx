export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      className="brand-mark"
      width={size}
      height={size}
      src="/what-if-history-mark-v2.png"
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  );
}
