import { Redis } from "@upstash/redis";

const buckets = new Map();

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

export function clientKey(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "local";
}

export async function rateLimit(key, limit, windowMs) {
  if (redis) {
    try {
      const now = Date.now();
      const window = Math.floor(now / windowMs);
      const redisKey = `elviscode:rl:${key}:${window}`;
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.expire(redisKey, Math.ceil(windowMs / 1000) + 5);
      if (count <= limit) return { ok: true };
      return {
        ok: false,
        retryAfter: Math.max(1, Math.ceil(((window + 1) * windowMs - now) / 1000)),
      };
    } catch {
      return { ok: true };
    }
  }

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
