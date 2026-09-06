// Voluntarily gives up a held City Gate. This is the ONLY way home for a
// garrisoned hero other than losing it to a stronger attacker — there's no
// auto-expiry once someone holds it (see seize-governor's comments), so
// without this a garrisoning hero would be stuck indefinitely.
//
// Deliberately simple: no combat math, just "are you actually the holder,
// then clear the row." The client is responsible for walking the hero home
// and returning the formation locally (recallGarrisonHero -> recallHero),
// same as it always does for any other march — this function's only job is
// releasing the shared row so someone else can contest the city again.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not signed in." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: "Not signed in." }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: city, error: cityErr } = await admin.from("city_control").select("*").eq("id", 1).single();
    if (cityErr || !city) return json({ error: "City state is missing — contact the admin." }, 500);
    if (city.held_by !== user.id) return json({ error: "You don't hold the city." }, 400);

    const { data: updated } = await admin.from("city_control")
      .update({
        held_by: null,
        garrison: {},
        garrison_hero_level: 1,
        garrison_account_level: 1,
      })
      .eq("id", 1)
      .eq("held_by", user.id)
      .select()
      .single();

    if (!updated) return json({ error: "Something changed — try again." }, 409);

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong abandoning the office." }, 500);
  }
});
