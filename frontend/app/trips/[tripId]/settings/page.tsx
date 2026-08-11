import SettingsPageClient from "@/components/SettingsPageClient";

export default async function TripSettingsPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return <SettingsPageClient tripId={Number(tripId)} />;
}
