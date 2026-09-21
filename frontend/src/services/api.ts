import { env } from "../config/env";

type ApiEnvelope<T> = { data: T };

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

let accessToken: string | null = null;

export type AppRole = "ADMIN" | "PM" | "CONSULTANT" | "FINANCE" | "VIEWER";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  roles: AppRole[];
  permissions: string[];
  photoUrl?: string | null;
  bio?: string | null;
  phrase?: string | null;
  skills?: string[];
};

export type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  microsoftOid: string | null;
  active: boolean;
  roles: AppRole[];
  country?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HealthResponse = {
  ok: boolean;
  service: string;
  timestamp: string;
};

export type ProjectType = "FIXED_PRICE" | "TIME_AND_MATERIAL" | "STAFFING";
export type ProjectStatus = "ACTIVE" | "PAUSED" | "CLOSED";

export type Project = {
  id: string;
  name: string;
  company: string;
  country: string;
  currency: string;
  budget: string;
  startDate: string;
  endDate: string;
  description: string | null;
  projectType: ProjectType;
  status: ProjectStatus;
  sellPrice: string | null;
  sellCurrency: string;
  createdAt: string;
  updatedAt: string;
  allowExtraHours?: boolean;
  /** Correo del Project Manager. `null` si el proyecto no tiene PM asignado. */
  projectManagerEmail?: string | null;
  /**
   * Umbral de margen bruto en % por debajo del cual el proyecto deja de estar en
   * verde. `null` = sin umbral propio; el backend aplica su valor por defecto
   * (`DEFAULT_MARGIN_THRESHOLD_PCT`, 15 %).
   */
  marginThreshold?: string | null;
  /**
   * % de consumo de presupuesto a partir del cual se avisa. No admite nulo: el
   * backend lo declara con valor por defecto (90 %).
   */
  budgetAlertPct?: string | null;
};

export type Consultant = {
  id: string;
  fullName: string;
  email: string | null;
  role: string;
  company?: string | null;
  /**
   * Tarifa de venta. **Opcional a propósito**: el backend la omite (DEP-38) para
   * los roles que no deben verla (CONSULTANT y VIEWER), así que llega
   * `undefined`, no `null` ni `0`. `null` significa "no tiene tarifa cargada";
   * `undefined`, "no te corresponde verla". Quien la pinte debe distinguirlo.
   */
  hourlyRate?: string | null;
  rateCurrency: string;
  country: string | null;
  /** Costo interno. Mismo criterio que `hourlyRate`. */
  costPerMonth?: string | null;
  active: boolean;
  allowWeekendWork?: boolean;
  isInternal?: boolean;
  createdAt: string;
  updatedAt: string;
  identification?: string | null;
  skills?: string[];
  seniority?: string | null;
};

export type TimeEntryStatus = "PENDING" | "APPROVED" | "REJECTED";

/**
 * Consultor tal como llega dentro de un registro de horas.
 *
 * Desde R7 el propio `Consultant` ya declara `hourlyRate`, `costPerMonth` e
 * `identification` como opcionales, porque el recorte por rol no vive solo en
 * `time-entries`: también en `extra-hours`, `activities` y `consultants`. El
 * alias se conserva porque nombra bien la intención allí donde se usa.
 */
export type TimeEntryConsultant = Consultant;

/** De donde salio el registro: formulario clasico, grilla semanal o cronometro. */
export type TimeEntrySource = "MANUAL" | "TIMESHEET" | "TIMER";

export type TimeEntryActivityRef = { id: string; title: string };

export type TimeEntry = {
  id: string;
  projectId: string;
  consultantId: string;
  workDate: string;
  hours: string;
  note: string | null;
  description: string | null;
  activityId: string | null;
  source: TimeEntrySource;
  startedAt: string | null;
  endedAt: string | null;
  status: TimeEntryStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionNote: string | null;
  createdAt: string;
  updatedAt: string;
  project: Project;
  consultant: TimeEntryConsultant;
  activity?: TimeEntryActivityRef | null;
};

/** Cronometro en marcha del usuario autenticado. */
export type RunningTimer = {
  id: string;
  consultantId: string;
  projectId: string;
  activityId: string | null;
  description: string | null;
  startedAt: string;
  createdAt: string;
  updatedAt: string;
  project: Project;
  activity?: TimeEntryActivityRef | null;
  consultant?: { id: string; fullName: string };
};

export type Expense = {
  id: string;
  projectId: string;
  expenseDate: string;
  category: string;
  amount: string;
  currency: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  project: Project;
};

export type Forecast = {
  id: string;
  projectId: string;
  consultantId: string;
  startDate: string;   // ISO "YYYY-MM-DD"
  endDate: string;     // ISO "YYYY-MM-DD"
  hoursProjected: string;
  hourlyRate: string | null;
  sellRate: string | null;
  currency: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  project: Project;
  consultant: Consultant;
  projectedCost?: number;
};

export type RevenueEntry = {
  id: string;
  projectId: string;
  entryDate: string;
  amount: string;
  currency: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  project?: Pick<Project, "id" | "name" | "currency">;
};

export type FxConfig = {
  id: string;
  baseCode: string;
  quoteCode: string;
  rate: string;
  createdAt: string;
  updatedAt: string;
};

export type AlertLevel = "ok" | "warning" | "exceeded";

export type StatsProjectRow = {
  projectId: string;
  projectName: string;
  company: string;
  currency: string;
  projectType: ProjectType;
  status: ProjectStatus;
  displayCurrency: string;
  // Budget
  budget: number;
  spent: number;
  laborCostActual?: number;
  expensesActual?: number;
  remainingBudget: number;
  usedBudgetPercent: number;
  projectedCost: number;
  projectedTotal: number;
  projectedPct: number;
  estimateAtCompletion: number;
  budgetVariance: number;
  // Revenue & margin
  contractValue: number;
  revenueRecognized: number;
  grossMarginActual: number;
  grossMarginActualPct: number | null;
  grossMarginProjected: number;
  grossMarginProjectedPct: number | null;
  /**
   * Umbral de margen ya resuelto por el backend (R10): el del proyecto, o el
   * valor por defecto de 15 % si el proyecto no tiene uno propio. Siempre es un
   * número: el frontend no debe volver a aplicar un default.
   */
  marginThreshold: number;
  // Hours
  totalHours: number;
  approvedHours: number;
  // Alert
  alertLevel: AlertLevel;
};

export type StatsOverview = {
  baseCurrency: string;
  projects: StatsProjectRowEnriched[];
  totals: {
    budget: number;
    spent: number;
    laborCostActual?: number;
    expensesActual?: number;
    projectedCost: number;
    contractValue: number;
    revenueRecognized: number;
    grossMarginActual: number;
    totalHours: number;
    approvedHours: number;
    alertCount: number;
    byHealth?: { GREEN: number; YELLOW: number; RED: number };
    avgCpi?: number | null;
    avgSpi?: number | null;
  };
  byProjectType?: Record<string, {
    count: number;
    budget: number;
    spent: number;
    revenueRecognized: number;
    grossMarginActual: number;
    grossMarginActualPct: number | null;
    approvedHours: number;
  }>;
};

function ensureApiUrl() {
  if (!env.apiUrl) {
    throw new Error("Missing VITE_API_URL in frontend build configuration");
  }

  return env.apiUrl;
}

export function setApiAccessToken(token: string | null) {
  accessToken = token;
}

async function request<T>(path: string, method: HttpMethod = "GET", body?: unknown): Promise<T> {
  const baseUrl = ensureApiUrl();

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // `fetch` solo rechaza por fallo de red (servidor caído, CORS, DNS). El
    // navegador da un "Failed to fetch" en inglés que no dice nada al usuario.
    throw new Error("No se pudo contactar con el servidor. Verifica que el backend esté disponible.");
  }

  if (!response.ok) {
    const fallbackMessage = `Request failed with status ${response.status}`;
    let errorMessage = fallbackMessage;

    try {
      const errorBody = (await response.json()) as {
        message?: string;
        issues?: { path: string; message: string }[];
      };

      if (errorBody.message === "Validation error" && Array.isArray(errorBody.issues)) {
        const FIELD_MAP: Record<string, string> = {
          fullName: "Nombre completo",
          email: "Correo electrónico",
          role: "Rol",
          hourlyRate: "Tarifa por hora",
          rateCurrency: "Moneda de la tarifa",
          active: "Activo",
          name: "Nombre",
          company: "Empresa",
          country: "País",
          currency: "Moneda",
          budget: "Presupuesto",
          startDate: "Fecha de inicio",
          endDate: "Fecha de fin",
          description: "Descripción",
          projectType: "Tipo de proyecto",
          sellPrice: "Precio de venta",
          sellCurrency: "Moneda de venta",
          category: "Categoría",
          amount: "Monto",
          expenseDate: "Fecha del gasto",
          entryDate: "Fecha del ingreso",
          projectId: "Proyecto",
          consultantId: "Consultor",
          hoursProjected: "Horas proyectadas",
          sellRate: "Tarifa de venta",
          hours: "Horas",
          workDate: "Fecha",
          baseCode: "Moneda origen",
          quoteCode: "Moneda destino",
          rate: "Tasa",
          note: "Nota",
          displayName: "Nombre para mostrar",
          roles: "Roles",
          allocationMode: "Modo de asignación",
          allocationPct: "Porcentaje de asignación",
          hoursPerPeriod: "Horas por periodo",
          periodUnit: "Unidad del periodo",
          title: "Título",
          severity: "Gravedad",
          owner: "Responsable",
          plannedDate: "Fecha planificada",
          actualDate: "Fecha real",
          weight: "Peso",
          deliverable: "Entregable",
          acceptedBy: "Aceptado por",
          probability: "Probabilidad",
          impact: "Impacto",
          mitigationPlan: "Plan de mitigación",
          contingencyPlan: "Plan de contingencia",
          resolution: "Resolución",
          type: "Tipo",
        };

        const translateMessage = (msg: string): string => {
          const m = msg.toLowerCase();
          if (m.includes("required") || m.includes("is required")) return "es obligatorio.";
          if (m.includes("invalid email")) return "debe tener un formato de correo válido.";
          if (m.includes("greater than or equal to 0") || m.includes("nonnegative")) return "debe ser mayor o igual a 0.";
          if (m.includes("must be positive")) return "debe ser un valor positivo.";
          if (m.includes("invalid datetime") || m.includes("invalid date")) return "debe ser una fecha válida.";
          if (m.includes("must contain at least 1 character")) return "no puede estar vacío.";
          if (m.includes("expected number") || m.includes("nan")) return "debe ser un número válido.";
          if (m.includes("expected string")) return "debe ser un texto válido.";
          return `presenta el siguiente problema: ${msg}`;
        };

        const bullets = errorBody.issues
          .map((issue) => {
            const fieldKey = issue.path.split(".").pop() || issue.path;
            const fieldName = FIELD_MAP[fieldKey] || fieldKey;
            const cleanMsg = translateMessage(issue.message);
            return `• ! El campo "${fieldName}" ${cleanMsg}`;
          })
          .join("\n");

        errorMessage = `Error de validación:\n${bullets}`;
      } else {
        errorMessage = errorBody.message || fallbackMessage;
      }
    } catch {
      errorMessage = fallbackMessage;
    }

    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export async function getMe(): Promise<AuthUser> {
  const response = await request<ApiEnvelope<AuthUser>>("/api/auth/me");
  return response.data;
}

/**
 * Matriz de permisos por rol. Es la de `backend/src/auth/roles.ts`: el frontend
 * no mantiene copia propia (DEP-15).
 */
export type RolePermissionsMap = Record<AppRole, string[]>;

export async function getRolePermissions(): Promise<RolePermissionsMap> {
  const response = await request<ApiEnvelope<RolePermissionsMap>>("/api/auth/permissions");
  return response.data;
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const response = await request<ApiEnvelope<AdminUser[]>>("/api/admin/users");
  return response.data;
}

export async function createAdminUser(payload: {
  email: string;
  displayName: string;
  microsoftOid?: string;
  active: boolean;
  roles: AppRole[];
  country?: string | null;
}): Promise<AdminUser> {
  const response = await request<ApiEnvelope<AdminUser>>("/api/admin/users", "POST", payload);
  return response.data;
}

export async function updateAdminUser(
  id: string,
  payload: {
    displayName?: string;
    microsoftOid?: string;
    active?: boolean;
    roles?: AppRole[];
    country?: string | null;
  },
): Promise<AdminUser> {
  const response = await request<ApiEnvelope<AdminUser>>(`/api/admin/users/${id}`, "PATCH", payload);
  return response.data;
}

export async function listProjects(params?: { search?: string }): Promise<Project[]> {
  const query = new URLSearchParams();
  if (params?.search) {
    query.set("search", params.search);
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await request<ApiEnvelope<Project[]>>(`/api/projects${suffix}`);
  return response.data;
}

export async function createProject(payload: {
  name: string;
  company: string;
  country: string;
  currency: string;
  budget: number;
  startDate: string;
  endDate: string;
  description?: string;
  projectType?: ProjectType;
  status?: ProjectStatus;
  sellPrice?: number;
  sellCurrency?: string;
  allowExtraHours?: boolean;
  /** Cadena vacía = sin PM. El backend la normaliza a minúsculas y a `null`. */
  projectManagerEmail?: string | null;
  /**
   * Umbral de margen en % (0–100). Cadena vacía = sin umbral propio: el backend
   * lo guarda como `null` y aplica su valor por defecto de 15 %.
   */
  marginThreshold?: string | number | null;
  /**
   * Umbral de aviso de presupuesto en % (0–100). Cadena vacía = **no tocar**: el
   * campo no admite nulo y conserva el valor que ya tuviera (90 % por defecto).
   */
  budgetAlertPct?: string | number | null;
}): Promise<Project> {
  const response = await request<ApiEnvelope<Project>>("/api/projects", "POST", payload);
  return response.data;
}

export async function updateProject(
  id: string,
  payload: {
    name: string;
    company: string;
    country: string;
    currency: string;
    budget: number;
    startDate: string;
    endDate: string;
    description?: string;
    projectType?: ProjectType;
    status?: ProjectStatus;
    sellPrice?: number;
    sellCurrency?: string;
    allowExtraHours?: boolean;
    /** Cadena vacía = desasignar el PM. */
    projectManagerEmail?: string | null;
    /** Cadena vacía = desasignar el umbral propio de margen (vuelve a `null`). */
    marginThreshold?: string | number | null;
    /** Cadena vacía = **no tocar**; el campo no admite nulo. */
    budgetAlertPct?: string | number | null;
  },
): Promise<Project> {
  const response = await request<ApiEnvelope<Project>>(`/api/projects/${id}`, "PUT", payload);
  return response.data;
}

export async function deleteProject(id: string): Promise<void> {
  await request<void>(`/api/projects/${id}`, "DELETE");
}

export async function listConsultants(): Promise<Consultant[]> {
  const response = await request<ApiEnvelope<Consultant[]>>("/api/consultants");
  return response.data;
}

export async function createConsultant(payload: {
  fullName: string;
  email?: string;
  role: string;
  company?: string;
  hourlyRate?: number;
  rateCurrency?: string;
  country?: string;
  seniority?: string;
  identification?: string | null;
  costPerMonth?: number;
  active: boolean;
  allowWeekendWork?: boolean;
  isInternal?: boolean;
}): Promise<Consultant> {
  const response = await request<ApiEnvelope<Consultant>>("/api/consultants", "POST", payload);
  return response.data;
}

export async function updateConsultant(
  id: string,
  payload: {
    fullName: string;
    email?: string;
    role: string;
    company?: string;
    hourlyRate?: number;
    rateCurrency?: string;
    country?: string;
    seniority?: string;
    identification?: string | null;
    costPerMonth?: number;
    active: boolean;
    allowWeekendWork?: boolean;
    isInternal?: boolean;
  },
): Promise<Consultant> {
  const response = await request<ApiEnvelope<Consultant>>(`/api/consultants/${id}`, "PUT", payload);
  return response.data;
}

export async function deleteConsultant(id: string): Promise<void> {
  await request<void>(`/api/consultants/${id}`, "DELETE");
}

export async function listTimeEntries(params?: {
  consultantId?: string;
  projectId?: string;
  /** Fecha inicial inclusiva, YYYY-MM-DD. */
  from?: string;
  /** Fecha final inclusiva, YYYY-MM-DD. */
  to?: string;
  /** Solo las horas del usuario autenticado. */
  mine?: boolean;
  status?: TimeEntryStatus;
}): Promise<TimeEntry[]> {
  const query = new URLSearchParams();
  if (params?.consultantId) query.set("consultantId", params.consultantId);
  if (params?.projectId) query.set("projectId", params.projectId);
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  if (params?.mine) query.set("mine", "1");
  if (params?.status) query.set("status", params.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await request<ApiEnvelope<TimeEntry[]>>(`/api/time-entries${suffix}`);
  return response.data;
}

/**
 * Ficha de consultor del usuario autenticado, o null si su correo no
 * corresponde a ninguna. El timesheet y el tracker la necesitan para saber a
 * nombre de quien registran las horas.
 */
export async function getMyConsultant(): Promise<Consultant | null> {
  const response = await request<ApiEnvelope<Consultant | null>>("/api/time-entries/me");
  return response.data;
}

export async function createTimeEntry(payload: {
  projectId: string;
  /** Solo ADMIN y PM pueden imputar horas a otra persona; el resto se ignora. */
  consultantId?: string;
  workDate: string;
  hours: number;
  note?: string;
  description?: string | null;
  activityId?: string | null;
  source?: TimeEntrySource;
}): Promise<TimeEntry> {
  const response = await request<ApiEnvelope<TimeEntry>>("/api/time-entries", "POST", payload);
  return response.data;
}

export async function updateTimeEntry(
  id: string,
  payload: {
    hours?: number;
    description?: string | null;
    activityId?: string | null;
    note?: string | null;
    projectId?: string;
    workDate?: string;
  },
): Promise<TimeEntry> {
  const response = await request<ApiEnvelope<TimeEntry>>(`/api/time-entries/${id}`, "PATCH", payload);
  return response.data;
}

export async function deleteTimeEntry(id: string): Promise<void> {
  await request<void>(`/api/time-entries/${id}`, "DELETE");
}

// -- Cronometro (Tracker) --------------------------------------------------

export async function getRunningTimer(): Promise<RunningTimer | null> {
  const response = await request<ApiEnvelope<RunningTimer | null>>("/api/timer");
  return response.data;
}

export async function startTimer(payload: {
  projectId: string;
  activityId?: string | null;
  description?: string | null;
  /** ISO. Permite reanudar una entrada arrancando el cronometro en el pasado. */
  startedAt?: string;
}): Promise<RunningTimer> {
  const response = await request<ApiEnvelope<RunningTimer>>("/api/timer/start", "POST", payload);
  return response.data;
}

export async function updateRunningTimer(payload: {
  projectId?: string;
  activityId?: string | null;
  description?: string | null;
  startedAt?: string;
}): Promise<RunningTimer> {
  const response = await request<ApiEnvelope<RunningTimer>>("/api/timer", "PATCH", payload);
  return response.data;
}

/** Detiene el cronometro y devuelve la entrada de horas que genero. */
export async function stopTimer(): Promise<TimeEntry> {
  const response = await request<ApiEnvelope<TimeEntry>>("/api/timer/stop", "POST");
  return response.data;
}

/** Descarta el cronometro sin registrar horas. */
export async function discardTimer(): Promise<void> {
  await request<void>("/api/timer", "DELETE");
}

// La identidad de quien aprueba o rechaza la toma el backend del token; el
// cliente ya no la envía (ni podría falsificarla).
export async function approveTimeEntry(id: string): Promise<TimeEntry> {
  const response = await request<ApiEnvelope<TimeEntry>>(`/api/time-entries/${id}/approve`, "PATCH");
  return response.data;
}

export async function rejectTimeEntry(id: string, rejectionNote: string): Promise<TimeEntry> {
  const response = await request<ApiEnvelope<TimeEntry>>(`/api/time-entries/${id}/reject`, "PATCH", {
    rejectionNote,
  });
  return response.data;
}

export async function listExpenses(): Promise<Expense[]> {
  const response = await request<ApiEnvelope<Expense[]>>("/api/expenses");
  return response.data;
}

export async function createExpense(payload: {
  projectId: string;
  expenseDate: string;
  category: string;
  amount: number;
  currency: string;
  description?: string;
}): Promise<Expense> {
  const response = await request<ApiEnvelope<Expense>>("/api/expenses", "POST", payload);
  return response.data;
}

export async function updateExpense(
  id: string,
  payload: {
    projectId: string;
    expenseDate: string;
    category: string;
    amount: number;
    currency: string;
    description?: string;
  },
): Promise<Expense> {
  const response = await request<ApiEnvelope<Expense>>(`/api/expenses/${id}`, "PUT", payload);
  return response.data;
}

export async function deleteExpense(id: string): Promise<void> {
  await request<void>(`/api/expenses/${id}`, "DELETE");
}

export async function listForecasts(): Promise<Forecast[]> {
  const response = await request<ApiEnvelope<Forecast[]>>("/api/forecasts");
  return response.data;
}

export async function createForecast(payload: {
  projectId: string;
  consultantId: string;
  startDate: string;
  endDate: string;
  hoursProjected: number;
  hourlyRate?: number;
  sellRate?: number;
  currency?: string;
  note?: string;
}): Promise<Forecast> {
  const response = await request<ApiEnvelope<Forecast>>("/api/forecasts", "POST", payload);
  return response.data;
}

export async function updateForecast(
  id: string,
  payload: {
    projectId: string;
    consultantId: string;
    startDate: string;
    endDate: string;
    hoursProjected: number;
    hourlyRate?: number;
    sellRate?: number;
    currency?: string;
    note?: string;
  },
): Promise<Forecast> {
  const response = await request<ApiEnvelope<Forecast>>(`/api/forecasts/${id}`, "PUT", payload);
  return response.data;
}

export async function deleteForecast(id: string): Promise<void> {
  await request<void>(`/api/forecasts/${id}`, "DELETE");
}

export async function getStatsOverview(baseCurrency?: string): Promise<StatsOverview> {
  const query = baseCurrency ? `?baseCurrency=${baseCurrency}` : "";
  const response = await request<ApiEnvelope<StatsOverview>>(`/api/stats/overview${query}`);
  return response.data;
}

export async function listFxConfigs(): Promise<FxConfig[]> {
  const response = await request<ApiEnvelope<FxConfig[]>>("/api/fx");
  return response.data;
}

export async function upsertFxRate(payload: {
  baseCode: string;
  quoteCode: string;
  rate: number;
}): Promise<FxConfig> {
  const response = await request<ApiEnvelope<FxConfig>>("/api/fx", "PUT", payload);
  return response.data;
}

export async function deleteFxRate(id: string): Promise<void> {
  await request<void>(`/api/fx/${id}`, "DELETE");
}

export type FxSyncResult = { updated: string[]; failed: string[] };

export async function syncFxRates(): Promise<FxSyncResult> {
  const response = await request<ApiEnvelope<FxSyncResult>>("/api/fx/sync", "POST");
  return response.data;
}

export async function listRevenueEntries(projectId?: string): Promise<RevenueEntry[]> {
  const query = projectId ? `?projectId=${projectId}` : "";
  const response = await request<ApiEnvelope<RevenueEntry[]>>(`/api/revenue${query}`);
  return response.data;
}

export async function createRevenueEntry(payload: {
  projectId: string;
  entryDate: string;
  amount: number;
  currency: string;
  description?: string;
}): Promise<RevenueEntry> {
  const response = await request<ApiEnvelope<RevenueEntry>>("/api/revenue", "POST", payload);
  return response.data;
}

export async function updateRevenueEntry(
  id: string,
  payload: {
    projectId: string;
    entryDate: string;
    amount: number;
    currency: string;
    description?: string;
  },
): Promise<RevenueEntry> {
  const response = await request<ApiEnvelope<RevenueEntry>>(`/api/revenue/${id}`, "PUT", payload);
  return response.data;
}

export async function deleteRevenueEntry(id: string): Promise<void> {
  await request<void>(`/api/revenue/${id}`, "DELETE");
}

// ─── Capacity ──────────────────────────────────────────────────────────────────

export type AvailabilityStatus = "FREE" | "PARTIAL" | "FULL" | "OVERLOADED";

export type ActiveAssignment = {
  assignmentId: string;
  projectId: string;
  projectName: string;
  startDate: string;
  endDate: string;
  allocationMode: "PERCENTAGE" | "HOURS";
  allocationPct: number | null;
  hoursPerPeriod: number | null;
  status: string;
};

export type CapacityConsultantRow = {
  consultantId: string;
  fullName: string;
  role: string;
  seniority: string | null;
  country: string | null;
  skills: string[];
  capacityHours: number;
  committedHours: number;
  availableHours: number;
  utilizationPct: number;
  availabilityStatus: AvailabilityStatus;
  nextAvailableDate: string | null;
  activeAssignments: ActiveAssignment[];
};

export type CapacityOverview = {
  period: { from: string; to: string };
  consultants: CapacityConsultantRow[];
  summary: {
    totalConsultants: number;
    freeCount: number;
    partialCount: number;
    fullCount: number;
    overloadedCount: number;
    totalCapacityHours: number;
    totalCommittedHours: number;
    utilizationPct: number;
  };
};

export type ReleasingEntry = {
  assignmentId: string;
  consultantId: string;
  consultant: {
    id: string;
    fullName: string;
    role: string;
    country: string | null;
    seniority: string | null;
    skills: string[];
  };
  projectId: string;
  project: { id: string; name: string };
  endDate: string;
  daysUntilRelease: number;
  allocationPct: number | null;
};

export async function getCapacityOverview(params?: {
  from?: string;
  to?: string;
  country?: string;
  skill?: string;
  seniority?: string;
  status?: AvailabilityStatus;
  minAvailableHours?: number;
}): Promise<CapacityOverview> {
  const query = new URLSearchParams();
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  if (params?.country) query.set("country", params.country);
  if (params?.skill) query.set("skill", params.skill);
  if (params?.seniority) query.set("seniority", params.seniority);
  if (params?.status) query.set("status", params.status);
  if (params?.minAvailableHours != null) query.set("minAvailableHours", String(params.minAvailableHours));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await request<ApiEnvelope<CapacityOverview>>(`/api/capacity/overview${suffix}`);
  return response.data;
}

export async function getCapacityReleasing(within = 30): Promise<ReleasingEntry[]> {
  const response = await request<ApiEnvelope<ReleasingEntry[]>>(`/api/capacity/releasing?within=${within}`);
  return response.data;
}

// ─── Assignments ───────────────────────────────────────────────────────────────

export type AllocationMode = "PERCENTAGE" | "HOURS";
export type AssignmentStatus = "PLANNED" | "ACTIVE" | "PARTIAL" | "COMPLETED" | "CANCELLED";
export type BlockType = "VACATION" | "SICK_LEAVE" | "NATIONAL_HOLIDAY" | "INTERNAL_BENCH" | "TRAINING" | "OTHER";

export type Assignment = {
  id: string;
  projectId: string;
  consultantId: string;
  startDate: string;
  endDate: string;
  allocationMode: AllocationMode;
  allocationPct: number | null;
  hoursPerPeriod: number | null;
  periodUnit: string | null;
  status: AssignmentStatus;
  role: string | null;
  note: string | null;
  project?: { id: string; name: string; company: string; currency: string };
  consultant?: { id: string; fullName: string; role: string; country: string | null };
  createdAt: string;
  updatedAt: string;
};

export type ConsultantBlock = {
  id: string;
  consultantId: string;
  startDate: string;
  endDate: string;
  blockType: BlockType;
  note: string | null;
  createdAt: string;
};

export type ProjectCapacityConsultant = {
  consultantId: string;
  fullName: string;
  role: string;
  seniority: string | null;
  country: string | null;
  assignment: {
    id: string;
    startDate: string;
    endDate: string;
    allocationMode: AllocationMode;
    allocationPct: number | null;
    hoursPerPeriod: number | null;
    periodUnit: string | null;
    status: AssignmentStatus;
    role: string | null;
  };
  capacityHours: number;
  committedHours: number;
  utilizationPct: number;
  /** `null` cuando el rol no puede ver tarifas (DEP-38). */
  estimatedCost: number | null;
  costCurrency: string;
};

export type ProjectCapacity = {
  project: { id: string; name: string; startDate: string; endDate: string; status: string };
  period: { from: string; to: string };
  consultants: ProjectCapacityConsultant[];
  summary: { totalConsultants: number; totalCommittedHours: number; totalEstimatedCost: number | null };
};

export type ProjectCapacitySummary = {
  projectId: string;
  projectName: string;
  projectStatus: string;
  assignedConsultants: number;
  totalCommittedHours: number;
  /** `null` cuando el rol no puede ver tarifas (DEP-38). */
  totalEstimatedCost: number | null;
  consultants: { consultantId: string; fullName: string; committedHours: number; estimatedCost: number | null; currency: string }[];
};

type AssignmentPayload = {
  projectId: string;
  consultantId: string;
  startDate: string;
  endDate: string;
  allocationMode: AllocationMode;
  allocationPct?: number;
  hoursPerPeriod?: number;
  periodUnit?: "week" | "month";
  role?: string;
  note?: string;
};

export async function listAssignments(params?: {
  consultantId?: string;
  projectId?: string;
  status?: AssignmentStatus;
  from?: string;
  to?: string;
}): Promise<Assignment[]> {
  const query = new URLSearchParams();
  if (params?.consultantId) query.set("consultantId", params.consultantId);
  if (params?.projectId) query.set("projectId", params.projectId);
  if (params?.status) query.set("status", params.status);
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await request<ApiEnvelope<Assignment[]>>(`/api/assignments${suffix}`);
  return response.data;
}

export async function createAssignment(payload: AssignmentPayload): Promise<Assignment> {
  const response = await request<ApiEnvelope<Assignment>>("/api/assignments", "POST", payload);
  return response.data;
}

export async function updateAssignment(id: string, payload: AssignmentPayload): Promise<Assignment> {
  const response = await request<ApiEnvelope<Assignment>>(`/api/assignments/${id}`, "PUT", payload);
  return response.data;
}

export async function cancelAssignment(id: string): Promise<Assignment> {
  const response = await request<ApiEnvelope<Assignment>>(`/api/assignments/${id}/cancel`, "PATCH");
  return response.data;
}

export async function completeAssignment(id: string): Promise<Assignment> {
  const response = await request<ApiEnvelope<Assignment>>(`/api/assignments/${id}/complete`, "PATCH");
  return response.data;
}

export async function deleteAssignment(id: string): Promise<void> {
  await request<void>(`/api/assignments/${id}`, "DELETE");
}

export async function listConsultantBlocks(consultantId: string): Promise<ConsultantBlock[]> {
  const response = await request<ApiEnvelope<ConsultantBlock[]>>(`/api/consultants/${consultantId}/blocks`);
  return response.data;
}

export async function createConsultantBlock(
  consultantId: string,
  payload: { startDate: string; endDate: string; blockType: BlockType; note?: string },
): Promise<ConsultantBlock> {
  const response = await request<ApiEnvelope<ConsultantBlock>>(`/api/consultants/${consultantId}/blocks`, "POST", payload);
  return response.data;
}

export async function deleteConsultantBlock(consultantId: string, blockId: string): Promise<void> {
  await request<void>(`/api/consultants/${consultantId}/blocks/${blockId}`, "DELETE");
}

export async function getProjectCapacity(projectId: string, params?: { from?: string; to?: string }): Promise<ProjectCapacity> {
  const query = new URLSearchParams();
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await request<ApiEnvelope<ProjectCapacity>>(`/api/capacity/project/${projectId}${suffix}`);
  return response.data;
}

export async function getCapacityByProject(params?: { from?: string; to?: string }): Promise<ProjectCapacitySummary[]> {
  const query = new URLSearchParams();
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await request<ApiEnvelope<ProjectCapacitySummary[]>>(`/api/capacity/by-project${suffix}`);
  return response.data;
}

// ─── Alerts ────────────────────────────────────────────────────────────────────

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";

export type AppAlert = {
  id: string;
  projectId: string | null;
  consultantId: string | null;
  type: string;
  severity: AlertSeverity;
  message: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  project?: { id: string; name: string; company: string } | null;
  consultant?: { id: string; fullName: string } | null;
};

export async function listAlerts(params?: {
  projectId?: string;
  consultantId?: string;
  resolved?: boolean;
}): Promise<AppAlert[]> {
  const query = new URLSearchParams();
  if (params?.projectId) query.set("projectId", params.projectId);
  if (params?.consultantId) query.set("consultantId", params.consultantId);
  if (params?.resolved !== undefined) query.set("resolved", String(params.resolved));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await request<ApiEnvelope<AppAlert[]>>(`/api/alerts${suffix}`);
  return response.data;
}

export async function resolveAlert(id: string): Promise<AppAlert> {
  const response = await request<ApiEnvelope<AppAlert>>(`/api/alerts/${id}/resolve`, "PATCH");
  return response.data;
}

export async function getAlertsUnreadCount(): Promise<number> {
  const response = await request<ApiEnvelope<{ count: number }>>("/api/alerts/unread-count");
  return response.data.count;
}

export async function runAlertEngine(): Promise<void> {
  await request<{ message: string }>("/api/alerts/run", "POST");
}

// ─── Audit ─────────────────────────────────────────────────────────────────────

export type AuditLog = {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  changedBy: string;
  before: unknown;
  after: unknown;
  diff?: unknown;
  createdAt: string;
};

export type AuditLogPage = {
  data: AuditLog[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
};

export async function listAuditLogs(params?: {
  entity?: string;
  entityId?: string;
  changedBy?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}): Promise<AuditLogPage> {
  const query = new URLSearchParams();
  if (params?.entity) query.set("entity", params.entity);
  if (params?.entityId) query.set("entityId", params.entityId);
  if (params?.changedBy) query.set("changedBy", params.changedBy);
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  if (params?.page) query.set("page", String(params.page));
  if (params?.pageSize) query.set("pageSize", String(params.pageSize));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<AuditLogPage>(`/api/audit${suffix}`);
}

// ─── FX History ───────────────────────────────────────────────────────────────

export type FxRateHistory = {
  id: string;
  baseCode: string;
  quoteCode: string;
  rate: string;
  effectiveDate: string;
  source: string | null;
  createdAt: string;
};

export async function listFxHistory(params?: {
  baseCode?: string;
  quoteCode?: string;
  from?: string;
  to?: string;
}): Promise<FxRateHistory[]> {
  const query = new URLSearchParams();
  if (params?.baseCode) query.set("baseCode", params.baseCode);
  if (params?.quoteCode) query.set("quoteCode", params.quoteCode);
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await request<ApiEnvelope<FxRateHistory[]>>(`/api/fx/history${suffix}`);
  return response.data;
}

// ─── PMO / PMP entities ────────────────────────────────────────────────────────

export type HealthStatus = "GREEN" | "YELLOW" | "RED";
export type ProjectPhase = "INITIATION" | "PLANNING" | "EXECUTION" | "MONITORING" | "CLOSING";
export type MilestoneStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "DELAYED" | "CANCELLED";
export type RiskStatus = "OPEN" | "MITIGATED" | "ACCEPTED" | "CLOSED";
export type IssueSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type IssueStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type ChangeRequestType = "SCOPE" | "BUDGET" | "SCHEDULE" | "OTHER";
export type ChangeRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export type EVMResult = {
  ev: number | null;
  pv: number | null;
  ac: number;
  cpi: number | null;
  spi: number | null;
  eac: number | null;
  vac: number | null;
  tcpi: number | null;
};

export type Milestone = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  plannedDate: string;
  actualDate: string | null;
  status: MilestoneStatus;
  weight: string;
  deliverable: string | null;
  note: string | null;
  acceptedBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type Risk = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  probability: number;
  impact: number;
  riskScore: number;
  category: string | null;
  owner: string | null;
  mitigationPlan: string | null;
  contingencyPlan: string | null;
  status: RiskStatus;
  identifiedAt: string;
  resolvedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type Issue = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  severity: IssueSeverity;
  status: IssueStatus;
  owner: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ChangeRequest = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  type: ChangeRequestType;
  status: ChangeRequestStatus;
  impactScope: string | null;
  impactBudget: string | null;
  impactDays: number | null;
  requestedBy: string;
  reviewedBy: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDetailProject = {
  id: string;
  name: string;
  company: string;
  country: string;
  currency: string;
  status: ProjectStatus;
  projectType: ProjectType;
  phase: ProjectPhase | null;
  healthStatus: HealthStatus | null;
  completionPct: number | null;
  projectManagerEmail: string | null;
  startDate: string;
  endDate: string;
  baselineBudget: number | null;
  baselineStartDate: string | null;
  baselineEndDate: string | null;
  baselineSetAt: string | null;
  baselineSetBy: string | null;
};

export type ProjectDetailFinancials = {
  displayCurrency: string;
  budget: number;
  spent: number;
  laborCostActual: number;
  expensesActual: number;
  remainingBudget: number;
  usedBudgetPercent: number;
  alertLevel: "ok" | "warning" | "exceeded";
  contractValue: number;
  revenueRecognized: number;
  grossMarginActual: number;
  grossMarginActualPct: number | null;
  /** Umbral de margen ya resuelto por el backend (ver `StatsProjectRow`). */
  marginThreshold: number;
  projectedPct: number;
  projectedTotal: number;
  approvedHours: number;
};

export type ProjectDetailSummary = {
  totalMilestones: number;
  completedMilestones: number;
  delayedMilestones: number;
  openRisks: number;
  openHighRisks: number;
  openIssues: number;
  pendingChanges: number;
};

export type ProjectDetail = {
  project: ProjectDetailProject;
  financials: ProjectDetailFinancials;
  evm: EVMResult | null;
  milestones: Milestone[];
  risks: Risk[];
  issues: Issue[];
  changeRequests: ChangeRequest[];
  assignments: Assignment[];
  summary: ProjectDetailSummary;
};

export type PortfolioProject = {
  projectId: string;
  projectName: string;
  company: string;
  projectType: ProjectType;
  status: ProjectStatus;
  phase: ProjectPhase | null;
  projectManagerEmail: string | null;
  startDate: string | null;
  endDate: string | null;
  completionPct: number;
  healthStatus: HealthStatus;
  displayCurrency: string;
  budget: number;
  spent: number;
  usedBudgetPercent: number;
  revenueRecognized: number;
  grossMarginActual: number;
  grossMarginActualPct: number | null;
  /** Umbral de margen ya resuelto por el backend (ver `StatsProjectRow`). */
  marginThreshold: number;
  alertLevel: "ok" | "warning" | "exceeded";
  evm: EVMResult | null;
  totalMilestones: number;
  completedMilestones: number;
  delayedMilestones: number;
  totalRisks: number;
  openHighRisks: number;
  openIssues: number;
  criticalIssues: number;
};

export type PortfolioSummary = {
  totalProjects: number;
  byHealth: { GREEN: number; YELLOW: number; RED: number };
  byStatus: { ACTIVE: number; PAUSED: number; CLOSED: number };
  totalBudget: number;
  totalSpent: number;
  totalRevenue: number;
  totalGrossMargin: number;
  criticalCount: number;
  alertCount: number;
};

export type Portfolio = {
  baseCurrency: string;
  projects: PortfolioProject[];
  summary: PortfolioSummary;
};

// ── StatsProjectRow enriched with PMP data ──
export type StatsProjectRowEnriched = StatsProjectRow & {
  phase: ProjectPhase | null;
  completionPct: number;
  healthStatus: HealthStatus;
  evm: EVMResult | null;
  openHighRisks?: number;
  openIssues?: number;
  pendingChanges?: number;
};

// ─── Project Detail API ────────────────────────────────────────────────────────

export async function getProjectDetail(projectId: string, baseCurrency?: string): Promise<ProjectDetail> {
  const query = baseCurrency ? `?baseCurrency=${baseCurrency}` : "";
  const response = await request<ApiEnvelope<ProjectDetail>>(`/api/projects/${projectId}/detail${query}`);
  return response.data;
}

export async function setProjectBaseline(projectId: string, payload: { setBy?: string }): Promise<void> {
  await request<void>(`/api/projects/${projectId}/baseline`, "PATCH", payload);
}

export async function setProjectPhase(projectId: string, phase: ProjectPhase): Promise<void> {
  await request<void>(`/api/projects/${projectId}/phase`, "PATCH", { phase });
}

export async function setProjectHealth(projectId: string, healthStatus: HealthStatus): Promise<void> {
  await request<void>(`/api/projects/${projectId}/health`, "PATCH", { healthStatus });
}

export async function setProjectCompletion(projectId: string, completionPct: number): Promise<void> {
  await request<void>(`/api/projects/${projectId}/completion`, "PATCH", { completionPct });
}

// ─── Milestones ────────────────────────────────────────────────────────────────

export async function listMilestones(projectId: string): Promise<Milestone[]> {
  const response = await request<ApiEnvelope<Milestone[]>>(`/api/projects/${projectId}/milestones`);
  return response.data;
}

export async function createMilestone(projectId: string, payload: {
  name: string;
  description?: string;
  plannedDate: string;
  weight?: number;
  deliverable?: string;
  note?: string;
}): Promise<Milestone> {
  const response = await request<ApiEnvelope<Milestone>>(`/api/projects/${projectId}/milestones`, "POST", payload);
  return response.data;
}

export async function updateMilestone(projectId: string, id: string, payload: {
  name: string;
  description?: string;
  plannedDate: string;
  weight?: number;
  deliverable?: string;
  note?: string;
}): Promise<Milestone> {
  const response = await request<ApiEnvelope<Milestone>>(`/api/projects/${projectId}/milestones/${id}`, "PUT", payload);
  return response.data;
}

export async function completeMilestone(projectId: string, id: string, acceptedBy?: string): Promise<Milestone> {
  const response = await request<ApiEnvelope<Milestone>>(`/api/projects/${projectId}/milestones/${id}/complete`, "PATCH", { acceptedBy });
  return response.data;
}

export async function updateMilestoneStatus(projectId: string, id: string, status: MilestoneStatus): Promise<Milestone> {
  const response = await request<ApiEnvelope<Milestone>>(`/api/projects/${projectId}/milestones/${id}/status`, "PATCH", { status });
  return response.data;
}

export async function deleteMilestone(projectId: string, id: string): Promise<void> {
  await request<void>(`/api/projects/${projectId}/milestones/${id}`, "DELETE");
}

// ─── Risks ─────────────────────────────────────────────────────────────────────

export async function listRisks(projectId: string): Promise<Risk[]> {
  const response = await request<ApiEnvelope<Risk[]>>(`/api/projects/${projectId}/risks`);
  return response.data;
}

export async function createRisk(projectId: string, payload: {
  title: string;
  description?: string;
  probability: number;
  impact: number;
  category?: string;
  owner?: string;
  mitigationPlan?: string;
  contingencyPlan?: string;
}): Promise<Risk> {
  const response = await request<ApiEnvelope<Risk>>(`/api/projects/${projectId}/risks`, "POST", payload);
  return response.data;
}

export async function updateRisk(projectId: string, id: string, payload: {
  title: string;
  description?: string;
  probability: number;
  impact: number;
  category?: string;
  owner?: string;
  mitigationPlan?: string;
  contingencyPlan?: string;
}): Promise<Risk> {
  const response = await request<ApiEnvelope<Risk>>(`/api/projects/${projectId}/risks/${id}`, "PUT", payload);
  return response.data;
}

export async function updateRiskStatus(projectId: string, id: string, status: RiskStatus): Promise<Risk> {
  const response = await request<ApiEnvelope<Risk>>(`/api/projects/${projectId}/risks/${id}/status`, "PATCH", { status });
  return response.data;
}

export async function deleteRisk(projectId: string, id: string): Promise<void> {
  await request<void>(`/api/projects/${projectId}/risks/${id}`, "DELETE");
}

// ─── Issues ────────────────────────────────────────────────────────────────────

export async function listIssues(projectId: string): Promise<Issue[]> {
  const response = await request<ApiEnvelope<Issue[]>>(`/api/projects/${projectId}/issues`);
  return response.data;
}

export async function createIssue(projectId: string, payload: {
  title: string;
  description?: string;
  severity?: IssueSeverity;
  owner?: string;
}): Promise<Issue> {
  const response = await request<ApiEnvelope<Issue>>(`/api/projects/${projectId}/issues`, "POST", payload);
  return response.data;
}

export async function updateIssue(projectId: string, id: string, payload: {
  title: string;
  description?: string;
  severity?: IssueSeverity;
  owner?: string;
}): Promise<Issue> {
  const response = await request<ApiEnvelope<Issue>>(`/api/projects/${projectId}/issues/${id}`, "PUT", payload);
  return response.data;
}

export async function resolveIssue(projectId: string, id: string, payload: {
  resolution?: string;
  status?: IssueStatus;
}): Promise<Issue> {
  const response = await request<ApiEnvelope<Issue>>(`/api/projects/${projectId}/issues/${id}/resolve`, "PATCH", payload);
  return response.data;
}

export async function deleteIssue(projectId: string, id: string): Promise<void> {
  await request<void>(`/api/projects/${projectId}/issues/${id}`, "DELETE");
}

// ─── Change Requests ───────────────────────────────────────────────────────────

export async function listChangeRequests(projectId: string): Promise<ChangeRequest[]> {
  const response = await request<ApiEnvelope<ChangeRequest[]>>(`/api/projects/${projectId}/changes`);
  return response.data;
}

export async function createChangeRequest(projectId: string, payload: {
  title: string;
  description: string;
  type: ChangeRequestType;
  impactScope?: string;
  impactBudget?: number;
  impactDays?: number;
}): Promise<ChangeRequest> {
  const response = await request<ApiEnvelope<ChangeRequest>>(`/api/projects/${projectId}/changes`, "POST", payload);
  return response.data;
}

export async function approveChangeRequest(projectId: string, id: string, resolution?: string): Promise<ChangeRequest> {
  const response = await request<ApiEnvelope<ChangeRequest>>(`/api/projects/${projectId}/changes/${id}/approve`, "PATCH", { resolution });
  return response.data;
}

export async function rejectChangeRequest(projectId: string, id: string, resolution?: string): Promise<ChangeRequest> {
  const response = await request<ApiEnvelope<ChangeRequest>>(`/api/projects/${projectId}/changes/${id}/reject`, "PATCH", { resolution });
  return response.data;
}

export async function deleteChangeRequest(projectId: string, id: string): Promise<void> {
  await request<void>(`/api/projects/${projectId}/changes/${id}`, "DELETE");
}

// ─── Project Timeline ──────────────────────────────────────────────────────────

export type ProjectTimeline = {
  projectId: string;
  projectName: string;
  baseCurrency: string;
  bac: number;
  startDate: string;
  endDate: string;
  completionPct: number | null;
  actualCost: { month: string; ac: number }[];
  plannedValue: { month: string; pv: number }[];
};

export async function getProjectTimeline(projectId: string): Promise<ProjectTimeline> {
  const response = await request<ApiEnvelope<ProjectTimeline>>(`/api/projects/${projectId}/timeline`);
  return response.data;
}

// ─── Portfolio ─────────────────────────────────────────────────────────────────

export async function getPortfolio(baseCurrency?: string): Promise<Portfolio> {
  const query = baseCurrency ? `?baseCurrency=${baseCurrency}` : "";
  const response = await request<ApiEnvelope<Portfolio>>(`/api/stats/portfolio${query}`);
  return response.data;
}

// ─── Profile ───────────────────────────────────────────────────────────────────

export type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
  bio: string | null;
  phrase: string | null;
  roles: AppRole[];
  skills?: string[];
};

export async function getProfile(): Promise<UserProfile> {
  const response = await request<ApiEnvelope<UserProfile>>("/api/profile");
  return response.data;
}

export async function updateProfile(payload: {
  displayName: string;
  photoUrl?: string | null;
  bio?: string | null;
  phrase?: string | null;
  skills?: string[];
}): Promise<UserProfile> {
  const response = await request<ApiEnvelope<UserProfile>>("/api/profile", "PUT", payload);
  return response.data;
}

// ─── Extra Hours ───────────────────────────────────────────────────────────────

export type ExtraHourStatus = "PENDING_PM" | "PENDING_FINANCE" | "APPROVED" | "REJECTED";

export type ExtraHourEntry = {
  id: string;
  consultantId: string;
  projectId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  diurnal: string;
  nocturnal: string;
  diurnalHoliday: string;
  nocturnalHoliday: string;
  totalHours: string;
  diurnalAmount: string;
  nocturnalAmount: string;
  diurnalHolidayAmount: string;
  nocturnalHolidayAmount: string;
  totalAmount: string;
  observations: string | null;
  status: ExtraHourStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionNote: string | null;
  createdAt: string;
  updatedAt: string;
  project?: Project | null;
  consultant?: Consultant;
};

export type ExtraHoursConfig = {
  id: string;
  country: string;
  weeklyExtraHoursLimit: string;
  diurnalMultiplier: string;
  nocturnalMultiplier: string;
  diurnalHolidayMultiplier: string;
  nocturnalHolidayMultiplier: string;
  diurnalStart: string;
  diurnalEnd: string;
  monthlyDivisor: string;
  createdAt: string;
  updatedAt: string;
};

export type ExtraHoursCalculationResult = {
  diurnal: number;
  nocturnal: number;
  diurnalHoliday: number;
  nocturnalHoliday: number;
  totalHours: number;
  diurnalAmount: number;
  nocturnalAmount: number;
  diurnalHolidayAmount: number;
  nocturnalHolidayAmount: number;
  totalAmount: number;
  hourlyRate: number;
  hourlyRateUsed: number;
  divisorUsed: number;
  isHoliday: boolean;
  warnings: string[];
};

export type PayrollConsolidationRow = {
  consultantName: string;
  identification: string;
  country: string;
  currency: string;
  totalHours: number;
  diurnal: number;
  nocturnal: number;
  diurnalHoliday: number;
  nocturnalHoliday: number;
  totalAmountLocal: number;
  totalAmountUSD: number;
};

export async function listExtraHours(): Promise<ExtraHourEntry[]> {
  const response = await request<ApiEnvelope<ExtraHourEntry[]>>("/api/extra-hours");
  return response.data;
}

export async function createExtraHour(payload: {
  projectId: string;
  consultantId: string;
  date: string;
  startTime: string;
  endTime: string;
  observations?: string;
}): Promise<{ data: ExtraHourEntry; warnings: string[] }> {
  return await request<{ data: ExtraHourEntry; warnings: string[] }>("/api/extra-hours", "POST", payload);
}

export async function calculateExtraHoursApi(payload: {
  consultantId: string;
  date: string;
  startTime: string;
  endTime: string;
}): Promise<ExtraHoursCalculationResult> {
  const response = await request<ApiEnvelope<ExtraHoursCalculationResult>>("/api/extra-hours/calculate", "POST", payload);
  return response.data;
}

export async function getExtraHoursConfig(): Promise<ExtraHoursConfig> {
  const response = await request<ApiEnvelope<ExtraHoursConfig>>("/api/extra-hours/config/Default");
  return response.data;
}

export async function listExtraHoursConfigs(): Promise<ExtraHoursConfig[]> {
  const response = await request<ApiEnvelope<ExtraHoursConfig[]>>("/api/extra-hours/config");
  return response.data;
}

export async function getCountryExtraHoursConfig(country: string): Promise<ExtraHoursConfig> {
  const response = await request<ApiEnvelope<ExtraHoursConfig>>(`/api/extra-hours/config/${country}`);
  return response.data;
}

export async function updateCountryExtraHoursConfig(
  country: string,
  payload: {
    weeklyExtraHoursLimit: number;
    diurnalMultiplier: number;
    nocturnalMultiplier: number;
    diurnalHolidayMultiplier: number;
    nocturnalHolidayMultiplier: number;
    diurnalStart: string;
    diurnalEnd: string;
    monthlyDivisor: number;
  },
): Promise<ExtraHoursConfig> {
  const response = await request<ApiEnvelope<ExtraHoursConfig>>(`/api/extra-hours/config/${country}`, "PUT", payload);
  return response.data;
}

export async function resetCountryExtraHoursConfig(country: string): Promise<ExtraHoursConfig> {
  const response = await request<ApiEnvelope<ExtraHoursConfig>>(`/api/extra-hours/config/${country}/reset`, "POST");
  return response.data;
}

// Igual que en horas normales: `approvedBy` sale del token en el backend.
export async function approveExtraHour(id: string): Promise<ExtraHourEntry> {
  const response = await request<ApiEnvelope<ExtraHourEntry>>(`/api/extra-hours/${id}/approve`, "PATCH");
  return response.data;
}

export async function rejectExtraHour(id: string, payload: {
  rejectionNote: string;
}): Promise<ExtraHourEntry> {
  const response = await request<ApiEnvelope<ExtraHourEntry>>(`/api/extra-hours/${id}/reject`, "PATCH", payload);
  return response.data;
}

export async function getPayrollSummary(year: number, month: number): Promise<PayrollConsolidationRow[]> {
  const response = await request<ApiEnvelope<PayrollConsolidationRow[]>>(`/api/extra-hours/payroll?year=${year}&month=${month}`);
  return response.data;
}

export async function deleteExtraHour(id: string): Promise<void> {
  await request<void>(`/api/extra-hours/${id}`, "DELETE");
}

export type OfficialHoliday = {
  date: string;
  name: string;
  isCustom: boolean;
};

export async function getOfficialHolidays(country: string, year: number): Promise<OfficialHoliday[]> {
  const response = await request<ApiEnvelope<OfficialHoliday[]>>(`/api/extra-hours/holidays?country=${country}&year=${year}`);
  return response.data;
}

export async function listSupportedCountries(): Promise<string[]> {
  const response = await request<ApiEnvelope<string[]>>("/api/extra-hours/countries");
  return response.data;
}

// ─── Estimations ───────────────────────────────────────────────────────────────

export type Estimation = {
  id: string;
  projectId: string | null;
  projectName: string;
  createdAt: string;
  totalIdealHours: string;
  totalAdjustedHours: string;
  bufferPercentage: string;
  riskLevel: string;
  confidenceLevel: string;
  rawDataJson: string;
  project?: Project | null;
};

export async function listEstimations(): Promise<Estimation[]> {
  const response = await request<ApiEnvelope<Estimation[]>>("/api/estimations");
  return response.data;
}

export async function listProjectEstimations(projectId: string): Promise<Estimation[]> {
  const response = await request<ApiEnvelope<Estimation[]>>(`/api/estimations/project/${projectId}`);
  return response.data;
}

export async function createEstimation(payload: {
  projectId?: string | null;
  projectName: string;
  totalIdealHours: number;
  totalAdjustedHours: number;
  bufferPercentage: number;
  riskLevel: string;
  confidenceLevel: number;
  rawDataJson: string;
}): Promise<Estimation> {
  const response = await request<ApiEnvelope<Estimation>>("/api/estimations", "POST", payload);
  return response.data;
}

export async function deleteEstimation(id: string): Promise<void> {
  await request<void>(`/api/estimations/${id}`, "DELETE");
}

// ─── Activities ────────────────────────────────────────────────────────────────

export type ActivityType = "project" | "personal" | "meeting" | "training" | "support" | "other";
export type ActivityPriority = "low" | "medium" | "high" | "urgent";
export type ActivityStatus = "pending" | "in_progress" | "completed" | "cancelled" | "blocked";

export type Activity = {
  id: string;
  title: string;
  description: string | null;
  consultantId: string;
  projectId: string | null;
  activityType: ActivityType;
  scheduledDate: string;
  dueDate: string | null;
  completedDate: string | null;
  estimatedHours: string;
  actualHours: string;
  status: ActivityStatus;
  priority: ActivityPriority;
  comments: string | null;
  createdAt: string;
  updatedAt: string;
  project?: Project | null;
  consultant?: Consultant;
};

export async function listActivities(params?: {
  consultantId?: string;
  projectId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<Activity[]> {
  const query = new URLSearchParams();
  if (params?.consultantId) query.set("consultantId", params.consultantId);
  if (params?.projectId) query.set("projectId", params.projectId);
  if (params?.startDate) query.set("startDate", params.startDate);
  if (params?.endDate) query.set("endDate", params.endDate);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await request<ApiEnvelope<Activity[]>>(`/api/activities${suffix}`);
  return response.data;
}

export async function createActivity(payload: {
  title: string;
  description?: string | null;
  consultantId: string;
  projectId?: string | null;
  activityType: ActivityType;
  scheduledDate: string;
  dueDate?: string | null;
  completedDate?: string | null;
  estimatedHours: number;
  actualHours: number;
  status: ActivityStatus;
  priority: ActivityPriority;
  comments?: string | null;
}): Promise<Activity> {
  const response = await request<ApiEnvelope<Activity>>("/api/activities", "POST", payload);
  return response.data;
}

export async function updateActivity(
  id: string,
  payload: {
    title: string;
    description?: string | null;
    consultantId: string;
    projectId?: string | null;
    activityType: ActivityType;
    scheduledDate: string;
    dueDate?: string | null;
    completedDate?: string | null;
    estimatedHours: number;
    actualHours: number;
    status: ActivityStatus;
    priority: ActivityPriority;
    comments?: string | null;
  },
): Promise<Activity> {
  const response = await request<ApiEnvelope<Activity>>(`/api/activities/${id}`, "PUT", payload);
  return response.data;
}

export async function deleteActivity(id: string): Promise<void> {
  await request<void>(`/api/activities/${id}`, "DELETE");
}

// ─── Custom Holidays ──────────────────────────────────────────────────────────

export type CustomHoliday = {
  id: string;
  name: string;
  date: string;
  country: string;
  createdAt: string;
  updatedAt: string;
};

export async function listCustomHolidays(): Promise<CustomHoliday[]> {
  const response = await request<ApiEnvelope<CustomHoliday[]>>("/api/custom-holidays");
  return response.data;
}

export async function createCustomHoliday(payload: {
  name: string;
  date: string;
  country: string;
}): Promise<CustomHoliday> {
  const response = await request<ApiEnvelope<CustomHoliday>>("/api/custom-holidays", "POST", payload);
  return response.data;
}

export async function deleteCustomHoliday(id: string): Promise<void> {
  await request<void>(`/api/custom-holidays/${id}`, "DELETE");
}

// ─── Approval Delegations ─────────────────────────────────────────────────────

export type ApprovalDelegation = {
  id: string;
  projectId: string;
  fromUserEmail: string;
  toUserEmail: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  project?: Project;
};

export async function listDelegations(): Promise<ApprovalDelegation[]> {
  const response = await request<ApiEnvelope<ApprovalDelegation[]>>("/api/delegations");
  return response.data;
}

export async function createDelegation(payload: {
  projectId: string;
  toUserEmail: string;
  startDate: string;
  endDate: string;
}): Promise<ApprovalDelegation> {
  const response = await request<ApiEnvelope<ApprovalDelegation>>("/api/delegations", "POST", payload);
  return response.data;
}

export async function deleteDelegation(id: string): Promise<void> {
  await request<void>(`/api/delegations/${id}`, "DELETE");
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export async function getAuditLogs(params?: { entityId?: string; entity?: string }): Promise<AuditLog[]> {
  const query = new URLSearchParams();
  if (params?.entityId) query.set("entityId", params.entityId);
  if (params?.entity) query.set("entity", params.entity);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await request<ApiEnvelope<AuditLog[]>>(`/api/audit${suffix}`);
  return response.data;
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

export async function sendFeedback(payload: { category: "BUG" | "SUGGESTION" | "AESTHETIC" | "OTHER"; notes: string }): Promise<{ message: string }> {
  return request<{ message: string }>("/api/feedback", "POST", payload);
}

