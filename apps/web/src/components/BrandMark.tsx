export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <circle className="brand-mark-ring" cx="32" cy="32" r="27" strokeWidth="3" />
      <path
        className="brand-mark-map"
        d="M7 32h50M32 5c-8 8-12 17-12 27s4 19 12 27"
        strokeWidth="2.5"
      />
      <path className="brand-mark-map" d="M32 5c8 8 12 17 12 27" strokeWidth="2.5" />
      <path
        className="brand-mark-branch"
        d="M44 32c0 8 4 16 12 23M44 32c4 5 9 8 15 10"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle className="brand-mark-node" cx="44" cy="32" r="3.5" />
    </svg>
  );
}
