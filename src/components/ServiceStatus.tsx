import type { ServiceAvailability, ServiceName } from "@/services/availability";

const serviceLabels = [
  ["geocode", "Address search"],
  ["route", "Driving routes"],
  ["places", "Places (Overpass)"],
] as const;

const statusLabels: Record<ServiceAvailability["status"], string> = {
  unknown: "Not checked yet",
  available: "Last request succeeded",
  unavailable: "Temporarily unavailable",
};

export function ServiceStatus({ services }: { services: Readonly<Record<ServiceName, ServiceAvailability>> }) {
  return (
    <section className="places-panel" aria-labelledby="service-status-heading">
      <div className="section-heading compact"><h2 id="service-status-heading">Service status</h2></div>
      <ul className="service-status-list" aria-live="polite">
        {serviceLabels.map(([service, label]) => (
          <li key={service}>
            <strong>{label}</strong>
            <span>{statusLabels[services[service].status]}</span>
            {services[service].status === "unavailable" && <p className="field-error">{services[service].message}</p>}
          </li>
        ))}
      </ul>
      <details className="future-enhancements">
        <summary>Future Enhancements</summary>
        <ul>
          <li>Live traffic and traffic-aware ETA</li>
          <li>Live turn-by-turn navigation and continuous GPS</li>
          <li>Business ratings and verified live opening hours</li>
          <li>Saved home/work, accounts and offline maps</li>
          <li>Walking/transit routes and switching alternative routes</li>
        </ul>
      </details>
    </section>
  );
}