/**
 * Attachment image compaction for appkit.
 *
 * When `sharp` is installed (optionalDependency), oversized image/* payloads
 * are downscaled. Without sharp, attachments pass through unchanged.
 */

export interface CompactImageOptions {
  /** Max width or height in pixels. Default 768. */
  maxDim?: number;
  /** JPEG encode quality 1–100. Default 85. */
  jpegQuality?: number;
}

function compactDefaults(opts?: CompactImageOptions | null): { maxDim: number; quality: number } {
  return {
    maxDim: opts?.maxDim && opts.maxDim > 0 ? opts.maxDim : 768,
    quality: opts?.jpegQuality && opts.jpegQuality > 0 ? opts.jpegQuality : 85,
  };
}

type SharpModule = {
  default: (
    input: Buffer,
    options?: { failOn?: string },
  ) => {
    metadata: () => Promise<{ width?: number; height?: number }>;
    resize: (
      w: number,
      h: number,
      opts?: { fit?: string },
    ) => {
      png: () => { toBuffer: () => Promise<Buffer> };
      jpeg: (opts?: { quality?: number }) => { toBuffer: () => Promise<Buffer> };
    };
  };
};

let sharpLoader: Promise<SharpModule | null> | null = null;

async function loadSharp(): Promise<SharpModule | null> {
  if (!sharpLoader) {
    sharpLoader = (async () => {
      try {
        const m = await (Function('return import("sharp")')() as Promise<{ default: unknown }>);
        return m as unknown as SharpModule;
      } catch {
        return null;
      }
    })();
  }
  return sharpLoader;
}

/**
 * Downscales image/* payloads when either dimension exceeds MaxDim.
 * Non-images and decode failures pass through unchanged.
 * PNG stays PNG; other image types re-encode as JPEG when sharp is available.
 */
export async function compactImageAttachment(
  mimeType: string,
  dataB64: string,
  opts?: CompactImageOptions | null,
): Promise<[string, string]> {
  if (!dataB64 || !mimeType.startsWith("image/")) {
    return [mimeType, dataB64];
  }
  let raw: Buffer;
  try {
    raw = Buffer.from(dataB64, "base64");
  } catch {
    return [mimeType, dataB64];
  }
  if (raw.length === 0) return [mimeType, dataB64];

  const sharpMod = await loadSharp();
  if (!sharpMod) return [mimeType, dataB64];

  const { maxDim, quality } = compactDefaults(opts);
  try {
    const img = sharpMod.default(raw, { failOn: "none" });
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w <= 0 || h <= 0 || (w <= maxDim && h <= maxDim)) {
      return [mimeType, dataB64];
    }
    let nw = w;
    let nh = h;
    if (w >= h) {
      if (w > maxDim) {
        nw = maxDim;
        nh = Math.max(1, Math.round((h * maxDim) / w));
      }
    } else if (h > maxDim) {
      nh = maxDim;
      nw = Math.max(1, Math.round((w * maxDim) / h));
    }
    const resized = img.resize(nw, nh, { fit: "fill" });
    if (mimeType === "image/png") {
      const buf = await resized.png().toBuffer();
      return [mimeType, buf.toString("base64")];
    }
    const buf = await resized.jpeg({ quality }).toBuffer();
    return ["image/jpeg", buf.toString("base64")];
  } catch {
    return [mimeType, dataB64];
  }
}

/**
 * Applies compactImageAttachment to each attachment map with mime_type + data.
 */
export async function compactAttachments(
  atts: Record<string, unknown>[],
  opts?: CompactImageOptions | null,
): Promise<Record<string, unknown>[]> {
  if (!atts.length) return atts;
  const out: Record<string, unknown>[] = [];
  for (const att of atts) {
    const cp: Record<string, unknown> = { ...att };
    const mime = typeof cp.mime_type === "string" ? cp.mime_type : "";
    const data = typeof cp.data === "string" ? cp.data : "";
    if (mime && data) {
      const [outMime, outData] = await compactImageAttachment(mime, data, opts);
      cp.mime_type = outMime;
      cp.data = outData;
    }
    out.push(cp);
  }
  return out;
}
