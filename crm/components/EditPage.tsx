import { deleteEntity, saveEntity } from "@/app/actions";
import type { EntityName } from "@/lib/entities";

/** Edit form + delete button shared by every detail page. */
export function EditForm({ entity, id, back, children }: { entity: EntityName; id: number; back: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <form className="fields" action={saveEntity.bind(null, entity, id, back)}>
        {children}
        <div className="full row">
          <button>Guardar</button>
          <button className="danger" formAction={deleteEntity.bind(null, entity, id, back)} formNoValidate>
            Borrar
          </button>
        </div>
      </form>
    </div>
  );
}

export function NewForm({ entity, back, label, children }: { entity: EntityName; back: string; label: string; children: React.ReactNode }) {
  return (
    <details className="card">
      <summary>+ {label}</summary>
      <form className="fields" action={saveEntity.bind(null, entity, null, back)}>
        {children}
        <div className="full">
          <button>Crear</button>
        </div>
      </form>
    </details>
  );
}

export function Search({ q, placeholder }: { q?: string; placeholder: string }) {
  return (
    <form className="row">
      <input name="q" defaultValue={q} placeholder={placeholder} />
      <button className="secondary">Buscar</button>
    </form>
  );
}
