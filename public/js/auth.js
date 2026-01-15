import { api } from "./api.js";

export async function me() { return api("/api/auth/me"); }
export async function login(email, password) {
  return api("/api/auth/login", { method: "POST", body: { email, password } });
}
export async function logout() { return api("/api/auth/logout", { method: "POST" }); }
