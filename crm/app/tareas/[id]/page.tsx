import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import { TaskFields } from "@/components/Fields";
import { EditForm } from "@/components/EditPage";
import { get, lookups } from "@/lib/entities";

export const dynamic = "force-dynamic";

export default async function Task({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const row = get("tasks", id);
  if (!row) notFound();
  return (
    <Shell title={String(row.title)}>
      <EditForm entity="tasks" id={id} back="/tareas">
        <TaskFields row={row} l={lookups()} />
      </EditForm>
    </Shell>
  );
}
