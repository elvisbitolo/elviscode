const buckets = new Map();

export function clientKey(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "local";
}

export function rateLimit(key, limit, windowMs) {
  const now = Date.now();

  if (buckets.size > 1000) {
    for (const [bucketKey, times] of buckets) {
      if (times.every((time) => now - time >= windowMs)) buckets.delete(bucketKey);
    }
  }

  const times = (buckets.get(key) || []).filter((time) => now - time < windowMs);

  if (times.length >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000)) };
  }

  times.push(now);
  buckets.set(key, times);
  return { ok: true };
}
