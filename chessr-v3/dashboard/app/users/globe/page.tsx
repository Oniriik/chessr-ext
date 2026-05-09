import { GlobePageClient } from './GlobePageClient';

// Server component shell — react-globe.gl + three.js are WebGL-only and
// must not run during SSR. The client component below is loaded with
// `ssr: false` to keep the bundle out of the server build entirely.
export default function GlobePage() {
  return <GlobePageClient />;
}
