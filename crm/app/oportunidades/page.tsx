import Link from "next/link";
import Shell from "@/components/Shell";
import { DealFields } from "@/components/Fields";
import { NewForm } from "@/components/EditPage";
import { moveDeal } from "@/app/actions";
import { DEAL_STAGES, STAGE_LABELS, list, lookups } from "@/lib/entities";
import { date, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function Deals() {
  const l = lookups();
  const deals = list("deals");
  return (
    <Shell title="Oportunidades">
      <NewForm entity="deals" back="/oportunidades" label="Nueva oportunidad">
        <DealFields l={l} />
      </NewForm>
      <div className="kanban">
        {DEAL_STAGES.map((stage) => {
          const items = deals.filter((d) => d.stage === stage);
          const total = items.reduce((s, d) => s + Number(d.value || 0), 0);
          return (
            <section key={stage} className="column">
              <h3>
                <span>
                  {STAGE_LABELS[stage]} ({items.length})
                </span>
                <span className="muted">{money(total)}</span>
              </h3>
              {items.map((d) => {
                const id = Number(d.id);
                return (
                  <div key={id} className="deal">
                    <Link href={`/oportunidades/${id}`}>{String(d.title)}</Link>
                    <span className="value">{money(d.value)}</span>
                    <span className="muted">
                      {d.company_id ? l.companyName.get(Number(d.company_id)) : d.contact_id ? l.contactName.get(Number(d.contact_id)) : ""}
                      {d.expected_close ? ` · ${date(d.expected_close)}` : ""}
                    </span>
                    <form action={moveDeal.bind(null, id)} className="row">
                      <select name="stage" defaultValue={stage}>
                        {DEAL_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {STAGE_LABELS[s]}
                          </option>
                        ))}
                      </select>
                      <button className="secondary small">Mover</button>
                    </form>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </Shell>
  );
}
