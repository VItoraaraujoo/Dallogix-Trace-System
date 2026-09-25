#!/usr/bin/env bash

trace_csrf_header() {
  local response="${1:-}"
  local token
  token="$(printf '%s' "$response" | sed -n 's/.*"csrf_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [[ -z "$token" ]]; then
    printf 'login de teste não retornou token CSRF.\n' >&2
    return 1
  fi
  printf 'X-CSRF-Token: %s' "$token"
}
