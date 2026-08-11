import ExpensesPageClient from "@/components/ExpensesPageClient";

export default async function TripExpensesPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return <ExpensesPageClient tripId={Number(tripId)} />;
}
