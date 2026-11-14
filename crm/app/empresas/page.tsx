import Link from "next/link";
import Shell from "@/components/Shell";
import { CompanyFields } from "@/components/Fields";
import { NewForm, Search } from "@/components/EditPage";
import { list } from "@/lib/entities";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Companies({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const rows = list("companies", { q });
  const counts = new Map(
    (db.prepare("SELECT company_id AS id, COUNT(*) AS n FROM contacts GROUP BY company_id").all() as { id: number; n: number }[]).map((r) => [r.id, r.n]),
  );
  return (
    <Shell title="Empresas" actions={<Search q={q} placeholder="Nombre o sector…" />}>
      <NewForm entity="companies" back="/empresas" label="Nueva empresa">
        <CompanyFields />
      </NewForm>
      <div className="card table-wrap">
        {rows.length === 0 ? (
          <p className="muted">No hay empresas.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Sector</th>
                <th>Teléfono</th>
                <th>Web</th>
                <th>Contactos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={Number(c.id)}>
                  <td>
                    <Link href={`/empresas/${c.id}`}>{String(c.name)}</Link>
                  </td>
                  <td>{String(c.industry ?? "—")}</td>
                  <td>{String(c.phone ?? "—")}</td>
                  <td>{c.website ? <a href={String(c.website)} target="_blank" rel="noreferrer">{String(c.website)}</a> : "—"}</td>
                  <td>{counts.get(Number(c.id)) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
