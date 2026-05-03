.PHONY: up down logs build migrate seed shell ps psql clickhouse-shell

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f --tail=200

build:
	docker compose build

migrate:
	docker compose run --rm migrate

seed:
	docker compose exec web node apps/web/scripts/seed.js

ps:
	docker compose ps

shell:
	docker compose exec web sh

psql:
	docker compose exec mysql mysql -uroot planetscale

clickhouse-shell:
	docker compose exec clickhouse clickhouse-client --user dub --password $${CLICKHOUSE_PASSWORD:-dub}
