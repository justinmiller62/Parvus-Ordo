import { AwsClient } from "aws4fetch";

// R2 (private bucket) access via the S3 API. Slides are uploaded once (seed/admin)
// and the iOS package returns short-lived presigned GET URLs — no public access.

function r2() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_SLIDES_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 is not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_SLIDES_BUCKET)");
  }
  return {
    client: new AwsClient({ accessKeyId, secretAccessKey, region: "auto", service: "s3" }),
    base: `https://${accountId}.r2.cloudflarestorage.com/${bucket}`,
  };
}

/** Short-lived presigned GET URL for a private slide object. */
export async function presignSlideUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  const { client, base } = r2();
  const url = new URL(`${base}/${key}`);
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  const signed = await client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

/** Upload a slide object (manual upload, the MCP tool, or the seed). */
export async function putSlide(key: string, body: ArrayBuffer | Uint8Array, contentType: string): Promise<void> {
  const { client, base } = r2();
  const url = `${base}/${key}`;
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);

  // aws4fetch's client.fetch wraps the body in a Request, which turns it into a
  // stream → undici sends it chunked (no Content-Length) and R2 rejects with 411.
  // So sign to get the headers, then fetch with the byte array directly: passed to
  // the global fetch (not a pre-built Request), undici sets Content-Length.
  const signed = await client.sign(url, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: bytes as unknown as ArrayBuffer,
  });
  const res = await fetch(url, {
    method: "PUT",
    headers: signed.headers,
    body: bytes as unknown as ArrayBuffer,
  });
  if (!res.ok) throw new Error(`R2 putSlide failed (${res.status})`);
}
