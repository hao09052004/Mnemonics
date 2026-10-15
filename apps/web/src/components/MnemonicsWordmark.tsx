/**
 * Mnemonics wordmark — a tiny lockup used in the header / footer /
 * auth surface. Kept as its own component because three places
 * already use it and we want one place to evolve the brand mark.
 */
export function MnemonicsWordmark({ size = 32 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <img
        src="/logo.png"
        alt="Mnemonics"
        width={size}
        height={size}
        style={{ borderRadius: '50%', display: 'block', objectFit: 'contain' }}
      />
      <span>Mnemonics</span>
    </span>
  );
}
