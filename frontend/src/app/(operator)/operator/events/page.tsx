import EventManager from "@/components/EventManager";
import PageHeader from "@/components/PageHeader";

export default function OperatorEventsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Event khusus"
        description="PD, double date, dan kampanye lainnya. Host dari brand mengambil blok yang sudah ditentukan; kamu bisa menunjuk atau menarik kembali blok mana pun."
      />
      <EventManager />
    </div>
  );
}
