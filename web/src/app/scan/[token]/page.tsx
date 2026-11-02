import App from "@/components/App";
export default async function ScanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <App scanToken={decodeURIComponent(token)} />;
}
