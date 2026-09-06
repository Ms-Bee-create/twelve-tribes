// Browsers send a preflight OPTIONS request before any cross-origin fetch()
// with an Authorization header — without these headers on every response,
// the game's fetch calls to these functions get silently blocked.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
