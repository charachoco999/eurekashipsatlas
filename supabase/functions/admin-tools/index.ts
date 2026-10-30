import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? (() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default; } catch { return null; } })();
  if (!supabaseUrl || !serviceKey) return json({ error: "Falta configurar el secreto del servidor Supabase." }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Inicia sesión como administrador." }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user || user.app_metadata?.role !== "admin") {
    return json({ error: "Acceso reservado al administrador." }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Solicitud inválida." }, 400); }
  const action = body.action;

  if (action === "list-users") {
    const { data: profiles, error: profilesError } = await admin
      .from("atlas_profiles").select("user_id, username, created_at").order("username");
    if (profilesError) return json({ error: profilesError.message }, 500);
    const ids = (profiles || []).map((p) => p.user_id);
    let progress: Record<string, unknown>[] = [];
    let evidence: Record<string, unknown>[] = [];
    if (ids.length) {
      const [{ data: progressRows, error: progressError }, { data: evidenceRows, error: evidenceError }] = await Promise.all([
        admin.from("atlas_progress").select("user_id, tree_done, challenge_done, profile_seal, updated_at").in("user_id", ids),
        admin.from("atlas_evidence").select("id,user_id,challenge_id,challenge_title,object_path,status,submitted_at,reviewed_at,review_note").in("user_id", ids).order("submitted_at", { ascending: false })
      ]);
      if (progressError) return json({ error: progressError.message }, 500);
      if (evidenceError) return json({ error: evidenceError.message }, 500);
      progress = progressRows || [];
      evidence = evidenceRows || [];
    }
    const progressById = new Map(progress.map((p) => [p.user_id, p]));
    const namesById = new Map((profiles || []).map((p) => [p.user_id, p.username]));
    const evidenceWithNames = evidence.map((e) => ({ ...e, username: namesById.get(e.user_id) || "Jugador" }));
    const users = await Promise.all((profiles || []).map(async (p) => {
      const { data } = await admin.auth.admin.getUserById(p.user_id);
      return {
        ...p,
        is_admin: data?.user?.app_metadata?.role === "admin",
        progress: progressById.get(p.user_id) || null
      };
    }));
    return json({ users, evidence: evidenceWithNames });
  }

  if (action === "reset-password") {
    const userId = String(body.userId || "");
    const newPassword = String(body.newPassword || "");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "Identificador de usuario inválido." }, 400);
    if (newPassword.length < 10 || newPassword.length > 128) return json({ error: "La nueva contraseña debe tener entre 10 y 128 caracteres." }, 400);
    const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === "evidence-url") {
    const evidenceId = String(body.evidenceId || "");
    const { data: evidence, error: evidenceError } = await admin.from("atlas_evidence").select("object_path").eq("id", evidenceId).maybeSingle();
    if (evidenceError || !evidence) return json({ error: "No se encontró la evidencia." }, 404);
    const { data, error } = await admin.storage.from("atlas-evidence").createSignedUrl(evidence.object_path, 300);
    if (error || !data?.signedUrl) return json({ error: "No se pudo generar el enlace temporal." }, 500);
    return json({ signedUrl: data.signedUrl });
  }

  if (action === "review-evidence") {
    const evidenceId = String(body.evidenceId || "");
    const status = body.status;
    if (!/^[0-9a-f-]{36}$/i.test(evidenceId) || !["approved", "rejected"].includes(String(status))) {
      return json({ error: "Datos de revisión inválidos." }, 400);
    }
    const { error } = await admin.from("atlas_evidence").update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id
    }).eq("id", evidenceId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Acción desconocida." }, 400);
});
