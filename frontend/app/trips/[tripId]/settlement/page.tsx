import SettlementPageClient from "@/components/SettlementPageClient";

export default async function TripSettlementPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return <SettlementPageClient tripId={Number(tripId)} />;
}
