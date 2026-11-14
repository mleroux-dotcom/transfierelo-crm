"use client";
import { useActionState } from "react";
import { login } from "@/app/actions";

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <div className="login">
      <form className="card" action={action}>
        <h1>Mi CRM</h1>
        <label>
          Contraseña
          <input type="password" name="password" autoFocus required />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
      </form>
    </div>
  );
}
