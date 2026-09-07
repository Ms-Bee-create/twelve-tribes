// The one place real silver has to move between two different players for
// the Prison feature — same reasoning as every other cross-player value
// transfer in this project (service-role key, never trusting a client to
// credit someone else's balance directly). Two modes:
//   'ransom' — owner pays PRISON_RANSOM_SILVER to the captor (recorded in
//              ransom_log for the captor's own client to apply locally next
//              sync, same pattern raid_log already uses for stolen troops —
//              silver itself never touches the server, see schema.sql),
//              then frees the hero. Payable at ANY point during captivity.
//   'pill'   — owner spent a Cyanide Pill (already deducted client-side,
//              it's their own inventory item): frees the hero immediately,
//              no payment to the captor, bypassing both the ransom and the
//              real 8-hour timeout. A hero is never permanently lost either
//              way — this is just the fastest way home.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const PRISON_RANSOM_SILVER = 10000;

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

    const { prisonerId, mode } = await req.json();
    if (!prisonerId || (mode !== "ransom" && mode !== "pill")) {
      return json({ error: "Missing prisonerId or invalid mode." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: row, error: rowErr } = await admin.from("prisoners").select("*").eq("id", prisonerId).single();
    if (rowErr || !row) return json({ error: "That capture record couldn't be found — maybe already resolved." }, 404);
    if (row.owner_id !== user.id) return json({ error: "That's not your captured hero." }, 403);

    if (mode === "ransom") {
      await admin.from("ransom_log").insert({
        captor_id: row.captor_id, owner_id: row.owner_id,
        hero_name: row.hero_name, silver: PRISON_RANSOM_SILVER,
      });
    }

    await admin.from("prisoners").delete().eq("id", prisonerId);

    return json({ freed: true, heroId: row.hero_id, heroName: row.hero_name, heroLevel: row.hero_level, mode });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong resolving the capture." }, 500);
  }
});
