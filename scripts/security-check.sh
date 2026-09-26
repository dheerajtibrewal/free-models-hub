#!/usr/bin/env bash
# Pre-push safety gate: refuse to publish anything that carries a live credential.
# Deliberately ignores obviously-synthetic test fixtures (FAKE/EXAMPLE/redacted),
# so a hit is a real hit rather than noise you learn to skip past.
set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0
pass() { printf '  \033[32mpass\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=1; }

SECRET_RE='gsk_[A-Za-z0-9]{25,}|sk-or-v1-[a-f0-9]{45,}|cfat_[A-Za-z0-9]{25,}|[A-Za-z0-9-]+\.upstash\.io|AAAAAAA[A-Za-z0-9_-]{25,}'
FAKE_RE='FAKE|EXAMPLE|redacted|placeholder|your-|xxxx'

echo "Free Models Hub — pre-push security check"
echo

hits=$(git ls-files -z | xargs -0 grep -nE "$SECRET_RE" 2>/dev/null | grep -vE "$FAKE_RE" || true)
if [ -n "$hits" ]; then fail "live credential in a tracked file:"; echo "$hits" | sed 's/^/        /'
else pass "no live credential in any tracked file"; fi

hist=$(git log --all -p 2>/dev/null | grep -E "$SECRET_RE" | grep -vE "$FAKE_RE" || true)
[ -n "$hist" ] && fail "live credential present in git history" || pass "no live credential in git history"

git check-ignore .env.local >/dev/null 2>&1 && pass ".env.local is gitignored" || {
  [ -f .env.local ] && fail ".env.local exists but is NOT ignored" || pass "no .env.local present"; }

[ "$(git ls-files | grep -cE '^\.env')" -le 1 ] && pass "only .env.example is tracked" || fail "an extra .env file is tracked"

if grep -qE '^(GROQ_API_KEY|CLOUDFLARE_API_TOKEN|OPENROUTER_API_KEY|UPSTASH_REDIS_REST_TOKEN)=.+' .env.example 2>/dev/null; then
  fail ".env.example contains a real value"
else pass ".env.example credential fields are empty"; fi

client_leak=$(for f in $(grep -rl "'use client'" app components lib 2>/dev/null); do
  grep -lE 'process\.env\.(GROQ|CLOUDFLARE|OPENROUTER|UPSTASH|VISITOR_HASH)' "$f" 2>/dev/null; done)
[ -n "$client_leak" ] && fail "server secret referenced in a client component: $client_leak" \
                      || pass "no server secret referenced in any client component"

if [ -d .next/static ]; then
  bundle=$(grep -rlE "$SECRET_RE" .next/static 2>/dev/null | grep -vE "$FAKE_RE" || true)
  [ -n "$bundle" ] && fail "credential found in the built client bundle" \
                   || pass "built client bundle is clean"
else
  printf '  \033[33mskip\033[0m  no .next build to scan (run: npm run build)\n'
fi

echo
[ $FAIL -eq 0 ] && { printf '  \033[32m► SAFE TO PUSH\033[0m\n\n'; exit 0; } \
                || { printf '  \033[31m► DO NOT PUSH\033[0m\n\n'; exit 1; }
