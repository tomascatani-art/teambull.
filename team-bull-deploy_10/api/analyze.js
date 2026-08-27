// Función serverless de Vercel: puente seguro entre la app (navegador) y la API de Google Gemini.
// La API key vive acá, en el servidor, protegida como variable de entorno — nunca en el navegador.
//
// Configuración requerida en Vercel:
//   Project Settings → Environment Variables → agregar GEMINI_API_KEY con tu key (empieza con AQ.Ab8... o AIza...)
//   Conseguí la key gratis en https://aistudio.google.com/apikey

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Falta configurar GEMINI_API_KEY en las variables de entorno de Vercel." });
    return;
  }

  try {
    const { content } = req.body || {};
    if (!content) {
      res.status(400).json({ error: "Falta el contenido a analizar." });
      return;
    }

    const parts = content
      .map((c) => {
        if (c.type === "text") return { text: c.text };
        if (c.type === "image") return { inline_data: { mime_type: c.source.media_type, data: c.source.data } };
        return null;
      })
      .filter(Boolean);

    const model = "gemini-3.6-flash";
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }] }),
      }
    );

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      res.status(geminiRes.status).json({ error: data?.error?.message || "Error al conectar con Gemini." });
      return;
    }

    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join("\n");
    res.status(200).json({ content: [{ type: "text", text }] });
  } catch (e) {
    res.status(500).json({ error: e.message || "Error inesperado en el servidor." });
  }
}
