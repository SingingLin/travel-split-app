import TripLayoutClient from "@/components/TripLayoutClient";

export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripLayoutClient tripId={Number(tripId)}>{children}</TripLayoutClient>;
}
