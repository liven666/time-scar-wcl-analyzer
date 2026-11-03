import WclAnalyzer from "./WclAnalyzer";

export default function Home() {
  // The request timestamp keeps the server-rendered week aligned with hydration.
  // eslint-disable-next-line react-hooks/purity
  const initialNow = Date.now();
  return <WclAnalyzer initialNow={initialNow} />;
}
