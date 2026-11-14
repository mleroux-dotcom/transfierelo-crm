import Link from "next/link";
import Shell from "@/components/Shell";
import { TaskFields } from "@/components/Fields";
import { NewForm } from "@/components/EditPage";
import { TaskTable } from "@/components/Lists";
import { list, lookups } from "@/lib/entities";

export const dynamic = "force-dynamic";

export default async function Tasks({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams;
  const l = lookups();
  const filters: Record<string, string> = ver === "todas" ? {} : { done: ver === "hechas" ? "1" : "0" };
  return (
    <Shell
      title="Tareas"
      actions={
        <>
          <Link href="/tareas">Pendientes</Link>
          <Link href="/tareas?ver=hechas">Hechas</Link>
          <Link href="/tareas?ver=todas">Todas</Link>
        </>
      }
    >
      <NewForm entity="tasks" back="/tareas" label="Nueva tarea">
        <TaskFields l={l} />
      </NewForm>
      <div className="card">
        <TaskTable tasks={list("tasks", { filters })} l={l} />
      </div>
    </Shell>
  );
}
