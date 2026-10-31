.DEFAULT_GOAL := help
COMPOSE := docker compose

.PHONY: help build lint typecheck test test-integration test-e2e format-check compose-config obs-up obs-down obs-status obs-logs smoke-test

help:
	@echo "build          Build the NestJS application"
	@echo "lint           Run ESLint without modifying files"
	@echo "typecheck      Run the TypeScript compiler"
	@echo "test           Run unit tests"
	@echo "test-integration Run HTTP/module integration tests"
	@echo "test-e2e       Run end-to-end tests"
	@echo "format-check   Verify Prettier formatting"
	@echo "compose-config Validate Docker Compose configuration"
	@echo "obs-up         Build and start the local observability stack"
	@echo "obs-down       Stop the stack (keeps persisted volumes)"
	@echo "obs-status     Show stack container status"
	@echo "obs-logs       Follow stack logs"
	@echo "smoke-test     Check API health, metrics and Prometheus targets"

build:
	pnpm run build

lint:
	pnpm run lint

typecheck:
	pnpm run typecheck

test:
	pnpm test

test-integration:
	pnpm run test:integration

test-e2e:
	pnpm run test:e2e

format-check:
	pnpm run format:check

compose-config:
	$(COMPOSE) config --quiet

obs-up:
	$(COMPOSE) up --build --detach

obs-down:
	$(COMPOSE) down

obs-status:
	$(COMPOSE) ps

obs-logs:
	$(COMPOSE) logs --follow --tail=100

smoke-test:
	@curl --fail --silent --show-error http://localhost:3001/health >/dev/null
	@curl --fail --silent --show-error http://localhost:3001/metrics | grep 'healthcare_http_requests_total' >/dev/null
	@targets="$$(curl --fail --silent --show-error 'http://localhost:9090/api/v1/targets?state=active')"; \
		printf '%s' "$$targets" | grep -Eq '"job":"healthcare-observability-api".*"health":"up"'
	@echo "API health, metrics, and Prometheus scrape: OK"
