import Link from "next/link";
import { toggleTask } from "@/app/actions";
import { STAGE_LABELS, lookups, type Row } from "@/lib/entities";
import { date, money, today } from "@/lib/format";

type L = ReturnType<typeof lookups>;

export function TaskTable({ tasks, l }: { tasks: Row[]; l: L }) {
  if (!tasks.length) return <p className="muted">No hay tareas.</p>;
  const now = today();
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 40 }}></th>
            <th>Tarea</th>
            <th>Fecha</th>
            <th>Contacto</th>
            <th>Oportunidad</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const id = Number(t.id);
            const done = !!t.done;
            const overdue = !done && t.due_date && String(t.due_date) < now;
            return (
              <tr key={id}>
                <td>
                  <form action={toggleTask.bind(null, id, !done)}>
                    <button className="secondary small" title={done ? "Marcar pendiente" : "Marcar hecha"}>
                      {done ? "✓" : "○"}
                    </button>
                  </form>
                </td>
                <td className={done ? "task-done" : undefined}>
                  <Link href={`/tareas/${id}`}>{String(t.title)}</Link>
                </td>
                <td className={overdue ? "overdue" : undefined}>{date(t.due_date)}</td>
                <td>{t.contact_id ? <Link href={`/contactos/${t.contact_id}`}>{l.contactName.get(Number(t.contact_id))}</Link> : "—"}</td>
                <td>{t.deal_id ? <Link href={`/oportunidades/${t.deal_id}`}>{l.dealName.get(Number(t.deal_id))}</Link> : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DealTable({ deals, l }: { deals: Row[]; l: L }) {
  if (!deals.length) return <p className="muted">No hay oportunidades.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Oportunidad</th>
            <th>Etapa</th>
            <th>Valor</th>
            <th>Empresa</th>
            <th>Cierre previsto</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr key={Number(d.id)}>
              <td>
                <Link href={`/oportunidades/${d.id}`}>{String(d.title)}</Link>
              </td>
              <td>
                <span className={`badge ${d.stage}`}>{STAGE_LABELS[String(d.stage)]}</span>
              </td>
              <td>{money(d.value)}</td>
              <td>{d.company_id ? l.companyName.get(Number(d.company_id)) : "—"}</td>
              <td>{date(d.expected_close)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
