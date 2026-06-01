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

/** Upload a slide object (used by the seed / future per-project slide generation). */
export async function putSlide(key: string, body: ArrayBuffer | Uint8Array, contentType: string): Promise<void> {
  const { client, base } = r2();
  const res = await client.fetch(`${base}/${key}`, {
    method: "PUT",
    body,
    headers: { "content-type": contentType },
  });
  if (!res.ok) throw new Error(`R2 putSlide failed (${res.status})`);
}
