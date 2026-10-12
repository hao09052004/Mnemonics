/**
 * Mnemonics wordmark — a tiny lockup used in the header / footer /
 * auth surface. Kept as its own component because three places
 * already use it and we want one place to evolve the brand mark.
 */
export function MnemonicsWordmark({ size = 28 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="14" cy="14" r="14" fill="#5b3fe4" />
        <path
          d="M9 7 H19 V22 L14 18 L9 22 Z"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <text
          x="14"
          y="17"
          fontFamily="system-ui,sans-serif"
          fontSize="8"
          fontWeight={800}
          fill="#fff"
          textAnchor="middle"
        >
          M
        </text>
        <circle cx="21" cy="7" r="4" fill="#a78bfa" />
      </svg>
      <span>Mnemonics</span>
    </span>
  );
}
