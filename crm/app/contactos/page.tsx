import Link from "next/link";
import Shell from "@/components/Shell";
import { ContactFields } from "@/components/Fields";
import { NewForm, Search } from "@/components/EditPage";
import { CONTACT_STATUSES, list, lookups } from "@/lib/entities";
import { fullName } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Contacts({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q, status = "" } = await searchParams;
  const l = lookups();
  const rows = list("contacts", { q, filters: { status } });
  return (
    <Shell title="Contactos" actions={<Search q={q} placeholder="Nombre, email, teléfono…" />}>
      <NewForm entity="contacts" back="/contactos" label="Nuevo contacto">
        <ContactFields l={l} />
      </NewForm>
      <div className="row" style={{ marginBottom: 12 }}>
        <Link href="/contactos">Todos</Link>
        {CONTACT_STATUSES.map((s) => (
          <Link key={s} href={`/contactos?status=${s}`} className={`badge ${s}`}>
            {s}
          </Link>
        ))}
      </div>
      <div className="card table-wrap">
        {rows.length === 0 ? (
          <p className="muted">No hay contactos.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Empresa</th>
                <th>Email</th>
                <th>Teléfono</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={Number(c.id)}>
                  <td>
                    <Link href={`/contactos/${c.id}`}>{fullName(c)}</Link>
                    {c.position && <div className="muted">{String(c.position)}</div>}
                  </td>
                  <td>{c.company_id ? <Link href={`/empresas/${c.company_id}`}>{l.companyName.get(Number(c.company_id))}</Link> : "—"}</td>
                  <td>{c.email ? <a href={`mailto:${c.email}`}>{String(c.email)}</a> : "—"}</td>
                  <td>{c.phone ? <a href={`tel:${c.phone}`}>{String(c.phone)}</a> : "—"}</td>
                  <td>
                    <span className={`badge ${c.status}`}>{String(c.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
