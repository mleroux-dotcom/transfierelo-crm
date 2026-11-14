import Shell from "@/components/Shell";
import { TaskTable } from "@/components/Lists";
import { DEAL_STAGES, STAGE_LABELS, dashboardStats, list, lookups } from "@/lib/entities";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const s = dashboardStats();
  const l = lookups();
  const deals = list("deals");
  const pending = list("tasks", { filters: { done: "0" } }).slice(0, 8);
  const byStage = DEAL_STAGES.map((stage) => {
    const items = deals.filter((d) => d.stage === stage);
    return { stage, count: items.length, value: items.reduce((sum, d) => sum + Number(d.value || 0), 0) };
  });

  return (
    <Shell title="Panel">
      <div className="grid" style={{ marginBottom: 16 }}>
        <Stat label="Contactos" value={s.contacts} />
        <Stat label="Empresas" value={s.companies} />
        <Stat label="Oportunidades abiertas" value={s.openDeals} />
        <Stat label="Valor en pipeline" value={money(s.pipelineValue)} />
        <Stat label="Ganado" value={money(s.wonValue)} />
        <Stat label="Tareas pendientes" value={s.pendingTasks} />
      </div>
      <div className="card">
        <h2>Pipeline por etapa</h2>
        <table>
          <tbody>
            {byStage.map((b) => (
              <tr key={b.stage}>
                <td>{STAGE_LABELS[b.stage]}</td>
                <td>{b.count}</td>
                <td>{money(b.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>Próximas tareas</h2>
        <TaskTable tasks={pending} l={l} />
      </div>
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card stat" style={{ marginBottom: 0 }}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
