// Se ejecuta SOLO por Vercel Cron, una vez por día (configurado en vercel.json), sin que nadie
// tenga la app abierta. Revisa a cada alumno/a: si hoy le toca entrenar según su plan y todavía
// no hizo el check-in de ánimo del día, le manda un recordatorio push.
//
// Configuración requerida en Vercel (Project Settings → Environment Variables), además de las
// que ya tenías: CRON_SECRET (cualquier texto largo al azar, para que solo Vercel pueda llamar
// a esta función y no cualquiera desde afuera).

import webpush from "web-push";

const SUPABASE_URL = "https://phoqazemsipnxibpxboq.supabase.co";
const SUPABASE_KEY = "sb_publishable_04mcDE0s7wlA5Z2JVAkfbA_67H7Sbvk";
const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

async function enviarPush(userId, title, body) {
  const subRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(userId)}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const subs = await subRes.json();
  if (!Array.isArray(subs)) return 0;
  const payload = JSON.stringify({ title, body, url: "/" });
  let sent = 0;
  for (const row of subs) {
    try {
      await webpush.sendNotification(row.subscription, payload);
      sent++;
    } catch {
      // suscripción vencida u otro error puntual: seguimos con las demás, sin cortar el resto
    }
  }
  return sent;
}

export default async function handler(req, res) {
  // Solo Vercel Cron (o alguien con el secreto) puede disparar esto
  const auth = req.headers.authorization || "";
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) {
    res.status(500).json({ error: "Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY." });
    return;
  }
  webpush.setVapidDetails("mailto:notificaciones@teambull.app", vapidPublic, vapidPrivate);

  try {
    const dataRes = await fetch(`${SUPABASE_URL}/rest/v1/team_data?id=eq.main`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const rows = await dataRes.json();
    const data = rows?.[0]?.data;
    if (!data?.alumnos) {
      res.status(200).json({ recordatorios: 0, info: "Sin datos todavía." });
      return;
    }

    // Fecha y día de hoy en horario de Argentina (UTC-3), no en UTC (que es el horario del servidor)
    const ahora = new Date();
    const ahoraArg = new Date(ahora.getTime() - 3 * 60 * 60 * 1000);
    const hoyISO = ahoraArg.toISOString().slice(0, 10);
    const hoyNombre = DIAS_SEMANA[ahoraArg.getUTCDay()];

    let enviados = 0;
    for (const alumno of data.alumnos) {
      const tieneEntrenoHoy = (alumno.plan?.dias || []).some((d) => d.diaSemana === hoyNombre);
      if (!tieneEntrenoHoy) continue;
      const yaHizoCheckin = (alumno.wellness?.checkins || []).some((c) => c.fecha === hoyISO);
      if (yaHizoCheckin) continue;
      const plantilla = data.mensajeRecordatorio || "{nombre}, hoy tenés entrenamiento — no te olvides de contarle a tu coach cómo venís.";
      const primerNombre = alumno.nombre?.split(" ")[0] || "Hola";
      const mensaje = plantilla.includes("{nombre}") ? plantilla.replace(/{nombre}/g, primerNombre) : `${primerNombre}, ${plantilla}`;
      const enviadosAlumno = await enviarPush(alumno.id, "💪 Hoy entrenás", mensaje);
      if (enviadosAlumno > 0) enviados++;
    }

    res.status(200).json({ recordatorios: enviados, fecha: hoyISO, dia: hoyNombre });
  } catch (e) {
    res.status(500).json({ error: e.message || "Error inesperado." });
  }
}
