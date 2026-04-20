export default function ChesscomIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#769656" />
      <rect x="3" y="3" width="9" height="9" fill="#EEEED2" />
      <rect x="12" y="12" width="9" height="9" fill="#EEEED2" />
    </svg>
  );
}
