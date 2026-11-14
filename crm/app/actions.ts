"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { create, formToObject, remove, update, type EntityName } from "@/lib/entities";
import { SESSION_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

export async function saveEntity(entity: EntityName, id: number | null, redirectTo: string, form: FormData) {
  const data = formToObject(entity, form);
  if (id) update(entity, id, data);
  else create(entity, data);
  revalidatePath("/", "layout");
  redirect(redirectTo);
}

/** Updates a single field without leaving the page (e.g. moving a deal, ticking a task). */
export async function patchEntity(entity: EntityName, id: number, patch: Record<string, unknown>) {
  update(entity, id, patch);
  revalidatePath("/", "layout");
}

export async function moveDeal(id: number, form: FormData) {
  await patchEntity("deals", id, { stage: form.get("stage") });
}

export async function toggleTask(id: number, done: boolean) {
  await patchEntity("tasks", id, { done });
}

export async function deleteEntity(entity: EntityName, id: number, redirectTo: string) {
  remove(entity, id);
  revalidatePath("/", "layout");
  redirect(redirectTo);
}

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const expected = await sessionToken();
  if (!expected) return "Falta CRM_PASSWORD en el archivo .env";
  if (!safeEqual(String(form.get("password") ?? ""), process.env.CRM_PASSWORD!)) return "Contraseña incorrecta";
  (await cookies()).set(SESSION_COOKIE, expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
