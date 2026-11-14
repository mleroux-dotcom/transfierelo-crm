import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import { DealFields, TaskFields } from "@/components/Fields";
import { EditForm, NewForm } from "@/components/EditPage";
import { TaskTable } from "@/components/Lists";
import { get, list, lookups } from "@/lib/entities";

export const dynamic = "force-dynamic";

export default async function Deal({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const row = get("deals", id);
  if (!row) notFound();
  const l = lookups();
  return (
    <Shell title={String(row.title)}>
      <EditForm entity="deals" id={id} back="/oportunidades">
        <DealFields row={row} l={l} />
      </EditForm>
      <div className="card">
        <h2>Tareas</h2>
        <TaskTable tasks={list("tasks", { filters: { deal_id: String(id) } })} l={l} />
      </div>
      <NewForm entity="tasks" back={`/oportunidades/${id}`} label="Nueva tarea">
        <TaskFields l={l} dealId={id} contactId={row.contact_id ? Number(row.contact_id) : undefined} />
      </NewForm>
    </Shell>
  );
}
