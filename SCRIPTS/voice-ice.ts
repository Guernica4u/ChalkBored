// Supabase edge function "voice-ice": gives a signed-in, unbanned Chalk Chat
// user a one-hour login for the Cloudflare voice relay (TURN), so calls work on
// school networks that block direct links. The relay's own key never reaches a
// browser: it sits in the project's secrets CF_TURN_KEY_ID and CF_TURN_KEY_TOKEN
// (Cloudflare dashboard > Realtime > TURN Server > Create). Without them it
// still answers, with Cloudflare's free STUN server only.
import { createClient } from 'npm:@supabase/supabase-js@2.117.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await db.auth.getUser();
  if (!user) return json({ error: 'Sign in first.' }, 401);
  const { data: me } = await db.from('profiles').select('banned').eq('id', user.id).maybeSingle();
  if (!me || me.banned) return json({ error: 'Not allowed.' }, 403);

  const id = Deno.env.get('CF_TURN_KEY_ID');
  const token = Deno.env.get('CF_TURN_KEY_TOKEN');
  if (!id || !token) return json({ iceServers: STUN });

  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 3600 }),
  });
  if (!r.ok) return json({ iceServers: STUN });
  const { iceServers } = await r.json();
  return json({ iceServers: Array.isArray(iceServers) ? iceServers : [iceServers] });
});
