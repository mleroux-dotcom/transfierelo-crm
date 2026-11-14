import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import { CompanyFields, ContactFields } from "@/components/Fields";
import { EditForm, NewForm } from "@/components/EditPage";
import { DealTable } from "@/components/Lists";
import { get, list, lookups } from "@/lib/entities";
import { fullName } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Company({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const row = get("companies", id);
  if (!row) notFound();
  const l = lookups();
  const contacts = list("contacts", { filters: { company_id: String(id) } });
  return (
    <Shell title={String(row.name)}>
      <EditForm entity="companies" id={id} back="/empresas">
        <CompanyFields row={row} />
      </EditForm>
      <div className="card">
        <h2>Contactos</h2>
        {contacts.length === 0 ? (
          <p className="muted">Sin contactos.</p>
        ) : (
          <ul>
            {contacts.map((c) => (
              <li key={Number(c.id)}>
                <Link href={`/contactos/${c.id}`}>{fullName(c)}</Link> {c.position ? <span className="muted">· {String(c.position)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <NewForm entity="contacts" back={`/empresas/${id}`} label="Nuevo contacto en esta empresa">
        <ContactFields l={l} companyId={id} />
      </NewForm>
      <div className="card">
        <h2>Oportunidades</h2>
        <DealTable deals={list("deals", { filters: { company_id: String(id) } })} l={l} />
      </div>
    </Shell>
  );
}
