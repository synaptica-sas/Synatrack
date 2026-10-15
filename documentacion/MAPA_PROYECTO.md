# Mapa del proyecto Synatrack

> **Archivo generado.** No lo edites a mano: corre `node scripts/generate-map.mjs`
> después de agregar rutas, pantallas o módulos.
> Generado el 2026-10-15.

Resumen: **168 endpoints**, **22 pantallas**,
**36 módulos de backend** y **32 de frontend**.

---

## 1. Endpoints del backend

Los roles salen del `authorize([...])` real de cada ruta. Las rutas que usan
`requirePermission("x")` se resuelven a los roles que tienen ese permiso en
`rolePermissions` (`auth/roles.ts`), que se parsea al generar el mapa.

| Método | Ruta | Roles autorizados | Archivo |
|---|---|---|---|
| GET | `/` | PUBLICO | [backend/src/routes/health.routes.ts](backend/src/routes/health.routes.ts) |
| GET | `/api/activities` | ADMIN, PM, CONSULTANT, FINANCE, VIEWER | [backend/src/modules/activities/activities.routes.ts](backend/src/modules/activities/activities.routes.ts) |
| POST | `/api/activities` | ADMIN, PM, CONSULTANT | [backend/src/modules/activities/activities.routes.ts](backend/src/modules/activities/activities.routes.ts) |
| DELETE | `/api/activities/:id` | ADMIN, PM, CONSULTANT | [backend/src/modules/activities/activities.routes.ts](backend/src/modules/activities/activities.routes.ts) |
| PUT | `/api/activities/:id` | ADMIN, PM, CONSULTANT | [backend/src/modules/activities/activities.routes.ts](backend/src/modules/activities/activities.routes.ts) |
| GET | `/api/admin/users` | ADMIN | [backend/src/modules/admin/users.routes.ts](backend/src/modules/admin/users.routes.ts) |
| POST | `/api/admin/users` | ADMIN | [backend/src/modules/admin/users.routes.ts](backend/src/modules/admin/users.routes.ts) |
| PATCH | `/api/admin/users/:id` | ADMIN | [backend/src/modules/admin/users.routes.ts](backend/src/modules/admin/users.routes.ts) |
| GET | `/api/alerts` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/alerts/alerts.routes.ts](backend/src/modules/alerts/alerts.routes.ts) |
| PATCH | `/api/alerts/:id/resolve` | ADMIN, PM, FINANCE | [backend/src/modules/alerts/alerts.routes.ts](backend/src/modules/alerts/alerts.routes.ts) |
| POST | `/api/alerts/run` | ADMIN | [backend/src/modules/alerts/alerts.routes.ts](backend/src/modules/alerts/alerts.routes.ts) |
| GET | `/api/alerts/unread-count` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/alerts/alerts.routes.ts](backend/src/modules/alerts/alerts.routes.ts) |
| GET | `/api/approval-digest` | (cualquier autenticado) | [backend/src/modules/admin/approval-digest.routes.ts](backend/src/modules/admin/approval-digest.routes.ts) |
| PUT | `/api/approval-digest` | ADMIN | [backend/src/modules/admin/approval-digest.routes.ts](backend/src/modules/admin/approval-digest.routes.ts) |
| GET | `/api/assignments` | ADMIN, PM, FINANCE, COMMERCIAL — permiso `capacity:read` | [backend/src/modules/assignments/assignments.routes.ts](backend/src/modules/assignments/assignments.routes.ts) |
| POST | `/api/assignments` | ADMIN — permiso `assignments:write` | [backend/src/modules/assignments/assignments.routes.ts](backend/src/modules/assignments/assignments.routes.ts) |
| DELETE | `/api/assignments/:id` | ADMIN — permiso `assignments:write` | [backend/src/modules/assignments/assignments.routes.ts](backend/src/modules/assignments/assignments.routes.ts) |
| GET | `/api/assignments/:id` | ADMIN, PM, FINANCE, COMMERCIAL — permiso `capacity:read` | [backend/src/modules/assignments/assignments.routes.ts](backend/src/modules/assignments/assignments.routes.ts) |
| PUT | `/api/assignments/:id` | ADMIN — permiso `assignments:write` | [backend/src/modules/assignments/assignments.routes.ts](backend/src/modules/assignments/assignments.routes.ts) |
| PATCH | `/api/assignments/:id/cancel` | ADMIN — permiso `assignments:write` | [backend/src/modules/assignments/assignments.routes.ts](backend/src/modules/assignments/assignments.routes.ts) |
| PATCH | `/api/assignments/:id/complete` | ADMIN — permiso `assignments:write` | [backend/src/modules/assignments/assignments.routes.ts](backend/src/modules/assignments/assignments.routes.ts) |
| GET | `/api/audit` | ADMIN, FINANCE, PM | [backend/src/modules/audit/audit.routes.ts](backend/src/modules/audit/audit.routes.ts) |
| GET | `/api/auth/me` | (cualquier autenticado) | [backend/src/modules/auth/auth.routes.ts](backend/src/modules/auth/auth.routes.ts) |
| GET | `/api/auth/permissions` | (cualquier autenticado) | [backend/src/modules/auth/auth.routes.ts](backend/src/modules/auth/auth.routes.ts) |
| GET | `/api/capacity/available` | ADMIN, PM, FINANCE, COMMERCIAL — permiso `capacity:read` | [backend/src/modules/capacity/capacity.routes.ts](backend/src/modules/capacity/capacity.routes.ts) |
| GET | `/api/capacity/bench` | ADMIN, PM, FINANCE, COMMERCIAL — permiso `capacity:read` | [backend/src/modules/capacity/capacity.routes.ts](backend/src/modules/capacity/capacity.routes.ts) |
| GET | `/api/capacity/by-project` | ADMIN, PM, FINANCE, COMMERCIAL — permiso `capacity:read` | [backend/src/modules/capacity/capacity.routes.ts](backend/src/modules/capacity/capacity.routes.ts) |
| GET | `/api/capacity/consultant/:consultantId` | ADMIN, PM, FINANCE, COMMERCIAL — permiso `capacity:read` | [backend/src/modules/capacity/capacity.routes.ts](backend/src/modules/capacity/capacity.routes.ts) |
| GET | `/api/capacity/monthly` | ADMIN, PM, FINANCE, COMMERCIAL — permiso `capacity:read` | [backend/src/modules/capacity/monthly.routes.ts](backend/src/modules/capacity/monthly.routes.ts) |
| GET | `/api/capacity/monthly/consultant/:id` | ADMIN, PM, FINANCE, COMMERCIAL — permiso `capacity:read` | [backend/src/modules/capacity/monthly.routes.ts](backend/src/modules/capacity/monthly.routes.ts) |
| GET | `/api/capacity/overloaded` | ADMIN, PM, FINANCE, COMMERCIAL — permiso `capacity:read` | [backend/src/modules/capacity/capacity.routes.ts](backend/src/modules/capacity/capacity.routes.ts) |
| GET | `/api/capacity/overview` | ADMIN, PM, FINANCE, COMMERCIAL — permiso `capacity:read` | [backend/src/modules/capacity/capacity.routes.ts](backend/src/modules/capacity/capacity.routes.ts) |
| GET | `/api/capacity/project/:projectId` | ADMIN, PM, FINANCE, COMMERCIAL — permiso `capacity:read` | [backend/src/modules/capacity/capacity.routes.ts](backend/src/modules/capacity/capacity.routes.ts) |
| GET | `/api/capacity/releasing` | ADMIN, PM, FINANCE, COMMERCIAL — permiso `capacity:read` | [backend/src/modules/capacity/capacity.routes.ts](backend/src/modules/capacity/capacity.routes.ts) |
| GET | `/api/capacity/settings` | ADMIN, PM, FINANCE, COMMERCIAL — permiso `capacity:read` | [backend/src/modules/capacity/settings.routes.ts](backend/src/modules/capacity/settings.routes.ts) |
| PUT | `/api/capacity/settings` | ADMIN — permiso `capacity:config` | [backend/src/modules/capacity/settings.routes.ts](backend/src/modules/capacity/settings.routes.ts) |
| GET | `/api/capacity/workday` | ADMIN — permiso `capacity:config` | [backend/src/modules/capacity/workday.routes.ts](backend/src/modules/capacity/workday.routes.ts) |
| DELETE | `/api/capacity/workday/consultant/:consultantId` | ADMIN — permiso `capacity:config` | [backend/src/modules/capacity/workday.routes.ts](backend/src/modules/capacity/workday.routes.ts) |
| PUT | `/api/capacity/workday/consultant/:consultantId` | ADMIN — permiso `capacity:config` | [backend/src/modules/capacity/workday.routes.ts](backend/src/modules/capacity/workday.routes.ts) |
| DELETE | `/api/capacity/workday/country/:country` | ADMIN — permiso `capacity:config` | [backend/src/modules/capacity/workday.routes.ts](backend/src/modules/capacity/workday.routes.ts) |
| PUT | `/api/capacity/workday/country/:country` | ADMIN — permiso `capacity:config` | [backend/src/modules/capacity/workday.routes.ts](backend/src/modules/capacity/workday.routes.ts) |
| GET | `/api/capacity/workday/effective` | (cualquier autenticado) | [backend/src/modules/capacity/workday.routes.ts](backend/src/modules/capacity/workday.routes.ts) |
| GET | `/api/consultants` | ADMIN, PM, CONSULTANT, FINANCE, VIEWER | [backend/src/modules/consultants/consultants.routes.ts](backend/src/modules/consultants/consultants.routes.ts) |
| POST | `/api/consultants` | ADMIN, PM | [backend/src/modules/consultants/consultants.routes.ts](backend/src/modules/consultants/consultants.routes.ts) |
| GET | `/api/consultants/:consultantId/blocks` | ADMIN, PM, FINANCE, COMMERCIAL — permiso `capacity:read` | [backend/src/modules/capacity/blocks.routes.ts](backend/src/modules/capacity/blocks.routes.ts) |
| POST | `/api/consultants/:consultantId/blocks` | ADMIN — permiso `assignments:write` | [backend/src/modules/capacity/blocks.routes.ts](backend/src/modules/capacity/blocks.routes.ts) |
| DELETE | `/api/consultants/:consultantId/blocks/:blockId` | ADMIN — permiso `assignments:write` | [backend/src/modules/capacity/blocks.routes.ts](backend/src/modules/capacity/blocks.routes.ts) |
| DELETE | `/api/consultants/:id` | ADMIN | [backend/src/modules/consultants/consultants.routes.ts](backend/src/modules/consultants/consultants.routes.ts) |
| PUT | `/api/consultants/:id` | ADMIN, PM | [backend/src/modules/consultants/consultants.routes.ts](backend/src/modules/consultants/consultants.routes.ts) |
| DELETE | `/api/consultants/by-name` | ADMIN | [backend/src/modules/consultants/consultants.routes.ts](backend/src/modules/consultants/consultants.routes.ts) |
| GET | `/api/custom-holidays` | ADMIN, PM, CONSULTANT, FINANCE, COMMERCIAL, VIEWER — permiso `holidays:read` | [backend/src/modules/holidays/custom-holidays.routes.ts](backend/src/modules/holidays/custom-holidays.routes.ts) |
| POST | `/api/custom-holidays` | ADMIN — permiso `holidays:write` | [backend/src/modules/holidays/custom-holidays.routes.ts](backend/src/modules/holidays/custom-holidays.routes.ts) |
| DELETE | `/api/custom-holidays/:id` | ADMIN — permiso `holidays:write` | [backend/src/modules/holidays/custom-holidays.routes.ts](backend/src/modules/holidays/custom-holidays.routes.ts) |
| GET | `/api/delegations` | ADMIN, PM, FINANCE | [backend/src/modules/delegations/delegations.routes.ts](backend/src/modules/delegations/delegations.routes.ts) |
| POST | `/api/delegations` | ADMIN, PM | [backend/src/modules/delegations/delegations.routes.ts](backend/src/modules/delegations/delegations.routes.ts) |
| DELETE | `/api/delegations/:id` | ADMIN, PM | [backend/src/modules/delegations/delegations.routes.ts](backend/src/modules/delegations/delegations.routes.ts) |
| GET | `/api/delegations/candidates` | ADMIN, PM | [backend/src/modules/delegations/delegations.routes.ts](backend/src/modules/delegations/delegations.routes.ts) |
| GET | `/api/estimations` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/estimations/estimations.routes.ts](backend/src/modules/estimations/estimations.routes.ts) |
| POST | `/api/estimations` | ADMIN, PM | [backend/src/modules/estimations/estimations.routes.ts](backend/src/modules/estimations/estimations.routes.ts) |
| DELETE | `/api/estimations/:id` | ADMIN, PM | [backend/src/modules/estimations/estimations.routes.ts](backend/src/modules/estimations/estimations.routes.ts) |
| GET | `/api/estimations/project/:projectId` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/estimations/estimations.routes.ts](backend/src/modules/estimations/estimations.routes.ts) |
| GET | `/api/expenses` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/expenses/expenses.routes.ts](backend/src/modules/expenses/expenses.routes.ts) |
| POST | `/api/expenses` | ADMIN, PM, FINANCE | [backend/src/modules/expenses/expenses.routes.ts](backend/src/modules/expenses/expenses.routes.ts) |
| DELETE | `/api/expenses/:id` | ADMIN, PM, FINANCE | [backend/src/modules/expenses/expenses.routes.ts](backend/src/modules/expenses/expenses.routes.ts) |
| PUT | `/api/expenses/:id` | ADMIN, PM, FINANCE | [backend/src/modules/expenses/expenses.routes.ts](backend/src/modules/expenses/expenses.routes.ts) |
| GET | `/api/extra-hours` | ADMIN, PM, CONSULTANT, FINANCE, VIEWER | [backend/src/modules/extra-hours/extra-hours.routes.ts](backend/src/modules/extra-hours/extra-hours.routes.ts) |
| POST | `/api/extra-hours` | ADMIN, PM, CONSULTANT | [backend/src/modules/extra-hours/extra-hours.routes.ts](backend/src/modules/extra-hours/extra-hours.routes.ts) |
| DELETE | `/api/extra-hours/:id` | ADMIN, PM | [backend/src/modules/extra-hours/extra-hours.routes.ts](backend/src/modules/extra-hours/extra-hours.routes.ts) |
| PATCH | `/api/extra-hours/:id/approve` | (cualquier autenticado) | [backend/src/modules/extra-hours/extra-hours.routes.ts](backend/src/modules/extra-hours/extra-hours.routes.ts) |
| PATCH | `/api/extra-hours/:id/reject` | (cualquier autenticado) | [backend/src/modules/extra-hours/extra-hours.routes.ts](backend/src/modules/extra-hours/extra-hours.routes.ts) |
| POST | `/api/extra-hours/calculate` | ADMIN, PM, CONSULTANT | [backend/src/modules/extra-hours/extra-hours.routes.ts](backend/src/modules/extra-hours/extra-hours.routes.ts) |
| GET | `/api/extra-hours/config` | ADMIN, PM, CONSULTANT, FINANCE | [backend/src/modules/extra-hours/extra-hours.routes.ts](backend/src/modules/extra-hours/extra-hours.routes.ts) |
| GET | `/api/extra-hours/config/:country` | ADMIN, PM, CONSULTANT, FINANCE | [backend/src/modules/extra-hours/extra-hours.routes.ts](backend/src/modules/extra-hours/extra-hours.routes.ts) |
| PUT | `/api/extra-hours/config/:country` | ADMIN, PM, FINANCE | [backend/src/modules/extra-hours/extra-hours.routes.ts](backend/src/modules/extra-hours/extra-hours.routes.ts) |
| POST | `/api/extra-hours/config/:country/reset` | ADMIN, PM, FINANCE | [backend/src/modules/extra-hours/extra-hours.routes.ts](backend/src/modules/extra-hours/extra-hours.routes.ts) |
| GET | `/api/extra-hours/countries` | ADMIN, PM, CONSULTANT, FINANCE, VIEWER | [backend/src/modules/extra-hours/extra-hours.routes.ts](backend/src/modules/extra-hours/extra-hours.routes.ts) |
| GET | `/api/extra-hours/holidays` | ADMIN, PM, CONSULTANT, FINANCE, VIEWER | [backend/src/modules/extra-hours/extra-hours.routes.ts](backend/src/modules/extra-hours/extra-hours.routes.ts) |
| GET | `/api/extra-hours/payroll` | ADMIN, FINANCE | [backend/src/modules/extra-hours/extra-hours.routes.ts](backend/src/modules/extra-hours/extra-hours.routes.ts) |
| POST | `/api/feedback` | (cualquier autenticado) | [backend/src/modules/feedback/feedback.routes.ts](backend/src/modules/feedback/feedback.routes.ts) |
| GET | `/api/financial-categories` | ADMIN, PM, FINANCE, CONSULTANT, VIEWER | [backend/src/modules/financial-categories/financial-categories.routes.ts](backend/src/modules/financial-categories/financial-categories.routes.ts) |
| POST | `/api/financial-categories` | ADMIN | [backend/src/modules/financial-categories/financial-categories.routes.ts](backend/src/modules/financial-categories/financial-categories.routes.ts) |
| DELETE | `/api/financial-categories/:id` | ADMIN | [backend/src/modules/financial-categories/financial-categories.routes.ts](backend/src/modules/financial-categories/financial-categories.routes.ts) |
| PUT | `/api/financial-categories/:id` | ADMIN | [backend/src/modules/financial-categories/financial-categories.routes.ts](backend/src/modules/financial-categories/financial-categories.routes.ts) |
| GET | `/api/financial-entries` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/financial-entries/financial-entries.routes.ts](backend/src/modules/financial-entries/financial-entries.routes.ts) |
| GET | `/api/forecasts` | ADMIN, PM, FINANCE | [backend/src/modules/forecasts/forecasts.routes.ts](backend/src/modules/forecasts/forecasts.routes.ts) |
| POST | `/api/forecasts` | ADMIN, PM | [backend/src/modules/forecasts/forecasts.routes.ts](backend/src/modules/forecasts/forecasts.routes.ts) |
| DELETE | `/api/forecasts/:id` | ADMIN, PM | [backend/src/modules/forecasts/forecasts.routes.ts](backend/src/modules/forecasts/forecasts.routes.ts) |
| PUT | `/api/forecasts/:id` | ADMIN, PM | [backend/src/modules/forecasts/forecasts.routes.ts](backend/src/modules/forecasts/forecasts.routes.ts) |
| GET | `/api/fx` | ADMIN, PM, FINANCE, VIEWER, CONSULTANT | [backend/src/modules/fx/fx.routes.ts](backend/src/modules/fx/fx.routes.ts) |
| PUT | `/api/fx` | ADMIN, FINANCE | [backend/src/modules/fx/fx.routes.ts](backend/src/modules/fx/fx.routes.ts) |
| DELETE | `/api/fx/:id` | ADMIN, FINANCE | [backend/src/modules/fx/fx.routes.ts](backend/src/modules/fx/fx.routes.ts) |
| GET | `/api/fx/history` | ADMIN, FINANCE, VIEWER | [backend/src/modules/fx/fx.routes.ts](backend/src/modules/fx/fx.routes.ts) |
| GET | `/api/fx/rate` | ADMIN, PM, FINANCE, VIEWER, CONSULTANT | [backend/src/modules/fx/fx.routes.ts](backend/src/modules/fx/fx.routes.ts) |
| POST | `/api/fx/sync` | PUBLICO | [backend/src/modules/fx/fx.routes.ts](backend/src/modules/fx/fx.routes.ts) |
| DELETE | `/api/health-thresholds` | ADMIN | [backend/src/modules/admin/health-thresholds.routes.ts](backend/src/modules/admin/health-thresholds.routes.ts) |
| GET | `/api/health-thresholds` | (cualquier autenticado) | [backend/src/modules/admin/health-thresholds.routes.ts](backend/src/modules/admin/health-thresholds.routes.ts) |
| PUT | `/api/health-thresholds` | ADMIN | [backend/src/modules/admin/health-thresholds.routes.ts](backend/src/modules/admin/health-thresholds.routes.ts) |
| GET | `/api/holidays` | ADMIN, PM, CONSULTANT, FINANCE, COMMERCIAL, VIEWER — permiso `holidays:read` | [backend/src/modules/holidays/holidays.routes.ts](backend/src/modules/holidays/holidays.routes.ts) |
| POST | `/api/holidays` | ADMIN — permiso `holidays:write` | [backend/src/modules/holidays/holidays.routes.ts](backend/src/modules/holidays/holidays.routes.ts) |
| DELETE | `/api/holidays/:id` | ADMIN — permiso `holidays:write` | [backend/src/modules/holidays/holidays.routes.ts](backend/src/modules/holidays/holidays.routes.ts) |
| PUT | `/api/holidays/:id` | ADMIN — permiso `holidays:write` | [backend/src/modules/holidays/holidays.routes.ts](backend/src/modules/holidays/holidays.routes.ts) |
| DELETE | `/api/holidays/calendar-years/:country/:year` | ADMIN — permiso `holidays:write` | [backend/src/modules/holidays/holidays.routes.ts](backend/src/modules/holidays/holidays.routes.ts) |
| PUT | `/api/holidays/calendar-years/:country/:year` | ADMIN — permiso `holidays:write` | [backend/src/modules/holidays/holidays.routes.ts](backend/src/modules/holidays/holidays.routes.ts) |
| GET | `/api/holidays/cities` | ADMIN, PM, CONSULTANT, FINANCE, COMMERCIAL, VIEWER — permiso `holidays:read` | [backend/src/modules/holidays/holidays.routes.ts](backend/src/modules/holidays/holidays.routes.ts) |
| GET | `/api/holidays/coverage` | ADMIN, PM, CONSULTANT, FINANCE, COMMERCIAL, VIEWER — permiso `holidays:read` | [backend/src/modules/holidays/holidays.routes.ts](backend/src/modules/holidays/holidays.routes.ts) |
| POST | `/api/holidays/generate` | ADMIN — permiso `holidays:write` | [backend/src/modules/holidays/holidays.routes.ts](backend/src/modules/holidays/holidays.routes.ts) |
| POST | `/api/jobs/run` | PUBLICO | [backend/src/modules/jobs/jobs.routes.ts](backend/src/modules/jobs/jobs.routes.ts) |
| GET | `/api/jobs/status` | PUBLICO | [backend/src/modules/jobs/jobs.routes.ts](backend/src/modules/jobs/jobs.routes.ts) |
| GET | `/api/profile` | (cualquier autenticado) | [backend/src/modules/profile/profile.routes.ts](backend/src/modules/profile/profile.routes.ts) |
| PUT | `/api/profile` | (cualquier autenticado) | [backend/src/modules/profile/profile.routes.ts](backend/src/modules/profile/profile.routes.ts) |
| GET | `/api/project-categories` | ADMIN, PM, CONSULTANT, FINANCE, VIEWER | [backend/src/modules/project-categories/project-categories.routes.ts](backend/src/modules/project-categories/project-categories.routes.ts) |
| GET | `/api/projects` | ADMIN, PM, CONSULTANT, FINANCE, VIEWER | [backend/src/modules/projects/projects.routes.ts](backend/src/modules/projects/projects.routes.ts) |
| POST | `/api/projects` | ADMIN, PM | [backend/src/modules/projects/projects.routes.ts](backend/src/modules/projects/projects.routes.ts) |
| DELETE | `/api/projects/:id` | ADMIN, PM | [backend/src/modules/projects/projects.routes.ts](backend/src/modules/projects/projects.routes.ts) |
| GET | `/api/projects/:id` | ADMIN, PM, CONSULTANT, FINANCE, VIEWER | [backend/src/modules/projects/projects.routes.ts](backend/src/modules/projects/projects.routes.ts) |
| PUT | `/api/projects/:id` | ADMIN, PM | [backend/src/modules/projects/projects.routes.ts](backend/src/modules/projects/projects.routes.ts) |
| PATCH | `/api/projects/:id/baseline` | ADMIN, PM | [backend/src/modules/projects/project-detail.routes.ts](backend/src/modules/projects/project-detail.routes.ts) |
| PATCH | `/api/projects/:id/completion` | ADMIN, PM | [backend/src/modules/projects/project-detail.routes.ts](backend/src/modules/projects/project-detail.routes.ts) |
| GET | `/api/projects/:id/detail` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/projects/project-detail.routes.ts](backend/src/modules/projects/project-detail.routes.ts) |
| PATCH | `/api/projects/:id/health` | ADMIN, PM | [backend/src/modules/projects/project-detail.routes.ts](backend/src/modules/projects/project-detail.routes.ts) |
| PATCH | `/api/projects/:id/phase` | ADMIN, PM | [backend/src/modules/projects/project-detail.routes.ts](backend/src/modules/projects/project-detail.routes.ts) |
| GET | `/api/projects/:id/profitability` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/projects/projects.routes.ts](backend/src/modules/projects/projects.routes.ts) |
| GET | `/api/projects/:id/timeline` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/projects/project-detail.routes.ts](backend/src/modules/projects/project-detail.routes.ts) |
| GET | `/api/projects/:projectId/changes` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/projects/change-requests.routes.ts](backend/src/modules/projects/change-requests.routes.ts) |
| POST | `/api/projects/:projectId/changes` | ADMIN, PM, FINANCE | [backend/src/modules/projects/change-requests.routes.ts](backend/src/modules/projects/change-requests.routes.ts) |
| DELETE | `/api/projects/:projectId/changes/:id` | ADMIN, PM | [backend/src/modules/projects/change-requests.routes.ts](backend/src/modules/projects/change-requests.routes.ts) |
| PATCH | `/api/projects/:projectId/changes/:id/approve` | ADMIN, PM | [backend/src/modules/projects/change-requests.routes.ts](backend/src/modules/projects/change-requests.routes.ts) |
| PATCH | `/api/projects/:projectId/changes/:id/reject` | ADMIN, PM | [backend/src/modules/projects/change-requests.routes.ts](backend/src/modules/projects/change-requests.routes.ts) |
| GET | `/api/projects/:projectId/issues` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/projects/issues.routes.ts](backend/src/modules/projects/issues.routes.ts) |
| POST | `/api/projects/:projectId/issues` | ADMIN, PM, FINANCE | [backend/src/modules/projects/issues.routes.ts](backend/src/modules/projects/issues.routes.ts) |
| DELETE | `/api/projects/:projectId/issues/:id` | ADMIN, PM | [backend/src/modules/projects/issues.routes.ts](backend/src/modules/projects/issues.routes.ts) |
| PUT | `/api/projects/:projectId/issues/:id` | ADMIN, PM, FINANCE | [backend/src/modules/projects/issues.routes.ts](backend/src/modules/projects/issues.routes.ts) |
| PATCH | `/api/projects/:projectId/issues/:id/resolve` | ADMIN, PM | [backend/src/modules/projects/issues.routes.ts](backend/src/modules/projects/issues.routes.ts) |
| GET | `/api/projects/:projectId/milestones` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/projects/milestones.routes.ts](backend/src/modules/projects/milestones.routes.ts) |
| POST | `/api/projects/:projectId/milestones` | ADMIN, PM | [backend/src/modules/projects/milestones.routes.ts](backend/src/modules/projects/milestones.routes.ts) |
| DELETE | `/api/projects/:projectId/milestones/:id` | ADMIN, PM | [backend/src/modules/projects/milestones.routes.ts](backend/src/modules/projects/milestones.routes.ts) |
| PUT | `/api/projects/:projectId/milestones/:id` | ADMIN, PM | [backend/src/modules/projects/milestones.routes.ts](backend/src/modules/projects/milestones.routes.ts) |
| PATCH | `/api/projects/:projectId/milestones/:id/complete` | ADMIN, PM | [backend/src/modules/projects/milestones.routes.ts](backend/src/modules/projects/milestones.routes.ts) |
| PATCH | `/api/projects/:projectId/milestones/:id/status` | ADMIN, PM | [backend/src/modules/projects/milestones.routes.ts](backend/src/modules/projects/milestones.routes.ts) |
| GET | `/api/projects/:projectId/risks` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/projects/risks.routes.ts](backend/src/modules/projects/risks.routes.ts) |
| POST | `/api/projects/:projectId/risks` | ADMIN, PM | [backend/src/modules/projects/risks.routes.ts](backend/src/modules/projects/risks.routes.ts) |
| DELETE | `/api/projects/:projectId/risks/:id` | ADMIN, PM | [backend/src/modules/projects/risks.routes.ts](backend/src/modules/projects/risks.routes.ts) |
| PUT | `/api/projects/:projectId/risks/:id` | ADMIN, PM | [backend/src/modules/projects/risks.routes.ts](backend/src/modules/projects/risks.routes.ts) |
| PATCH | `/api/projects/:projectId/risks/:id/status` | ADMIN, PM | [backend/src/modules/projects/risks.routes.ts](backend/src/modules/projects/risks.routes.ts) |
| GET | `/api/revenue` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/revenue/revenue.routes.ts](backend/src/modules/revenue/revenue.routes.ts) |
| POST | `/api/revenue` | ADMIN, PM, FINANCE | [backend/src/modules/revenue/revenue.routes.ts](backend/src/modules/revenue/revenue.routes.ts) |
| DELETE | `/api/revenue/:id` | ADMIN, PM, FINANCE | [backend/src/modules/revenue/revenue.routes.ts](backend/src/modules/revenue/revenue.routes.ts) |
| PUT | `/api/revenue/:id` | ADMIN, PM, FINANCE | [backend/src/modules/revenue/revenue.routes.ts](backend/src/modules/revenue/revenue.routes.ts) |
| GET | `/api/snapshots` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/snapshots/snapshots.routes.ts](backend/src/modules/snapshots/snapshots.routes.ts) |
| POST | `/api/snapshots/close` | ADMIN, FINANCE | [backend/src/modules/snapshots/snapshots.routes.ts](backend/src/modules/snapshots/snapshots.routes.ts) |
| GET | `/api/snapshots/trend/:projectId` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/snapshots/snapshots.routes.ts](backend/src/modules/snapshots/snapshots.routes.ts) |
| GET | `/api/stats/overview` | ADMIN, PM, CONSULTANT, FINANCE, VIEWER | [backend/src/modules/stats/stats.routes.ts](backend/src/modules/stats/stats.routes.ts) |
| GET | `/api/stats/portfolio` | ADMIN, PM, FINANCE, VIEWER | [backend/src/modules/stats/stats.routes.ts](backend/src/modules/stats/stats.routes.ts) |
| GET | `/api/time-entries` | ADMIN, PM, CONSULTANT, VIEWER | [backend/src/modules/time-entries/time-entries.routes.ts](backend/src/modules/time-entries/time-entries.routes.ts) |
| POST | `/api/time-entries` | ADMIN, PM, CONSULTANT | [backend/src/modules/time-entries/time-entries.routes.ts](backend/src/modules/time-entries/time-entries.routes.ts) |
| DELETE | `/api/time-entries/:id` | ADMIN, PM, CONSULTANT | [backend/src/modules/time-entries/time-entries.routes.ts](backend/src/modules/time-entries/time-entries.routes.ts) |
| PATCH | `/api/time-entries/:id` | ADMIN, PM, CONSULTANT | [backend/src/modules/time-entries/time-entries.routes.ts](backend/src/modules/time-entries/time-entries.routes.ts) |
| PATCH | `/api/time-entries/:id/approve` | ADMIN, PM | [backend/src/modules/time-entries/time-entries.routes.ts](backend/src/modules/time-entries/time-entries.routes.ts) |
| PATCH | `/api/time-entries/:id/reject` | ADMIN, PM | [backend/src/modules/time-entries/time-entries.routes.ts](backend/src/modules/time-entries/time-entries.routes.ts) |
| GET | `/api/time-entries/descriptions` | ADMIN, PM, CONSULTANT | [backend/src/modules/time-entries/time-entries.routes.ts](backend/src/modules/time-entries/time-entries.routes.ts) |
| GET | `/api/time-entries/me` | ADMIN, PM, CONSULTANT, FINANCE, VIEWER | [backend/src/modules/time-entries/time-entries.routes.ts](backend/src/modules/time-entries/time-entries.routes.ts) |
| POST | `/api/time-entries/merge-task` | ADMIN, PM, CONSULTANT | [backend/src/modules/time-entries/time-entries.routes.ts](backend/src/modules/time-entries/time-entries.routes.ts) |
| DELETE | `/api/timer` | (cualquier autenticado) | [backend/src/modules/timer/timer.routes.ts](backend/src/modules/timer/timer.routes.ts) |
| GET | `/api/timer` | ...WRITE_ROLES, FINANCE, VIEWER | [backend/src/modules/timer/timer.routes.ts](backend/src/modules/timer/timer.routes.ts) |
| PATCH | `/api/timer` | (cualquier autenticado) | [backend/src/modules/timer/timer.routes.ts](backend/src/modules/timer/timer.routes.ts) |
| POST | `/api/timer/start` | (cualquier autenticado) | [backend/src/modules/timer/timer.routes.ts](backend/src/modules/timer/timer.routes.ts) |
| POST | `/api/timer/stop` | (cualquier autenticado) | [backend/src/modules/timer/timer.routes.ts](backend/src/modules/timer/timer.routes.ts) |
| GET | `/health` | PUBLICO | [backend/src/routes/health.routes.ts](backend/src/routes/health.routes.ts) |

---

## 2. Pantallas del frontend

El permiso es el que decide si la pestaña aparece en el sidebar.

| Grupo | Pantalla | TabId | Permiso | Componente |
|---|---|---|---|---|
| Gobierno | Dashboard | `dashboard` | `stats:read` | [frontend/src/features/dashboard/DashboardTab.tsx](frontend/src/features/dashboard/DashboardTab.tsx) |
| Gobierno | Portafolio | `portfolio` | `stats:read` | [frontend/src/features/portfolio/PortfolioTab.tsx](frontend/src/features/portfolio/PortfolioTab.tsx) |
| Gobierno | Proyectos | `projects` | `projects:read` | [frontend/src/features/projects/ProjectsTab.tsx](frontend/src/features/projects/ProjectsTab.tsx) |
| Gobierno | Capacidad | `capacity` | `capacity:read` | [frontend/src/features/capacity/CapacityTab.tsx](frontend/src/features/capacity/CapacityTab.tsx) |
| Operación | Consultores | `consultants` | `consultants:read` | [frontend/src/features/consultants/ConsultantsTab.tsx](frontend/src/features/consultants/ConsultantsTab.tsx) |
| Operación | Rastreador | `tracker` | `time:read` | [frontend/src/features/tracker/TrackerTab.tsx](frontend/src/features/tracker/TrackerTab.tsx) |
| Operación | Horas | `timeEntries` | `time:read` | - |
| Operación | Informes | `reports` | `stats:read` | [frontend/src/features/reports/ReportsTab.tsx](frontend/src/features/reports/ReportsTab.tsx) |
| Operación | Actividades | `activities` | `activities:manage` | [frontend/src/features/activities/ActivitiesTab.tsx](frontend/src/features/activities/ActivitiesTab.tsx) |
| Operación | Horas Extra | `extraHours` | `extrahours:read` | [frontend/src/features/extraHours/ExtraHoursTab.tsx](frontend/src/features/extraHours/ExtraHoursTab.tsx) |
| Financiero | Ingresos/Gastos | `financial` | `-` | [frontend/src/features/financial/FinancialTab.tsx](frontend/src/features/financial/FinancialTab.tsx) |
| Financiero | Proyecciones | `forecasts` | `forecasts:read` | [frontend/src/features/forecasts/ForecastsTab.tsx](frontend/src/features/forecasts/ForecastsTab.tsx) |
| Financiero | Estimaciones | `estimations` | `estimations:read` | [frontend/src/features/estimations/EstimationCalculatorTab.tsx](frontend/src/features/estimations/EstimationCalculatorTab.tsx) |
| Financiero | Tasas FX | `fx` | `fx:read` | [frontend/src/features/fx/FxTab.tsx](frontend/src/features/fx/FxTab.tsx) |
| Administración | Usuarios | `admin` | `users:manage` | [frontend/src/features/admin/AdminTab.tsx](frontend/src/features/admin/AdminTab.tsx) |
| Administración | Config. Horas Extra | `extraHoursConfig` | `extrahours:config` | - |
| Administración | Parámetros y Jornada | `workdayConfig` | `capacity:config` | - |
| Administración | Feriados | `holidays` | `holidays:write` | [frontend/src/features/holidays/HolidaysTab.tsx](frontend/src/features/holidays/HolidaysTab.tsx) |
| Administración | Umbrales de Salud | `healthThresholds` | `health:thresholds` | - |
| Administración | Resumen de Aprobaciones | `approvalDigest` | `notifications:digest` | - |
| Administración | Categorías Financieras | `financialCategories` | `finance:categories` | - |
| Administración | Auditoría | `audit` | `users:manage` | [frontend/src/features/audit/AuditTab.tsx](frontend/src/features/audit/AuditTab.tsx) |

---

## 3. Grafo de dependencias — Backend

Cada flecha va del módulo que importa al importado; el número es la cantidad de imports.

```mermaid
graph LR
  n0["modules/capacity"] -->|13| n1["utils"]
  n2["modules/projects"] -->|10| n1["utils"]
  n0["modules/capacity"] -->|7| n3["auth"]
  n2["modules/projects"] -->|7| n3["auth"]
  n4["modules/admin"] -->|6| n1["utils"]
  n5["modules/alerts"] -->|6| n1["utils"]
  n0["modules/capacity"] -->|6| n6["infra"]
  n7["modules/extra-hours"] -->|6| n1["utils"]
  n8["modules/holidays"] -->|6| n1["utils"]
  n2["modules/projects"] -->|6| n6["infra"]
  n9["routes"] -->|6| n2["modules/projects"]
  n10["modules/stats"] -->|5| n1["utils"]
  n9["routes"] -->|5| n0["modules/capacity"]
  n11["modules/assignments"] -->|4| n1["utils"]
  n12["modules/consultants"] -->|4| n1["utils"]
  n4["modules/admin"] -->|3| n3["auth"]
  n4["modules/admin"] -->|3| n6["infra"]
  n13["modules/jobs"] -->|3| n6["infra"]
  n14["modules/time-entries"] -->|3| n1["utils"]
  n9["routes"] -->|3| n4["modules/admin"]
  n1["utils"] -->|3| n6["infra"]
  n15["modules/activities"] -->|2| n1["utils"]
  n5["modules/alerts"] -->|2| n3["auth"]
  n5["modules/alerts"] -->|2| n6["infra"]
  n16["modules/approvals"] -->|2| n1["utils"]
  n11["modules/assignments"] -->|2| n6["infra"]
  n17["modules/auth"] -->|2| n3["auth"]
  n18["modules/delegations"] -->|2| n6["infra"]
  n19["modules/expenses"] -->|2| n1["utils"]
  n20["modules/forecasts"] -->|2| n1["utils"]
  n21["modules/fx"] -->|2| n3["auth"]
  n8["modules/holidays"] -->|2| n3["auth"]
  n8["modules/holidays"] -->|2| n6["infra"]
  n13["modules/jobs"] -->|2| n22["config"]
  n2["modules/projects"] -->|2| n4["modules/admin"]
  n23["modules/snapshots"] -->|2| n1["utils"]
  n9["routes"] -->|2| n6["infra"]
  n9["routes"] -->|2| n13["modules/jobs"]
  n9["routes"] -->|2| n8["modules/holidays"]
  n24["app"] -->|1| n22["config"]
  n24["app"] -->|1| n9["routes"]
  n24["app"] -->|1| n6["infra"]
  n3["auth"] -->|1| n22["config"]
  n3["auth"] -->|1| n6["infra"]
  n15["modules/activities"] -->|1| n3["auth"]
  n15["modules/activities"] -->|1| n6["infra"]
  n5["modules/alerts"] -->|1| n4["modules/admin"]
  n5["modules/alerts"] -->|1| n21["modules/fx"]
  n16["modules/approvals"] -->|1| n6["infra"]
  n11["modules/assignments"] -->|1| n3["auth"]
  n11["modules/assignments"] -->|1| n0["modules/capacity"]
  n25["modules/audit"] -->|1| n3["auth"]
  n25["modules/audit"] -->|1| n6["infra"]
  n25["modules/audit"] -->|1| n1["utils"]
  n17["modules/auth"] -->|1| n6["infra"]
  n12["modules/consultants"] -->|1| n3["auth"]
  n12["modules/consultants"] -->|1| n6["infra"]
  n18["modules/delegations"] -->|1| n3["auth"]
  n18["modules/delegations"] -->|1| n1["utils"]
  n26["modules/estimations"] -->|1| n3["auth"]
  n26["modules/estimations"] -->|1| n6["infra"]
  n26["modules/estimations"] -->|1| n1["utils"]
  n19["modules/expenses"] -->|1| n3["auth"]
  n19["modules/expenses"] -->|1| n6["infra"]
  n19["modules/expenses"] -->|1| n21["modules/fx"]
  n7["modules/extra-hours"] -->|1| n3["auth"]
  n7["modules/extra-hours"] -->|1| n6["infra"]
  n7["modules/extra-hours"] -->|1| n4["modules/admin"]
  n27["modules/feedback"] -->|1| n3["auth"]
  n27["modules/feedback"] -->|1| n1["utils"]
  n28["modules/financial-categories"] -->|1| n3["auth"]
  n28["modules/financial-categories"] -->|1| n6["infra"]
  n28["modules/financial-categories"] -->|1| n1["utils"]
  n29["modules/financial-entries"] -->|1| n3["auth"]
  n29["modules/financial-entries"] -->|1| n6["infra"]
  n20["modules/forecasts"] -->|1| n3["auth"]
  n20["modules/forecasts"] -->|1| n6["infra"]
  n21["modules/fx"] -->|1| n22["config"]
  n21["modules/fx"] -->|1| n6["infra"]
  n21["modules/fx"] -->|1| n13["modules/jobs"]
  n21["modules/fx"] -->|1| n1["utils"]
  n13["modules/jobs"] -->|1| n1["utils"]
  n13["modules/jobs"] -->|1| n3["auth"]
  n13["modules/jobs"] -->|1| n5["modules/alerts"]
  n13["modules/jobs"] -->|1| n16["modules/approvals"]
  n13["modules/jobs"] -->|1| n11["modules/assignments"]
  n30["modules/profile"] -->|1| n3["auth"]
  n30["modules/profile"] -->|1| n6["infra"]
  n31["modules/project-categories"] -->|1| n3["auth"]
  n31["modules/project-categories"] -->|1| n6["infra"]
  n2["modules/projects"] -->|1| n21["modules/fx"]
  n32["modules/revenue"] -->|1| n3["auth"]
  n32["modules/revenue"] -->|1| n6["infra"]
  n32["modules/revenue"] -->|1| n1["utils"]
  n32["modules/revenue"] -->|1| n28["modules/financial-categories"]
  n23["modules/snapshots"] -->|1| n3["auth"]
  n23["modules/snapshots"] -->|1| n6["infra"]
  n10["modules/stats"] -->|1| n3["auth"]
  n10["modules/stats"] -->|1| n6["infra"]
  n10["modules/stats"] -->|1| n21["modules/fx"]
  n10["modules/stats"] -->|1| n4["modules/admin"]
  n14["modules/time-entries"] -->|1| n3["auth"]
  n14["modules/time-entries"] -->|1| n6["infra"]
  n33["modules/timer"] -->|1| n3["auth"]
  n33["modules/timer"] -->|1| n6["infra"]
  n33["modules/timer"] -->|1| n1["utils"]
  n9["routes"] -->|1| n1["utils"]
  n9["routes"] -->|1| n31["modules/project-categories"]
  n9["routes"] -->|1| n12["modules/consultants"]
  n9["routes"] -->|1| n14["modules/time-entries"]
  n9["routes"] -->|1| n19["modules/expenses"]
  n9["routes"] -->|1| n20["modules/forecasts"]
  n9["routes"] -->|1| n10["modules/stats"]
  n9["routes"] -->|1| n17["modules/auth"]
  n9["routes"] -->|1| n21["modules/fx"]
  n9["routes"] -->|1| n32["modules/revenue"]
  n9["routes"] -->|1| n11["modules/assignments"]
  n9["routes"] -->|1| n23["modules/snapshots"]
  n9["routes"] -->|1| n5["modules/alerts"]
  n9["routes"] -->|1| n25["modules/audit"]
  n9["routes"] -->|1| n7["modules/extra-hours"]
  n9["routes"] -->|1| n26["modules/estimations"]
  n9["routes"] -->|1| n30["modules/profile"]
  n9["routes"] -->|1| n15["modules/activities"]
  n9["routes"] -->|1| n18["modules/delegations"]
  n9["routes"] -->|1| n27["modules/feedback"]
  n9["routes"] -->|1| n29["modules/financial-entries"]
  n9["routes"] -->|1| n28["modules/financial-categories"]
  n9["routes"] -->|1| n33["modules/timer"]
  n34["server"] -->|1| n35["app.js"]
  n34["server"] -->|1| n22["config"]
  n34["server"] -->|1| n6["infra"]
  n34["server"] -->|1| n13["modules/jobs"]
  n34["server"] -->|1| n7["modules/extra-hours"]
  n1["utils"] -->|1| n22["config"]
```

---

## 4. Grafo de dependencias — Frontend

```mermaid
graph LR
  n0["hooks"] -->|18| n1["services"]
  n2["App"] -->|11| n0["hooks"]
  n3["features/capacity"] -->|9| n1["services"]
  n4["features/projects"] -->|9| n5["components"]
  n6["features/expenses"] -->|8| n5["components"]
  n4["features/projects"] -->|7| n7["utils"]
  n5["components"] -->|6| n7["utils"]
  n8["features/consultants"] -->|6| n5["components"]
  n6["features/expenses"] -->|6| n1["services"]
  n9["test"] -->|6| n1["services"]
  n3["features/capacity"] -->|5| n5["components"]
  n10["features/dashboard"] -->|5| n5["components"]
  n11["features/forecasts"] -->|5| n5["components"]
  n12["features/revenue"] -->|5| n5["components"]
  n2["App"] -->|4| n5["components"]
  n13["features/admin"] -->|4| n5["components"]
  n3["features/capacity"] -->|4| n7["utils"]
  n14["features/extraHours"] -->|4| n5["components"]
  n11["features/forecasts"] -->|4| n7["utils"]
  n15["features/timesheet"] -->|4| n7["utils"]
  n2["App"] -->|3| n13["features/admin"]
  n5["components"] -->|3| n1["services"]
  n16["features/activities"] -->|3| n5["components"]
  n13["features/admin"] -->|3| n1["services"]
  n8["features/consultants"] -->|3| n7["utils"]
  n6["features/expenses"] -->|3| n7["utils"]
  n17["features/portfolio"] -->|3| n5["components"]
  n12["features/revenue"] -->|3| n7["utils"]
  n15["features/timesheet"] -->|3| n1["services"]
  n15["features/timesheet"] -->|3| n5["components"]
  n18["features/workday"] -->|3| n1["services"]
  n9["test"] -->|3| n3["features/capacity"]
  n9["test"] -->|3| n7["utils"]
  n2["App"] -->|2| n19["config"]
  n2["App"] -->|2| n4["features/projects"]
  n2["App"] -->|2| n20["features/financial"]
  n16["features/activities"] -->|2| n1["services"]
  n13["features/admin"] -->|2| n0["hooks"]
  n3["features/capacity"] -->|2| n0["hooks"]
  n8["features/consultants"] -->|2| n1["services"]
  n10["features/dashboard"] -->|2| n7["utils"]
  n21["features/estimations"] -->|2| n5["components"]
  n20["features/financial"] -->|2| n5["components"]
  n20["features/financial"] -->|2| n1["services"]
  n22["features/fx"] -->|2| n5["components"]
  n23["features/holidays"] -->|2| n5["components"]
  n17["features/portfolio"] -->|2| n7["utils"]
  n4["features/projects"] -->|2| n1["services"]
  n24["features/reports"] -->|2| n1["services"]
  n24["features/reports"] -->|2| n15["features/timesheet"]
  n25["features/tracker"] -->|2| n5["components"]
  n18["features/workday"] -->|2| n5["components"]
  n9["test"] -->|2| n15["features/timesheet"]
  n2["App"] -->|1| n26["auth"]
  n2["App"] -->|1| n1["services"]
  n2["App"] -->|1| n7["utils"]
  n2["App"] -->|1| n10["features/dashboard"]
  n2["App"] -->|1| n8["features/consultants"]
  n2["App"] -->|1| n15["features/timesheet"]
  n2["App"] -->|1| n25["features/tracker"]
  n2["App"] -->|1| n24["features/reports"]
  n2["App"] -->|1| n11["features/forecasts"]
  n2["App"] -->|1| n22["features/fx"]
  n2["App"] -->|1| n27["features/audit"]
  n2["App"] -->|1| n3["features/capacity"]
  n2["App"] -->|1| n17["features/portfolio"]
  n2["App"] -->|1| n28["features/alerts"]
  n2["App"] -->|1| n29["features/profile"]
  n2["App"] -->|1| n14["features/extraHours"]
  n2["App"] -->|1| n21["features/estimations"]
  n2["App"] -->|1| n16["features/activities"]
  n2["App"] -->|1| n23["features/holidays"]
  n2["App"] -->|1| n18["features/workday"]
  n2["App"] -->|1| n30["types"]
  n26["auth"] -->|1| n19["config"]
  n5["components"] -->|1| n30["types"]
  n5["components"] -->|1| n0["hooks"]
  n19["config"] -->|1| n30["types"]
  n16["features/activities"] -->|1| n30["types"]
  n13["features/admin"] -->|1| n7["utils"]
  n28["features/alerts"] -->|1| n5["components"]
  n28["features/alerts"] -->|1| n1["services"]
  n27["features/audit"] -->|1| n5["components"]
  n27["features/audit"] -->|1| n1["services"]
  n10["features/dashboard"] -->|1| n1["services"]
  n10["features/dashboard"] -->|1| n30["types"]
  n21["features/estimations"] -->|1| n1["services"]
  n6["features/expenses"] -->|1| n0["hooks"]
  n14["features/extraHours"] -->|1| n1["services"]
  n14["features/extraHours"] -->|1| n7["utils"]
  n20["features/financial"] -->|1| n0["hooks"]
  n20["features/financial"] -->|1| n6["features/expenses"]
  n20["features/financial"] -->|1| n12["features/revenue"]
  n20["features/financial"] -->|1| n30["types"]
  n11["features/forecasts"] -->|1| n1["services"]
  n22["features/fx"] -->|1| n1["services"]
  n22["features/fx"] -->|1| n7["utils"]
  n23["features/holidays"] -->|1| n0["hooks"]
  n23["features/holidays"] -->|1| n1["services"]
  n23["features/holidays"] -->|1| n7["utils"]
  n17["features/portfolio"] -->|1| n1["services"]
  n17["features/portfolio"] -->|1| n0["hooks"]
  n29["features/profile"] -->|1| n5["components"]
  n29["features/profile"] -->|1| n1["services"]
  n4["features/projects"] -->|1| n0["hooks"]
  n24["features/reports"] -->|1| n5["components"]
  n24["features/reports"] -->|1| n7["utils"]
  n24["features/reports"] -->|1| n0["hooks"]
  n12["features/revenue"] -->|1| n1["services"]
  n12["features/revenue"] -->|1| n0["hooks"]
  n25["features/tracker"] -->|1| n7["utils"]
  n25["features/tracker"] -->|1| n1["services"]
  n25["features/tracker"] -->|1| n15["features/timesheet"]
  n18["features/workday"] -->|1| n0["hooks"]
  n18["features/workday"] -->|1| n7["utils"]
  n0["hooks"] -->|1| n24["features/reports"]
  n31["main"] -->|1| n2["App"]
  n31["main"] -->|1| n5["components"]
  n31["main"] -->|1| n26["auth"]
  n1["services"] -->|1| n19["config"]
  n9["test"] -->|1| n17["features/portfolio"]
  n9["test"] -->|1| n24["features/reports"]
  n7["utils"] -->|1| n1["services"]
```
