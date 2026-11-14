import { CONTACT_STATUSES, DEAL_STAGES, STAGE_LABELS, lookups, type Row } from "@/lib/entities";

type Opt = { id: number; name: string };
type L = ReturnType<typeof lookups>;
const v = (row: Row | undefined, k: string) => (row?.[k] ?? "") as string | number;

function Text({ name, label, row, type = "text", required, full }: { name: string; label: string; row?: Row; type?: string; required?: boolean; full?: boolean }) {
  return (
    <label className={full ? "full" : undefined}>
      {label}
      <input name={name} type={type} defaultValue={v(row, name)} required={required} step={type === "number" ? "any" : undefined} />
    </label>
  );
}

function Notes({ row }: { row?: Row }) {
  return (
    <label className="full">
      Notas
      <textarea name="notes" defaultValue={v(row, "notes")} />
    </label>
  );
}

function Pick({ name, label, row, options, preset }: { name: string; label: string; row?: Row; options: Opt[]; preset?: number }) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={row ? v(row, name) : (preset ?? "")}>
        <option value="">— Ninguno —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CompanyFields({ row }: { row?: Row }) {
  return (
    <>
      <Text name="name" label="Nombre" row={row} required />
      <Text name="industry" label="Sector" row={row} />
      <Text name="website" label="Web" row={row} type="url" />
      <Text name="phone" label="Teléfono" row={row} type="tel" />
      <Notes row={row} />
    </>
  );
}

export function ContactFields({ row, l, companyId }: { row?: Row; l: L; companyId?: number }) {
  return (
    <>
      <Text name="first_name" label="Nombre" row={row} required />
      <Text name="last_name" label="Apellidos" row={row} />
      <Text name="email" label="Email" row={row} type="email" />
      <Text name="phone" label="Teléfono" row={row} type="tel" />
      <Text name="position" label="Cargo" row={row} />
      <label>
        Estado
        <select name="status" defaultValue={v(row, "status") || "lead"}>
          {CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <Pick name="company_id" label="Empresa" row={row} options={l.companies} preset={companyId} />
      <Notes row={row} />
    </>
  );
}

export function DealFields({ row, l, contactId, companyId }: { row?: Row; l: L; contactId?: number; companyId?: number }) {
  return (
    <>
      <Text name="title" label="Título" row={row} required />
      <Text name="value" label="Valor (€)" row={row} type="number" />
      <label>
        Etapa
        <select name="stage" defaultValue={v(row, "stage") || "nuevo"}>
          {DEAL_STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <Text name="expected_close" label="Cierre previsto" row={row} type="date" />
      <Pick name="contact_id" label="Contacto" row={row} options={l.contacts} preset={contactId} />
      <Pick name="company_id" label="Empresa" row={row} options={l.companies} preset={companyId} />
      <Notes row={row} />
    </>
  );
}

export function TaskFields({ row, l, contactId, dealId }: { row?: Row; l: L; contactId?: number; dealId?: number }) {
  return (
    <>
      <Text name="title" label="Tarea" row={row} required />
      <Text name="due_date" label="Fecha límite" row={row} type="date" />
      <Pick name="contact_id" label="Contacto" row={row} options={l.contacts} preset={contactId} />
      <Pick name="deal_id" label="Oportunidad" row={row} options={l.deals} preset={dealId} />
      <label className="full row">
        <input type="checkbox" name="done" defaultChecked={!!row?.done} /> Completada
      </label>
    </>
  );
}
