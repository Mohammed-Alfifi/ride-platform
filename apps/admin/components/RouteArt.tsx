/** A morning pick-up route drawn across a street grid: the dashboard's one illustrative moment. */
const STOPS: Array<[number, number, number]> = [
  // x, y, delay (s) - the delay follows the line as it draws
  [80, 520, 0.3],
  [240, 520, 0.8],
  [240, 330, 1.2],
  [430, 330, 1.6],
  [430, 150, 2.1],
];

export function RouteArt() {
  return (
    <svg viewBox="0 0 520 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g stroke="#22344a" strokeWidth="1">
        {[60, 150, 240, 330, 430].map((x) => (
          <line key={`v${x}`} x1={x} y1="0" x2={x} y2="640" />
        ))}
        {[60, 150, 240, 330, 420, 520, 600].map((y) => (
          <line key={`h${y}`} x1="0" y1={y} x2="520" y2={y} />
        ))}
      </g>
      <path
        className="route-path"
        d="M80 520 H240 V330 H430 V150"
        fill="none"
        stroke="#3fbf8f"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {STOPS.map(([x, y, delay], i) => {
        const last = i === STOPS.length - 1;
        return (
          <g key={i} className="route-stop" style={{ animationDelay: `${delay + 0.4}s` }}>
            {last && <circle cx={x} cy={y} r="16" fill="none" stroke="#3fbf8f" strokeOpacity="0.35" strokeWidth="6" />}
            <circle cx={x} cy={y} r={last ? 9 : 7} fill={last ? '#3fbf8f' : '#18263a'} stroke="#3fbf8f" strokeWidth="3" />
          </g>
        );
      })}
    </svg>
  );
}
