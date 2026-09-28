import EventManager from "@/components/EventManager";

export default function AdminEventsPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Special Events</h1>
        <p className="text-sm text-gray-400 mt-1">
          PD, double date and other campaigns. Hosts of the brand claim fixed blocks; you can assign or take back any block.
        </p>
      </div>
      <EventManager />
    </div>
  );
}
