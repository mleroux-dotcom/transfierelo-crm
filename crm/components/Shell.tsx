import Link from "next/link";
import { logout } from "@/app/actions";

const NAV = [
  { href: "/", label: "Panel" },
  { href: "/contactos", label: "Contactos" },
  { href: "/empresas", label: "Empresas" },
  { href: "/oportunidades", label: "Oportunidades" },
  { href: "/tareas", label: "Tareas" },
];

export default function Shell({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Mi CRM</div>
        <nav>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}>
              {n.label}
            </Link>
          ))}
        </nav>
        <form action={logout}>
          <button className="link">Cerrar sesión</button>
        </form>
      </aside>
      <main className="content">
        <header className="page-header">
          <h1>{title}</h1>
          <div className="row">{actions}</div>
        </header>
        {children}
      </main>
    </div>
  );
}
