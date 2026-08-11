import SettingsPageClient from "@/components/SettingsPageClient";

export default async function TripSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { tripId } = await params;
  const { created } = await searchParams;
  return <SettingsPageClient tripId={Number(tripId)} justCreated={created === "1"} />;
}
