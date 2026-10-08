import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

async function loadEnvFile() {
  try {
    const contents = await readFile(new URL("../.env", import.meta.url), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] in process.env) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await loadEnvFile();

const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
if (!secret) {
  console.error("Set ELEVENLABS_WEBHOOK_SECRET in .env before running this script.");
  process.exitCode = 1;
} else {
  const payload = {
    type: "post_call_transcription",
    data: {
      conversation_id: "local-test-conversation",
      analysis: {
        transcript_summary: "Sample inquiry about a website project.",
        data_collection_results: {
          visitor_name: { value: "Sample Visitor" },
          business_name: { value: "Sample Business" },
          business_type: { value: "Retail" },
          estimated_enquiries_per_week: { value: "12" },
          contact_email: { value: "visitor@example.com" },
          contact_phone: { value: "+1 555 010 1234" },
          preferred_contact_method: { value: "phone call" },
          interested_package: { value: "Growth" },
        },
      },
    },
  };

  const phoneOnlyPayload = structuredClone(payload);
  phoneOnlyPayload.data.conversation_id = "local-test-phone-only-conversation";
  delete phoneOnlyPayload.data.analysis.data_collection_results.contact_email;

  for (const [label, testPayload] of [
    ["email and phone", payload],
    ["phone only", phoneOnlyPayload],
  ]) {
    const rawBody = JSON.stringify(testPayload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    const response = await fetch("http://localhost:3000/api/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ElevenLabs-Signature": `t=${timestamp},v0=${signature}`,
      },
      body: rawBody,
    });

    const responseBody = await response.text();
    console.log(`${label} test returned ${response.status}: ${responseBody}`);
    let result;
    try {
      result = JSON.parse(responseBody);
    } catch {
      result = null;
    }
    if (!response.ok || result?.sent !== true) process.exitCode = 1;
  }
}