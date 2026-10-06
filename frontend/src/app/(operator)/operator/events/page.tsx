import EventManager from "@/components/EventManager";

export default function OperatorEventsPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-heading">Event Khusus</h1>
        <p className="text-sm text-muted mt-1">
          PD, double date, dan kampanye lainnya. Host dari brand mengambil blok yang sudah ditentukan; kamu bisa menunjuk atau menarik kembali blok mana pun.
        </p>
      </div>
      <EventManager />
    </div>
  );
}
