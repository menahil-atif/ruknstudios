import { createHmac, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";

const MAX_SIGNATURE_AGE_SECONDS = 30 * 60;

function isValidSignature(header, rawBody, secret) {
  if (!header || !secret) return false;

  const parts = header.split(",").map((part) => part.trim().split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts
    .filter(([key]) => key === "v0")
    .map(([, value]) => value);
  const timestampSeconds = Number(timestamp);

  if (
    !Number.isInteger(timestampSeconds) ||
    Date.now() / 1000 - timestampSeconds > MAX_SIGNATURE_AGE_SECONDS
  ) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest();

  return signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const supplied = Buffer.from(signature, "hex");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

function objectKeys(value) {
  return value && typeof value === "object" ? Object.keys(value) : [];
}

function resultValue(results, key) {
  return results?.[key]?.value;
}

function emailValue(value) {
  return value == null ? "" : String(value);
}

function safeSubject(value) {
  return String(value ?? "New lead")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

export async function POST(request) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const rawBody = await request.text();
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!isValidSignature(request.headers.get("ElevenLabs-Signature"), rawBody, secret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data = payload?.data;
  const analysis = data?.analysis;
  const results = analysis?.data_collection_results;
  const resultShapes = Object.fromEntries(
    Object.entries(results ?? {}).map(([key, value]) => [key, objectKeys(value)]),
  );

  console.info("ElevenLabs webhook structure", JSON.stringify({
    conversation_id: data?.conversation_id ?? null,
    keys: {
      payload: objectKeys(payload),
      data: objectKeys(data),
      analysis: objectKeys(analysis),
      data_collection_results: objectKeys(results),
      data_collection_result_shapes: resultShapes,
    },
  }));

  if (payload?.type !== "post_call_transcription") {
    return new Response(null, { status: 200 });
  }

  const lead = {
    visitor_name: resultValue(results, "visitor_name"),
    business_name: resultValue(results, "business_name"),
    business_type: resultValue(results, "business_type"),
    estimated_enquiries_per_week: resultValue(results, "estimated_enquiries_per_week"),
    contact_email: resultValue(results, "contact_email"),
    contact_phone: resultValue(results, "contact_phone"),
    preferred_contact_method: resultValue(results, "preferred_contact_method"),
    interested_package: resultValue(results, "interested_package"),
    conversation_id: data?.conversation_id,
    transcript_summary: analysis?.transcript_summary,
  };

  if (!emailValue(lead.contact_email).trim() && !emailValue(lead.contact_phone).trim()) {
    return Response.json({ skipped: true }, { status: 200 });
  }

  const subjectName = lead.visitor_name || lead.business_name || "New lead";
  const preferredContactMethod = emailValue(lead.preferred_contact_method).trim();
  const text = [
    "New lead from ElevenLabs",
    "",
    `Visitor name: ${emailValue(lead.visitor_name)}`,
    `Business name: ${emailValue(lead.business_name)}`,
    `Business type: ${emailValue(lead.business_type)}`,
    `Estimated enquiries per week: ${emailValue(lead.estimated_enquiries_per_week)}`,
    `Contact email: ${emailValue(lead.contact_email)}`,
    `Phone number: ${emailValue(lead.contact_phone)}`,
    `Preferred contact method: ${emailValue(lead.preferred_contact_method)}`,
    `Interested package: ${emailValue(lead.interested_package)}`,
    ...(lead.conversation_id ? [`Conversation ID: ${emailValue(lead.conversation_id)}`] : []),
    ...(lead.transcript_summary
      ? [`Transcript summary: ${emailValue(lead.transcript_summary)}`]
      : []),
  ].join("\n");

  try {
    const port = Number(process.env.SMTP_PORT);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.NOTIFY_TO || "hello@ruknstudios.com",
      subject: safeSubject(
        `New lead: ${subjectName}${preferredContactMethod ? ` (prefers ${preferredContactMethod})` : ""}`,
      ),
      text,
    });

    return Response.json({ sent: true }, { status: 200 });
  } catch {
    return Response.json({ error: "Email delivery failed" }, { status: 500 });
  }
}