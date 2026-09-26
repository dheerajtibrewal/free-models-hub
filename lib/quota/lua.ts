/**
 * Read every counter the planner needs in ONE round-trip.
 *
 * Upstash's free plan allows 500K commands/month, so the guard is deliberately
 * frugal: one EVAL to read, one EVAL to commit, per task.
 */
export const SNAPSHOT_LUA = `
local visitor = redis.call('GET', KEYS[1])
local buckets = {}
for i = 1, #ARGV do
  buckets[i] = redis.call('HGETALL', ARGV[i])
end
return { visitor or '0', buckets }
`;

/**
 * Commit a whole run's usage atomically: bump the visitor counter and every
 * bucket field that the executed steps actually consumed.
 *
 * ARGV[1] = ttl seconds
 * ARGV[2] = JSON { "<bucketKey>": { "<field>": <delta> } }
 * ARGV[3] = visitor delta (0 lets us commit usage without charging the visitor)
 */
export const COMMIT_LUA = `
local ttl = tonumber(ARGV[1])
local incrs = cjson.decode(ARGV[2])
local visitorDelta = tonumber(ARGV[3])

if visitorDelta > 0 then
  redis.call('INCRBY', KEYS[1], visitorDelta)
  redis.call('EXPIRE', KEYS[1], ttl)
end

for bucketKey, fields in pairs(incrs) do
  for field, delta in pairs(fields) do
    if delta > 0 then
      redis.call('HINCRBY', bucketKey, field, delta)
    end
  end
  redis.call('EXPIRE', bucketKey, ttl)
end

return 1
`;
