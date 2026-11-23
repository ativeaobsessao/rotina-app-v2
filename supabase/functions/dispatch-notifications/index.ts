import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

function cleanEnvValue(value: string | undefined): string {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

const SUPABASE_URL = cleanEnvValue(Deno.env.get('SUPABASE_URL'));
const SUPABASE_SERVICE_ROLE_KEY = cleanEnvValue(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
const VAPID_PUBLIC_KEY = cleanEnvValue(Deno.env.get('VAPID_PUBLIC_KEY'));
const VAPID_PRIVATE_KEY = cleanEnvValue(Deno.env.get('VAPID_PRIVATE_KEY'));
const VAPID_SUBJECT = cleanEnvValue(Deno.env.get('VAPID_SUBJECT')) || 'mailto:contato@duca.app';
const NOTIFICATION_CRON_SECRET = cleanEnvValue(Deno.env.get('NOTIFICATION_CRON_SECRET'));

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const ACTIVITY_MILESTONES = [7, 3, 1] as const;

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function getLocalClock(timezone: string, now = new Date()): {
  dateStr: string;
  weekday: string;
  minutesOfDay: number;
} {
  let tz = timezone || 'America/Sao_Paulo';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = 'America/Sao_Paulo';
  }

  const dateStr = now.toLocaleDateString('en-CA', { timeZone: tz });
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value || '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0');

  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || 'Monday';

  return {
    dateStr,
    weekday,
    minutesOfDay: hour * 60 + minute,
  };
}

function parseTimeToMinutes(timeStr: string | null | undefined): number | null {
  if (!timeStr) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(timeStr.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function formatShortTime(timeStr: string | null | undefined): string {
  if (!timeStr) return '';
  return timeStr.slice(0, 5);
}

function formatShortDateBR(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

function diffCalendarDays(fromDateStr: string, toDateStr: string): number {
  const [fy, fm, fd] = fromDateStr.split('-').map(Number);
  const [ty, tm, td] = toDateStr.split('-').map(Number);
  const fromTs = Date.UTC(fy, fm - 1, fd, 12, 0, 0);
  const toTs = Date.UTC(ty, tm - 1, td, 12, 0, 0);
  return Math.round((toTs - fromTs) / 86_400_000);
}

function isDueWithinWindow(
  scheduledTime: string | null | undefined,
  currentMinutes: number,
  leadMinutes: number,
  windowMinutes = 14
): boolean {
  const scheduledMinutes = parseTimeToMinutes(scheduledTime);
  if (scheduledMinutes === null) return false;
  const triggerMinutes = scheduledMinutes - Math.max(0, leadMinutes);
  return currentMinutes >= triggerMinutes && currentMinutes <= triggerMinutes + windowMinutes;
}

function isMedicationScheduledForDay(med: any, weekday: string): boolean {
  if (med.active === false) return false;
  if (med.frequency === 'daily') return true;
  if (med.frequency === 'weekly') {
    if (Array.isArray(med.weekdays) && med.weekdays.length > 0) {
      return med.weekdays.includes(weekday);
    }
    return med.weekday === weekday;
  }
  return false;
}

function resolveMedicationDosage(med: any, weekday: string): string {
  const daily = med.daily_dosages && typeof med.daily_dosages === 'object'
    ? med.daily_dosages[weekday]
    : null;
  if (typeof daily === 'string' && daily.trim()) {
    return daily.trim();
  }
  return String(med.dosage || '').trim();
}

interface CandidateNotification {
  notification_type:
    | 'medication'
    | 'meal'
    | 'activity_7d'
    | 'activity_3d'
    | 'activity_1d'
    | 'activity_today';
  source_id: string;
  event_date: string;
  milestone_days: number | null;
  title: string;
  body: string;
  tag: string;
  url: string;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ error: 'Variáveis SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let bodyJson: any = {};
  try {
    bodyJson = await req.json();
  } catch {
    bodyJson = {};
  }

  // ── MODO 0: CONSULTA SEGURA DA CHAVE PÚBLICA VAPID PELO APP AUTENTICADO ────
  if (bodyJson?.action === 'public_config') {
    const authHeader = req.headers.get('authorization') || '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Sessão não autenticada.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Token inválido.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        configured: Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY),
        vapidPublicKey: VAPID_PUBLIC_KEY || null,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response(
      JSON.stringify({
        error: 'Chaves VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY não configuradas nos segredos do Supabase.',
        missingVapid: true,
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  // ── MODO 1: DISPARO DE TESTE PELO PRÓPRIO USUÁRIO AUTENTICADO ────────────
  if (bodyJson?.action === 'test') {
    const authHeader = req.headers.get('authorization') || '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Sessão não autenticada.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Token inválido.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let subQuery = supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userData.user.id)
      .eq('enabled', true);

    if (typeof bodyJson.endpoint === 'string' && bodyJson.endpoint.trim()) {
      subQuery = subQuery.eq('endpoint', bodyJson.endpoint.trim());
    }

    const { data: subs, error: subErr } = await subQuery;
    if (subErr) {
      return new Response(JSON.stringify({ error: subErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let sent = 0;
    let failed = 0;
    for (const sub of subs || []) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
          },
          JSON.stringify({
            title: 'DUCA · Notificações ativas',
            body: 'Este aparelho receberá lembretes de medicamentos, refeições e atividades programadas (7, 3 e 1 dia).',
            tag: 'duca-test-push',
            url: '/',
          })
        );
        sent += 1;
        await supabaseAdmin
          .from('push_subscriptions')
          .update({ last_notified_at: new Date().toISOString(), failure_count: 0, last_error: null })
          .eq('id', sub.id);
      } catch (err: any) {
        failed += 1;
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          await supabaseAdmin
            .from('push_subscriptions')
            .update({
              failure_count: (sub.failure_count || 0) + 1,
              last_error: String(err?.message || 'Erro no envio de teste'),
            })
            .eq('id', sub.id);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, failed }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── MODO 1B: AVISO EM TEMPO REAL PARA FAMILIARES QUANDO UM REGISTRO É SALVO ─
  if (bodyJson?.action === 'event_recorded') {
    const authHeader = req.headers.get('authorization') || '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Sessão não autenticada.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Token inválido.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const actorUserId = userData.user.id;
    const kind = bodyJson?.kind === 'meal' ? 'meal' : bodyJson?.kind === 'medication' ? 'medication' : null;
    const logId = typeof bodyJson?.logId === 'string' ? bodyJson.logId.trim() : '';

    if (!kind || !logId) {
      return new Response(JSON.stringify({ error: 'Parâmetros kind e logId são obrigatórios.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let logRow: any = null;
    if (kind === 'meal') {
      const { data, error } = await supabaseAdmin
        .from('meal_logs')
        .select(
          'id, patient_id, meal_config_id, event_date, consumption_status, description, drink_description, meal_time, created_by, created_at, meal_config:meal_configs(name), patient:patients(id, family_id, name), creator:profiles!meal_logs_created_by_fkey(name)'
        )
        .eq('id', logId)
        .maybeSingle();
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      logRow = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('medication_logs')
        .select(
          'id, patient_id, medication_id, event_date, status, reason, applied_dosage, administered_time, created_by, created_at, medication:medications(name, dosage), patient:patients(id, family_id, name), creator:profiles!medication_logs_created_by_fkey(name)'
        )
        .eq('id', logId)
        .maybeSingle();
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      logRow = data;
    }

    if (!logRow || !logRow.patient?.family_id) {
      return new Response(JSON.stringify({ error: 'Registro não encontrado.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const familyId = String(logRow.patient.family_id);
    const patientId = String(logRow.patient.id);
    const patientName = String(logRow.patient.name || 'Familiar');

    const { data: members, error: membersErr } = await supabaseAdmin
      .from('family_members')
      .select('user_id, member_type')
      .eq('family_id', familyId);

    if (membersErr) {
      return new Response(JSON.stringify({ error: membersErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const actorIsMember = (members || []).some((m: any) => m.user_id === actorUserId);
    if (!actorIsMember) {
      return new Response(JSON.stringify({ error: 'Acesso negado para esta família.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Destinatários: membros familiares (member_type = 'FAMILY'), excluindo quem acabou de registrar
    const familyRecipientIds = (members || [])
      .filter((m: any) => m.user_id !== actorUserId && m.member_type !== 'CAREGIVER')
      .map((m: any) => m.user_id);

    if (familyRecipientIds.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, recipients: 0, sent: 0, skippedDuplicates: 0, failed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: familyRow } = await supabaseAdmin
      .from('families')
      .select('timezone')
      .eq('id', familyId)
      .maybeSingle();

    const familyTz = familyRow?.timezone || 'America/Sao_Paulo';
    const eventTimeDate = logRow.created_at ? new Date(logRow.created_at) : new Date();
    const formattedClock = new Intl.DateTimeFormat('pt-BR', {
      timeZone: familyTz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(eventTimeDate);
    const explicitHhmm =
      kind === 'meal'
        ? formatShortTime(logRow.meal_time)
        : formatShortTime(logRow.administered_time);
    const hhmm = explicitHhmm || formattedClock;

    const actorName = String(logRow.creator?.name || 'Cuidadora').trim();
    const notificationType = kind === 'meal' ? 'meal_recorded' : 'medication_recorded';

    let title = '';
    let body = '';

    if (kind === 'meal') {
      const mealName = String(logRow.meal_config?.name || 'Refeição');
      const statusLabel =
        logRow.consumption_status === 'normal'
          ? 'Comeu normalmente'
          : logRow.consumption_status === 'partial'
          ? 'Comeu parcialmente'
          : 'Não comeu';
      const detailParts = [logRow.description, logRow.drink_description]
        .filter((v: any) => typeof v === 'string' && v.trim())
        .join(' · ')
        .slice(0, 90);

      title = `Refeição registrada · ${mealName}`;
      body = `${patientName}: ${actorName} registrou às ${hhmm} (${statusLabel})${
        detailParts ? ` — ${detailParts}` : '.'
      }`;
    } else {
      const medName = String(logRow.medication?.name || 'Medicamento');
      const dose = String(logRow.applied_dosage || logRow.medication?.dosage || '').trim();
      if (logRow.status === 'administered') {
        title = `Medicamento administrado · ${medName}`;
        body = `${patientName}: ${actorName} registrou a dose${dose ? ` (${dose})` : ''} às ${hhmm}.`;
      } else {
        const reason = typeof logRow.reason === 'string' && logRow.reason.trim() ? logRow.reason.trim() : '';
        title = `Medicamento não administrado · ${medName}`;
        body = `${patientName}: ${actorName} informou às ${hhmm}${reason ? ` — ${reason}` : '.'}`;
      }
    }

    let subQuery = supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .eq('family_id', familyId)
      .eq('enabled', true)
      .in('user_id', familyRecipientIds);

    subQuery =
      kind === 'meal'
        ? subQuery.eq('notify_meals', true)
        : subQuery.eq('notify_medications', true);

    const { data: targetSubs, error: targetSubsErr } = await subQuery;
    if (targetSubsErr) {
      return new Response(JSON.stringify({ error: targetSubsErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const filteredSubs = (targetSubs || []).filter(
      (s: any) => !s.patient_id || s.patient_id === patientId
    );

    const loggedUserIds = new Set<string>();
    let sent = 0;
    let skippedDuplicates = 0;
    let failed = 0;

    for (const sub of filteredSubs) {
      if (!loggedUserIds.has(sub.user_id)) {
        const { error: logErr } = await supabaseAdmin.from('notification_dispatch_logs').insert({
          family_id: familyId,
          patient_id: patientId,
          user_id: sub.user_id,
          notification_type: notificationType,
          source_id: logRow.id,
          event_date: logRow.event_date,
          milestone_days: null,
          title,
          body,
        });

        if (logErr) {
          if (logErr.code === '23505') {
            skippedDuplicates += 1;
            continue;
          }
          // Se migration 0025 ainda não foi aplicada (23514 check violation), ainda envia o push
          if (logErr.code !== '23514') {
            console.warn('Erro ao gravar log de notificação em tempo real:', logErr.message);
          }
        }
        loggedUserIds.add(sub.user_id);
      }

      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
          },
          JSON.stringify({
            title,
            body,
            tag: `${notificationType}-${logRow.id}`,
            url: '/',
            type: notificationType,
            sourceId: logRow.id,
          })
        );
        sent += 1;
        await supabaseAdmin
          .from('push_subscriptions')
          .update({
            last_notified_at: new Date().toISOString(),
            failure_count: 0,
            last_error: null,
          })
          .eq('id', sub.id);
      } catch (pushErr: any) {
        failed += 1;
        const statusCode = pushErr?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          await supabaseAdmin
            .from('push_subscriptions')
            .update({
              failure_count: (sub.failure_count || 0) + 1,
              last_error: String(pushErr?.message || 'Erro ao enviar Web Push'),
            })
            .eq('id', sub.id);
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        recipients: filteredSubs.length,
        sent,
        skippedDuplicates,
        failed,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ── MODO 2: DISPARO AUTOMÁTICO AGENDADO (CRON / SERVIDOR) ─────────────────
  const cronSecretHeader = req.headers.get('x-cron-secret') || '';
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  const validCron =
    (NOTIFICATION_CRON_SECRET && constantTimeEqual(cronSecretHeader, NOTIFICATION_CRON_SECRET)) ||
    constantTimeEqual(bearer, SUPABASE_SERVICE_ROLE_KEY);

  if (!validCron) {
    return new Response(JSON.stringify({ error: 'Acesso não autorizado.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: subscriptions, error: subsError } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .eq('enabled', true);

  if (subsError) {
    return new Response(JSON.stringify({ error: subsError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!subscriptions || subscriptions.length === 0) {
    return new Response(JSON.stringify({ ok: true, subscriptions: 0, sent: 0 }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const now = new Date();
  const familyIds = Array.from(new Set(subscriptions.map((s: any) => s.family_id)));

  const [{ data: families }, { data: patients }, { data: memberships }] = await Promise.all([
    supabaseAdmin.from('families').select('id, timezone').in('id', familyIds),
    supabaseAdmin.from('patients').select('id, family_id, name').in('family_id', familyIds),
    supabaseAdmin.from('family_members').select('family_id, user_id').in('family_id', familyIds),
  ]);

  const familyTzMap = new Map<string, string>();
  for (const f of families || []) {
    familyTzMap.set(f.id, f.timezone || 'America/Sao_Paulo');
  }

  const activeMemberSet = new Set<string>(
    (memberships || []).map((m: any) => `${m.family_id}:${m.user_id}`)
  );

  const patientById = new Map<string, any>();
  const firstPatientByFamily = new Map<string, any>();
  for (const p of patients || []) {
    patientById.set(p.id, p);
    if (!firstPatientByFamily.has(p.family_id)) {
      firstPatientByFamily.set(p.family_id, p);
    }
  }

  const patientContextCache = new Map<string, Promise<any>>();
  async function loadPatientContext(patientId: string, dateStr: string) {
    const cacheKey = `${patientId}:${dateStr}`;
    const existing = patientContextCache.get(cacheKey);
    if (existing) return existing;

    const promise = (async () => {
      const [
        { data: periods },
        { data: meds },
        { data: medLogs },
        { data: meals },
        { data: mealLogs },
        { data: activities },
        { data: activityLogs },
        { data: closure },
      ] = await Promise.all([
        supabaseAdmin
          .from('medication_periods')
          .select('*')
          .eq('patient_id', patientId)
          .eq('active', true),
        supabaseAdmin
          .from('medications')
          .select('*')
          .eq('patient_id', patientId)
          .eq('active', true),
        supabaseAdmin
          .from('medication_logs')
          .select('medication_id')
          .eq('patient_id', patientId)
          .eq('event_date', dateStr),
        supabaseAdmin
          .from('meal_configs')
          .select('*')
          .eq('patient_id', patientId)
          .eq('active', true),
        supabaseAdmin
          .from('meal_logs')
          .select('meal_config_id')
          .eq('patient_id', patientId)
          .eq('event_date', dateStr),
        supabaseAdmin
          .from('activities')
          .select('*')
          .eq('patient_id', patientId)
          .eq('active', true),
        supabaseAdmin
          .from('activity_logs')
          .select('activity_id')
          .eq('patient_id', patientId)
          .eq('event_date', dateStr),
        supabaseAdmin
          .from('daily_closures')
          .select('id, status')
          .eq('patient_id', patientId)
          .eq('date', dateStr)
          .maybeSingle(),
      ]);

      return {
        periods: periods || [],
        meds: meds || [],
        loggedMedIds: new Set((medLogs || []).map((l: any) => l.medication_id)),
        meals: meals || [],
        loggedMealIds: new Set((mealLogs || []).map((l: any) => l.meal_config_id)),
        activities: activities || [],
        loggedActivityIds: new Set((activityLogs || []).map((l: any) => l.activity_id)),
        isDayClosed: closure?.status === 'closed',
      };
    })();

    patientContextCache.set(cacheKey, promise);
    return promise;
  }

  let totalSent = 0;
  let totalSkippedDuplicate = 0;
  let totalFailed = 0;

  for (const sub of subscriptions) {
    if (!activeMemberSet.has(`${sub.family_id}:${sub.user_id}`)) {
      continue;
    }

    const patient =
      (sub.patient_id ? patientById.get(sub.patient_id) : null) ||
      firstPatientByFamily.get(sub.family_id);
    if (!patient) continue;

    const tz = sub.timezone || familyTzMap.get(sub.family_id) || 'America/Sao_Paulo';
    const clock = getLocalClock(tz, now);
    const ctx = await loadPatientContext(patient.id, clock.dateStr);
    const leadMinutes = Number(sub.lead_minutes || 0);

    const candidates: CandidateNotification[] = [];

    // 1. Medicamentos (horário do período para medicações pendentes do dia)
    if (sub.notify_medications && !ctx.isDayClosed) {
      for (const period of ctx.periods) {
        if (!isDueWithinWindow(period.scheduled_time, clock.minutesOfDay, leadMinutes)) {
          continue;
        }
        const pendingMeds = ctx.meds.filter(
          (m: any) =>
            m.medication_period_id === period.id &&
            isMedicationScheduledForDay(m, clock.weekday) &&
            !ctx.loggedMedIds.has(m.id)
        );
        if (pendingMeds.length === 0) continue;

        const medSummary = pendingMeds
          .slice(0, 3)
          .map((m: any) => {
            const dose = resolveMedicationDosage(m, clock.weekday);
            return dose ? `${m.name} (${dose})` : m.name;
          })
          .join(', ');
        const extra = pendingMeds.length > 3 ? ` +${pendingMeds.length - 3}` : '';
        const hhmm = formatShortTime(period.scheduled_time);

        candidates.push({
          notification_type: 'medication',
          source_id: period.id,
          event_date: clock.dateStr,
          milestone_days: null,
          title: `Hora do remédio · ${period.name} (${hhmm})`,
          body: `${patient.name}: ${medSummary}${extra}`,
          tag: `med-${period.id}-${clock.dateStr}`,
          url: '/',
        });
      }
    }

    // 2. Refeições (horário configurado sem registro ainda)
    if (sub.notify_meals && !ctx.isDayClosed) {
      for (const meal of ctx.meals) {
        if (ctx.loggedMealIds.has(meal.id)) continue;
        if (!isDueWithinWindow(meal.scheduled_time, clock.minutesOfDay, leadMinutes)) {
          continue;
        }
        const hhmm = formatShortTime(meal.scheduled_time);
        const menuHint = [meal.default_description, meal.default_drink_description]
          .filter((v: any) => typeof v === 'string' && v.trim())
          .join(' · ');

        candidates.push({
          notification_type: 'meal',
          source_id: meal.id,
          event_date: clock.dateStr,
          milestone_days: null,
          title: `Horário da refeição · ${meal.name} (${hhmm})`,
          body: menuHint
            ? `${patient.name} — Cardápio: ${menuHint}`
            : `Hora de preparar e registrar: ${meal.name} de ${patient.name}.`,
          tag: `meal-${meal.id}-${clock.dateStr}`,
          url: '/',
        });
      }
    }

    // 3. Atividades programadas: avisos exatos de 7 dias, 3 dias e 1 dia + no horário do dia
    if (sub.notify_activities) {
      for (const act of ctx.activities) {
        if (act.schedule_type === 'one_time' && act.scheduled_date) {
          const daysUntil = diffCalendarDays(clock.dateStr, act.scheduled_date);

          // Marcos antecipados de 7, 3 e 1 dia (disparo a partir das 08:00 no fuso da família)
          if (
            (ACTIVITY_MILESTONES as readonly number[]).includes(daysUntil) &&
            clock.minutesOfDay >= 8 * 60
          ) {
            const type =
              daysUntil === 7
                ? 'activity_7d'
                : daysUntil === 3
                ? 'activity_3d'
                : 'activity_1d';
            const hhmm = formatShortTime(act.scheduled_time);
            const dateBR = formatShortDateBR(act.scheduled_date);
            const title =
              daysUntil === 1
                ? `Falta 1 dia · ${act.title}`
                : `Faltam ${daysUntil} dias · ${act.title}`;
            const body =
              daysUntil === 1
                ? `Amanhã (${dateBR} às ${hhmm}) — Atividade programada para ${patient.name}.`
                : `${patient.name} tem atividade em ${daysUntil} dias: ${dateBR} às ${hhmm}.`;

            candidates.push({
              notification_type: type,
              source_id: act.id,
              event_date: act.scheduled_date,
              milestone_days: daysUntil,
              title,
              body,
              tag: `act-${daysUntil}d-${act.id}`,
              url: '/',
            });
          }

          // No próprio dia da atividade agendada
          if (
            daysUntil === 0 &&
            !ctx.isDayClosed &&
            !ctx.loggedActivityIds.has(act.id) &&
            isDueWithinWindow(act.scheduled_time, clock.minutesOfDay, leadMinutes)
          ) {
            candidates.push({
              notification_type: 'activity_today',
              source_id: act.id,
              event_date: clock.dateStr,
              milestone_days: 0,
              title: `Atividade hoje · ${act.title} (${formatShortTime(act.scheduled_time)})`,
              body: `Programada para hoje com ${patient.name}.`,
              tag: `act-today-${act.id}-${clock.dateStr}`,
              url: '/',
            });
          }
        } else if (
          act.schedule_type === 'weekly' &&
          !ctx.isDayClosed &&
          Array.isArray(act.weekdays) &&
          act.weekdays.includes(clock.weekday) &&
          !ctx.loggedActivityIds.has(act.id) &&
          isDueWithinWindow(act.scheduled_time, clock.minutesOfDay, leadMinutes)
        ) {
          candidates.push({
            notification_type: 'activity_today',
            source_id: act.id,
            event_date: clock.dateStr,
            milestone_days: 0,
            title: `Atividade hoje · ${act.title} (${formatShortTime(act.scheduled_time)})`,
            body: `Rotina semanal de ${patient.name}.`,
            tag: `act-today-${act.id}-${clock.dateStr}`,
            url: '/',
          });
        }
      }
    }

    for (const candidate of candidates) {
      // Idempotência atômica: grava antes do envio; se já existir para este usuário+evento+data, ignora
      const { error: logErr } = await supabaseAdmin.from('notification_dispatch_logs').insert({
        family_id: sub.family_id,
        patient_id: patient.id,
        user_id: sub.user_id,
        notification_type: candidate.notification_type,
        source_id: candidate.source_id,
        event_date: candidate.event_date,
        milestone_days: candidate.milestone_days,
        title: candidate.title,
        body: candidate.body,
      });

      if (logErr) {
        if (logErr.code === '23505') {
          totalSkippedDuplicate += 1;
        }
        continue;
      }

      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
          },
          JSON.stringify({
            title: candidate.title,
            body: candidate.body,
            tag: candidate.tag,
            url: candidate.url,
            type: candidate.notification_type,
            milestoneDays: candidate.milestone_days,
            sourceId: candidate.source_id,
          })
        );
        totalSent += 1;
        await supabaseAdmin
          .from('push_subscriptions')
          .update({
            last_notified_at: new Date().toISOString(),
            failure_count: 0,
            last_error: null,
          })
          .eq('id', sub.id);
      } catch (pushErr: any) {
        totalFailed += 1;
        const statusCode = pushErr?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
          break;
        }
        // Remove log if transient failure so next cron tick can retry
        await supabaseAdmin
          .from('notification_dispatch_logs')
          .delete()
          .match({
            user_id: sub.user_id,
            patient_id: patient.id,
            notification_type: candidate.notification_type,
            source_id: candidate.source_id,
            event_date: candidate.event_date,
          });
        await supabaseAdmin
          .from('push_subscriptions')
          .update({
            failure_count: (sub.failure_count || 0) + 1,
            last_error: String(pushErr?.message || 'Erro ao enviar Web Push'),
          })
          .eq('id', sub.id);
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      subscriptions: subscriptions.length,
      sent: totalSent,
      skippedDuplicates: totalSkippedDuplicate,
      failed: totalFailed,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
