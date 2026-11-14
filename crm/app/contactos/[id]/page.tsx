import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import { ContactFields, DealFields, TaskFields } from "@/components/Fields";
import { EditForm, NewForm } from "@/components/EditPage";
import { DealTable, TaskTable } from "@/components/Lists";
import { get, list, lookups } from "@/lib/entities";
import { fullName } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Contact({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const row = get("contacts", id);
  if (!row) notFound();
  const l = lookups();
  const here = `/contactos/${id}`;
  const companyId = row.company_id ? Number(row.company_id) : undefined;
  return (
    <Shell title={fullName(row)}>
      <EditForm entity="contacts" id={id} back="/contactos">
        <ContactFields row={row} l={l} />
      </EditForm>
      <div className="card">
        <h2>Oportunidades</h2>
        <DealTable deals={list("deals", { filters: { contact_id: String(id) } })} l={l} />
      </div>
      <NewForm entity="deals" back={here} label="Nueva oportunidad">
        <DealFields l={l} contactId={id} companyId={companyId} />
      </NewForm>
      <div className="card">
        <h2>Tareas</h2>
        <TaskTable tasks={list("tasks", { filters: { contact_id: String(id) } })} l={l} />
      </div>
      <NewForm entity="tasks" back={here} label="Nueva tarea">
        <TaskFields l={l} contactId={id} />
      </NewForm>
    </Shell>
  );
}
