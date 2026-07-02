.PHONY: dev dev-build dev-down prod prod-build prod-down logs ps

dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up

dev-build:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

dev-down:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml down

prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

prod-build:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

prod-down:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml down

logs:
	docker compose logs -f

ps:
	docker compose ps

migrate:
	docker compose exec backend alembic upgrade head

shell-backend:
	docker compose exec backend sh

shell-db:
	docker compose exec postgres psql -U mts -d mts_dev

# ── Kubernetes (local) ───────────────────────────────────────────────────────
.PHONY: k8s-build k8s-up k8s-down k8s-status k8s-logs k8s-migrate

k8s-build:
	docker build -t mts-backend:latest ./backend
	docker build -t mts-frontend:latest ./frontend

k8s-up:
	kubectl apply -k infra/k8s/

k8s-down:
	kubectl delete -k infra/k8s/

k8s-status:
	kubectl get pods,svc,ingress -n mts

k8s-logs:
	kubectl logs -n mts -l app=backend -f

k8s-migrate:
	kubectl exec -n mts deploy/backend -- alembic upgrade head
