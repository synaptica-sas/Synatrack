import { useState, useEffect, useMemo, useCallback } from "react";
import { PageHeader } from "../../components/PageHeader";
import { 
  createEstimation, 
  listEstimations, 
  deleteEstimation, 
  listCustomHolidays,
  type Project, 
  type Estimation,
  type CustomHoliday
} from "../../services/api";
import { ConfirmDialog } from "../../components/ConfirmDialog";

type EstimationCalculatorTabProps = {
  projects: Project[];
  canWrite: boolean;
  onError: (msg: string) => void;
};

type TaskInput = {
  id: number;
  name: string;
  idealHours: number;
  complexity: "routine" | "known_unknowns" | "unknown_unknowns";
  techDebt: "clean" | "moderate" | "heavy" | "legacy";
  dependencies: "none" | "internal" | "external" | "multiple";
  hasCodeReview: boolean;
  hasTesting: boolean;
  hasDocumentation: boolean;
  meetingsPerDay: number;
  contextSwitching: boolean;
  notes: string;
};

interface EstimationWeights {
  compRoutine: number;
  compKnownUnknowns: number;
  compUnknownUnknowns: number;
  
  expSenior: number;
  expMid: number;
  expJunior: number;
  expMixed: number;
  
  debtClean: number;
  debtModerate: number;
  debtHeavy: number;
  debtLegacy: number;
  
  depNone: number;
  depInternal: number;
  depExternal: number;
  depMultiple: number;
  
  ceremonyCodeReview: number;
  ceremonyTesting: number;
  ceremonyDocumentation: number;
  
  contextSwitchingPenalty: number;
  brooksFactor: number;
  
  scopeClosed: number;
  scopePending: number;
  scopeDiffuse: number;
  scopeNoTechnicalClosure: number;

  // Toggles for enabling/disabling factors
  useComplexityFactor?: boolean;
  useExperienceFactor?: boolean;
  useTechDebtFactor?: boolean;
  useDependencyFactor?: boolean;
  useBrooksFactor?: boolean;
  useScopeFactor?: boolean;
}

const DEFAULT_WEIGHTS: EstimationWeights = {
  // Complexity: base uncertainty multiplier (applied to idealHours)
  compRoutine: 1.2,          // was 1.3 — routine tasks inflate less
  compKnownUnknowns: 1.6,    // was 2.0 — more realistic for normal unknowns
  compUnknownUnknowns: 2.8,  // was 3.5 — still high, but not absurd
  
  // Experience: overhead delta over senior baseline (1.0 = no overhead)
  expSenior: 1.0,
  expMid: 1.15,    // was 1.25 — small extra time for mid-levels
  expJunior: 1.35, // was 1.6  — meaningful but not 60% penalty
  expMixed: 1.15,
  
  // Tech Debt: additive overhead factor
  debtClean: 1.0,
  debtModerate: 1.2,  // was 1.3
  debtHeavy: 1.45,    // was 1.6
  debtLegacy: 1.8,    // was 2.0
  
  // Dependencies: additive overhead factor
  depNone: 1.0,
  depInternal: 1.15,  // was 1.2
  depExternal: 1.25,  // was 1.4
  depMultiple: 1.45,  // was 1.6
  
  // Ceremonies: % of baseEffort added as fixed overhead
  ceremonyCodeReview: 0.10,    // was 0.15
  ceremonyTesting: 0.20,       // was 0.25
  ceremonyDocumentation: 0.08, // was 0.10
  
  // Context switching: % overhead over baseEffort
  contextSwitchingPenalty: 1.12, // was 1.15
  // Brooks' Law: % overhead per communication channel (n*(n-1)/2)
  brooksFactor: 0.05,            // was 0.08 — less aggressive per channel
  
  // Scope definition: multiplier on full adjusted effort
  scopeClosed: 1.0,
  scopePending: 1.15,            // was 1.25
  scopeDiffuse: 1.4,             // was 1.6
  scopeNoTechnicalClosure: 1.8,  // was 2.0

  // Toggle defaults
  useComplexityFactor: true,
  useExperienceFactor: true,
  useTechDebtFactor: true,
  useDependencyFactor: true,
  useBrooksFactor: true,
  useScopeFactor: true
};


// Date Utilities (UTC-based to avoid local timezone offsets)
function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const getTodayUTCStr = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

// Helper to calculate Easter Sunday (Gauss Algorithm)
function calculateEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(Date.UTC(year, month - 1, day));
}

// Helper to get the N-th Monday of a given month
function getNthMonday(year: number, month: number, n: number): Date {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const dayOfWeek = firstDay.getUTCDay();
  const daysUntilMonday = (1 - dayOfWeek + 7) % 7;
  const firstMondayDay = 1 + daysUntilMonday;
  const targetDay = firstMondayDay + (n - 1) * 7;
  return new Date(Date.UTC(year, month - 1, targetDay));
}

// Helper to get the N-th Thursday of a given month
function getNthThursday(year: number, month: number, n: number): Date {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const dayOfWeek = firstDay.getUTCDay();
  const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
  const firstThursdayDay = 1 + daysUntilThursday;
  const targetDay = firstThursdayDay + (n - 1) * 7;
  return new Date(Date.UTC(year, month - 1, targetDay));
}

// Helper to move Chilean holidays under Law 19.668
function moveChileanHoliday(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay();
  if (dayOfWeek === 2 || dayOfWeek === 3 || dayOfWeek === 4) {
    const offset = dayOfWeek === 2 ? -1 : dayOfWeek === 3 ? -2 : -3;
    return new Date(date.getTime() + offset * 24 * 60 * 60 * 1000);
  } else if (dayOfWeek === 5) {
    return new Date(date.getTime() + 3 * 24 * 60 * 60 * 1000);
  }
  return date;
}

// Helper to move Ecuadorian holidays
function moveEcuadorHoliday(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay();
  if (dayOfWeek === 6) {
    return new Date(date.getTime() - 1 * 24 * 60 * 60 * 1000);
  } else if (dayOfWeek === 0) {
    return new Date(date.getTime() + 1 * 24 * 60 * 60 * 1000);
  } else if (dayOfWeek === 2) {
    return new Date(date.getTime() - 1 * 24 * 60 * 60 * 1000);
  } else if (dayOfWeek === 3) {
    return new Date(date.getTime() + 2 * 24 * 60 * 60 * 1000);
  } else if (dayOfWeek === 4) {
    return new Date(date.getTime() + 1 * 24 * 60 * 60 * 1000);
  }
  return date;
}

// Get public holidays for a year and country code
function getHolidaysForYear(year: number, country: string): Date[] {
  const holidays: Date[] = [];
  const normalizedCountry = (country || "").toLowerCase();

  // Colombia
  if (normalizedCountry === "co") {
    // Fixed
    const fixed = ["01-01", "05-01", "07-20", "08-07", "12-08", "12-25"];
    fixed.forEach((f) => {
      const [m, d] = f.split("-").map(Number);
      holidays.push(new Date(Date.UTC(year, m - 1, d)));
    });

    // Movable (Emiliani Law)
    const movable = ["01-06", "03-19", "06-29", "08-15", "10-12", "11-01", "11-11"];
    movable.forEach((m) => {
      const [mo, d] = m.split("-").map(Number);
      const originalDate = new Date(Date.UTC(year, mo - 1, d));
      if (originalDate.getUTCDay() === 1) {
        holidays.push(originalDate);
      } else {
        const daysUntilMonday = (1 - originalDate.getUTCDay() + 7) % 7;
        const offset = daysUntilMonday === 0 ? 7 : daysUntilMonday;
        holidays.push(new Date(originalDate.getTime() + offset * 24 * 60 * 60 * 1000));
      }
    });

    // Easter Dependent
    const easter = calculateEasterSunday(year);
    const easterDependent = [-3, -2, 43, 64, 71];
    easterDependent.forEach((offset) => {
      const holidayDate = new Date(easter.getTime() + offset * 24 * 60 * 60 * 1000);
      if (offset === -3 || offset === -2) {
        holidays.push(holidayDate);
      } else {
        if (holidayDate.getUTCDay() === 1) {
          holidays.push(holidayDate);
        } else {
          const daysUntilMonday = (1 - holidayDate.getUTCDay() + 7) % 7;
          const offsetMonday = daysUntilMonday === 0 ? 7 : daysUntilMonday;
          holidays.push(new Date(holidayDate.getTime() + offsetMonday * 24 * 60 * 60 * 1000));
        }
      }
    });
  }
  // Perú
  else if (normalizedCountry === "pe") {
    const fixed = ["01-01", "05-01", "06-07", "06-29", "07-23", "07-28", "07-29", "08-06", "08-30", "10-08", "11-01", "12-08", "12-09", "12-25"];
    fixed.forEach((f) => {
      const [m, d] = f.split("-").map(Number);
      holidays.push(new Date(Date.UTC(year, m - 1, d)));
    });
    const easter = calculateEasterSunday(year);
    holidays.push(new Date(easter.getTime() - 3 * 24 * 60 * 60 * 1000)); // Jueves Santo
    holidays.push(new Date(easter.getTime() - 2 * 24 * 60 * 60 * 1000)); // Viernes Santo
  }
  // Chile
  else if (normalizedCountry === "cl") {
    const fixed = ["01-01", "05-01", "05-21", "07-16", "08-15", "09-18", "09-19", "11-01", "12-08", "12-25"];
    fixed.forEach((f) => {
      const [m, d] = f.split("-").map(Number);
      holidays.push(new Date(Date.UTC(year, m - 1, d)));
    });
    holidays.push(moveChileanHoliday(year, 6, 29));
    holidays.push(moveChileanHoliday(year, 10, 12));
    
    // Evangélicos
    const evangBase = new Date(Date.UTC(year, 9, 31));
    const evangDay = evangBase.getUTCDay();
    let evangDate = evangBase;
    if (evangDay === 3) {
      evangDate = new Date(Date.UTC(year, 10, 2)); // Friday Nov 2
    } else if (evangDay === 2) {
      evangDate = new Date(Date.UTC(year, 9, 27)); // Friday Oct 27
    }
    holidays.push(evangDate);

    const easter = calculateEasterSunday(year);
    holidays.push(new Date(easter.getTime() - 2 * 24 * 60 * 60 * 1000)); // Viernes Santo
    holidays.push(new Date(easter.getTime() - 1 * 24 * 60 * 60 * 1000)); // Sábado Santo
  }
  // México
  else if (normalizedCountry === "mx") {
    const fixed = ["01-01", "05-01", "09-16", "12-25"];
    fixed.forEach((f) => {
      const [m, d] = f.split("-").map(Number);
      holidays.push(new Date(Date.UTC(year, m - 1, d)));
    });
    holidays.push(getNthMonday(year, 2, 1));
    holidays.push(getNthMonday(year, 3, 3));
    holidays.push(getNthMonday(year, 11, 3));
    
    if ((year - 2024) % 6 === 0) {
      holidays.push(new Date(Date.UTC(year, 11, 1)));
    }
  }
  // Ecuador
  else if (normalizedCountry === "ec") {
    holidays.push(new Date(Date.UTC(year, 0, 1)));
    holidays.push(new Date(Date.UTC(year, 4, 1)));
    holidays.push(new Date(Date.UTC(year, 11, 25)));
    holidays.push(moveEcuadorHoliday(year, 5, 24));
    holidays.push(moveEcuadorHoliday(year, 8, 10));
    holidays.push(moveEcuadorHoliday(year, 10, 9));
    holidays.push(moveEcuadorHoliday(year, 11, 2));
    holidays.push(moveEcuadorHoliday(year, 11, 3));

    const easter = calculateEasterSunday(year);
    holidays.push(new Date(easter.getTime() - 48 * 24 * 60 * 60 * 1000)); // Lunes de Carnaval
    holidays.push(new Date(easter.getTime() - 47 * 24 * 60 * 60 * 1000)); // Martes de Carnaval
    holidays.push(new Date(easter.getTime() - 2 * 24 * 60 * 60 * 1000)); // Viernes Santo
  }
  // Default / USA
  else {
    holidays.push(new Date(Date.UTC(year, 0, 1)));
    holidays.push(new Date(Date.UTC(year, 6, 4)));
    holidays.push(new Date(Date.UTC(year, 11, 25)));
    holidays.push(getNthMonday(year, 9, 1));
    holidays.push(getNthThursday(year, 11, 4));
    const firstMondayJune = getNthMonday(year, 6, 1);
    const memorialDay = new Date(firstMondayJune.getTime() - 7 * 24 * 60 * 60 * 1000);
    holidays.push(memorialDay);
  }

  return holidays;
}

function isHolidayFrontend(date: Date, country: string, customHolidays: CustomHoliday[]): boolean {
  const year = date.getUTCFullYear();
  const dayOfWeek = date.getUTCDay();

  // Sundays are always holiday-equivalents for calendar checks
  if (dayOfWeek === 0) return true;

  // Custom corporate holidays check
  const dateStr = formatDateUTC(date);
  const normalizedCountry = (country || "").toLowerCase();
  
  const matchesCustom = customHolidays.some((ch) => {
    const chCountry = (ch.country || "").toLowerCase();
    return ch.date === dateStr && (chCountry === "all" || chCountry === normalizedCountry);
  });
  
  if (matchesCustom) return true;

  try {
    const publicHols = getHolidaysForYear(year, country);
    const targetTime = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return publicHols.some((h) => {
      const holidayTime = Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), h.getUTCDate());
      return holidayTime === targetTime;
    });
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// InfoTooltip: CSS-only hover tooltip. No state required.
// Usage: <InfoTooltip text="Explicación breve del campo" />
// ─────────────────────────────────────────────────────────────────────────────
function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="info-tooltip-wrapper">
      <span className="info-tooltip-icon">i</span>
      <span className="info-tooltip-bubble">
        {text}
        <span className="info-tooltip-arrow" />
      </span>
    </span>
  );
}

const INITIAL_TASK = (index: number): TaskInput => ({
  id: Date.now() + index,
  name: `Tarea ${index + 1}`,
  idealHours: 8,
  complexity: "routine",
  techDebt: "clean",
  dependencies: "none",
  hasCodeReview: true,
  hasTesting: true,
  hasDocumentation: false,
  meetingsPerDay: 1,
  contextSwitching: false,
  notes: ""
});

export function EstimationCalculatorTab({ projects, canWrite, onError }: EstimationCalculatorTabProps) {
  // Tooltips global toggle (persistent in localStorage)
  const [showTooltips, setShowTooltips] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("synaptica_show_tooltips");
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });

  const handleToggleTooltips = () => {
    setShowTooltips((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("synaptica_show_tooltips", String(next));
      } catch (e) {
        console.error(e);
      }
      return next;
    });
  };

  // Configuración de Estimaciones
  const [tasks, setTasks] = useState<TaskInput[]>(() => [INITIAL_TASK(0)]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [estimationContext, setEstimationContext] = useState<string>("");
  const [hoursPerDay, setHoursPerDay] = useState<number>(8);
  const [sprintDays, setSprintDays] = useState<number>(10);
  const [bufferPercentage, setBufferPercentage] = useState<number>(15);
  
  // Phase 3 States
  const [includeWeekends, setIncludeWeekends] = useState<boolean>(false);
  const [includeHolidays, setIncludeHolidays] = useState<boolean>(false);
  const [teamSeniorCount, setTeamSeniorCount] = useState<number>(1);
  const [teamMidCount, setTeamMidCount] = useState<number>(0);
  const [teamJuniorCount, setTeamJuniorCount] = useState<number>(0);
  const [scopeDefinition, setScopeDefinition] = useState<string>("closed");
  const [startDate, setStartDate] = useState<string>(getTodayUTCStr());
  const [estimationCountry, setEstimationCountry] = useState<string>("US");
  const [customHolidays, setCustomHolidays] = useState<CustomHoliday[]>([]);

  // Navigation Sub-tabs state
  const [activeMainTab, setActiveMainTab] = useState<"estimator" | "weights">("estimator");
  const [guideTab, setGuideTab] = useState<"concepts" | "example" | "factors">("concepts");

  // Weights state initialized from localStorage
  const [weights, setWeights] = useState<EstimationWeights>(() => {
    try {
      const saved = localStorage.getItem("synaptica_estimation_weights");
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_WEIGHTS, ...parsed };
      }
    } catch (e) {
      console.error("Error loading weights from localStorage", e);
    }
    return DEFAULT_WEIGHTS;
  });

  const [estimations, setEstimations] = useState<Estimation[]>([]);
  const [loadingEstimations, setLoadingEstimations] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTaskIndex, setActiveTaskIndex] = useState<number>(0);
  const [showEducation, setShowEducation] = useState(true);
  
  // Custom dialog state
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Load Custom Holidays on mount
  const fetchCustomHolidays = useCallback(async () => {
    try {
      const data = await listCustomHolidays();
      setCustomHolidays(data);
    } catch (err) {
      console.error("Error al cargar festivos corporativos", err);
    }
  }, []);

  useEffect(() => {
    void fetchCustomHolidays();
  }, [fetchCustomHolidays]);

  // Load saved estimations
  const loadEstimations = useCallback(async () => {
    setLoadingEstimations(true);
    try {
      const data = await listEstimations();
      setEstimations(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al cargar estimaciones");
    } finally {
      setLoadingEstimations(false);
    }
  }, [onError]);

  useEffect(() => {
    void loadEstimations();
  }, [loadEstimations]);

  // Dynamic values using current weights calibration
  const complexityLevels = useMemo(() => [
    {
      key: "routine", label: `Rutinaria (x${weights.compRoutine})`, uFactor: weights.compRoutine, color: "#22c55e", icon: "✅",
      desc: "Trabajo estándar repetido muchas veces. CRUD básico, queries simples o componentes comunes.",
      examples: ["CRUD básico", "Componente UI estándar", "Endpoint REST común"]
    },
    {
      key: "known_unknowns", label: `Incógnitas Conocidas (x${weights.compKnownUnknowns})`, uFactor: weights.compKnownUnknowns, color: "#eab308", icon: "⚠️",
      desc: "Hay dependencias de terceros, APIs de otros equipos o código legacy sin pruebas automatizadas.",
      examples: ["Integración API externa", "Refactorizar módulo legacy", "Feature multi-servicio"]
    },
    {
      key: "unknown_unknowns", label: `Territorio Inexplorado (x${weights.compUnknownUnknowns})`, uFactor: weights.compUnknownUnknowns, color: "#ef4444", icon: "🔴",
      desc: "Tecnología nueva o inestable para el equipo, requisitos sumamente ambiguos o sin documentación.",
      examples: ["Integración IA desde cero", "Protocolo de red propietario", "Cambio de arquitectura core"]
    }
  ], [weights]);


  const techDebtOptions = useMemo(() => [
    { key: "clean", label: `Código Limpio (x${weights.debtClean})`, factor: weights.debtClean, desc: "Bases de código estables, buena cobertura de tests, CI/CD fluido." },
    { key: "moderate", label: `Deuda Moderada (x${weights.debtModerate})`, factor: weights.debtModerate, desc: "Algunas deficiencias arquitectónicas y tests escasos pero comprensible." },
    { key: "heavy", label: `Deuda Pesada (x${weights.debtHeavy})`, factor: weights.debtHeavy, desc: "Sin pruebas automatizadas, alto acoplamiento, alta fricción al compilar." },
    { key: "legacy", label: `Legacy Crítico (x${weights.debtLegacy})`, factor: weights.debtLegacy, desc: "Monolito obsoleto, miedo a introducir cambios, sin soporte." }
  ], [weights]);

  const dependencyOptions = useMemo(() => [
    { key: "none", label: `Sin dependencias (x${weights.depNone})`, factor: weights.depNone, desc: "El equipo tiene control total de la entrega." },
    { key: "internal", label: `Interna – Otro equipo (x${weights.depInternal})`, factor: weights.depInternal, desc: "Bloqueos por prioridades cruzadas dentro de la empresa." },
    { key: "external", label: `Externa – Proveedor / API (x${weights.depExternal})`, factor: weights.depExternal, desc: "Dependes de tiempos de respuesta de un tercero o pasarela externa." },
    { key: "multiple", label: `Múltiples bloqueantes (x${weights.depMultiple})`, factor: weights.depMultiple, desc: "Múltiples dependencias cruzadas simultáneas." }
  ], [weights]);

  const scopeDefinitionLevels = useMemo(() => [
    { key: "closed", label: `Cerrado y Acotado (x${weights.scopeClosed})`, factor: weights.scopeClosed, color: "#22c55e", desc: "Requisitos 100% claros, aprobados y firmados, sin posibilidad de cambios sin control de cambios estricto." },
    { key: "pending", label: `Pendientes Menores (x${weights.scopePending})`, factor: weights.scopePending, color: "#eab308", desc: "Flujos claros pero quedan detalles cosméticos o APIs secundarias por confirmar." },
    { key: "diffuse", label: `Difuso / WIP (x${weights.scopeDiffuse})`, factor: weights.scopeDiffuse, color: "#ef4444", desc: "El cliente sabe qué quiere lograr pero no el cómo. Historias de usuario ambiguas o incompletas." },
    { key: "no_closure", label: `Sin Cierre Técnico (x${weights.scopeNoTechnicalClosure})`, factor: weights.scopeNoTechnicalClosure, color: "#7f1d1d", desc: "Incertidumbre crítica. El alcance cambia semanalmente, sin alcances definidos ni límites técnicos." }
  ], [weights]);

  // Brooks' Law SVG node visualizer generation
  const devList = useMemo(() => {
    const list: { type: "senior" | "mid" | "junior"; color: string; label: string }[] = [];
    for (let i = 0; i < teamSeniorCount; i++) list.push({ type: "senior", color: "#22c55e", label: "SR" });
    for (let i = 0; i < teamMidCount; i++) list.push({ type: "mid", color: "#eab308", label: "MID" });
    for (let i = 0; i < teamJuniorCount; i++) list.push({ type: "junior", color: "#ef4444", label: "JR" });
    return list;
  }, [teamSeniorCount, teamMidCount, teamJuniorCount]);

  const totalDevs = devList.length;
  const totalChannels = (totalDevs * (totalDevs - 1)) / 2;

  const nodes = useMemo(() => {
    const R = 70;
    const cx = 105;
    const cy = 105;
    return devList.map((dev, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, totalDevs) - Math.PI / 2;
      return {
        x: cx + R * Math.cos(angle),
        y: cy + R * Math.sin(angle),
        ...dev
      };
    });
  }, [devList, totalDevs]);

  const lines = useMemo(() => {
    const list: { x1: number; y1: number; x2: number; y2: number }[] = [];
    // Limit line rendering to prevent browser freeze if team count is too high (e.g. max 12 devs in visualization)
    const limitNodes = nodes.slice(0, 12);
    for (let i = 0; i < limitNodes.length; i++) {
      for (let j = i + 1; j < limitNodes.length; j++) {
        list.push({
          x1: limitNodes[i].x,
          y1: limitNodes[i].y,
          x2: limitNodes[j].x,
          y2: limitNodes[j].y
        });
      }
    }
    return list;
  }, [nodes]);

  // ADDITIVE OVERHEAD calculation engine
  // ─────────────────────────────────────────────────────────────────────────────
  // Instead of multiplying all factors together (which creates exponential
  // inflation), each overhead is calculated as a delta on top of baseEffort
  // and added independently. This keeps results proportional and transparent.
  // ─────────────────────────────────────────────────────────────────────────────
  const calculateTask = useCallback((task: TaskInput) => {
    const comp = complexityLevels.find((c) => c.key === task.complexity) || complexityLevels[0];
    const debt = techDebtOptions.find((t) => t.key === task.techDebt) || techDebtOptions[0];
    const dep = dependencyOptions.find((d) => d.key === task.dependencies) || dependencyOptions[0];
    const scope = scopeDefinitionLevels.find((s) => s.key === scopeDefinition) || scopeDefinitionLevels[0];

    // ── 1. Base effort: idealHours × complexity multiplier ──────────────────
    const compFactor = (weights.useComplexityFactor !== false) ? comp.uFactor : 1.0;
    const baseEffort = task.idealHours * compFactor;
    const uncertaintyOverhead = baseEffort - task.idealHours;

    // ── 2. Team experience overhead (weighted average of team composition) ──
    const calculatedTeamSize = Math.max(1, teamJuniorCount + teamMidCount + teamSeniorCount);
    const averageExpFactor = (weights.useExperienceFactor !== false)
      ? (
          teamSeniorCount * weights.expSenior +
          teamMidCount    * weights.expMid    +
          teamJuniorCount * weights.expJunior
        ) / calculatedTeamSize
      : 1.0;
    // overhead = how much slower than a pure-senior team
    const expOverhead = baseEffort * (averageExpFactor - 1);

    // ── 3. Tech debt overhead ───────────────────────────────────────────────
    const debtFactor = (weights.useTechDebtFactor !== false) ? (debt.factor !== null ? debt.factor : 1.0) : 1.0;
    const debtOverhead = baseEffort * (debtFactor - 1);

    // ── 4. Dependency overhead ──────────────────────────────────────────────
    const depFactor = (weights.useDependencyFactor !== false) ? (dep.factor !== null ? dep.factor : 1.0) : 1.0;
    const depOverhead = baseEffort * (depFactor - 1);

    // ── 5. Context switching overhead (optional toggle) ─────────────────────
    const switchingOverhead = task.contextSwitching
      ? baseEffort * (weights.contextSwitchingPenalty - 1)
      : 0;

    // ── 6. Brooks' Law team communication overhead ──────────────────────────
    // L = n(n-1)/2 communication channels; each adds brooksFactor% overhead
    const L = (calculatedTeamSize * (calculatedTeamSize - 1)) / 2;
    const brooksOverhead = (weights.useBrooksFactor !== false)
      ? baseEffort * L * weights.brooksFactor
      : 0;

    // ── 7. Ceremonies: fixed % of idealHours (not compounded) ───────────────
    const codeReviewHours    = task.hasCodeReview    ? task.idealHours * weights.ceremonyCodeReview    : 0;
    const testingHours       = task.hasTesting       ? task.idealHours * weights.ceremonyTesting       : 0;
    const documentationHours = task.hasDocumentation ? task.idealHours * weights.ceremonyDocumentation : 0;
    const ceremoniesTotal    = codeReviewHours + testingHours + documentationHours;

    // ── 8. Scope risk applied to the subtotal of overheads (not ceremonies) ─
    const scopeFactor = (weights.useScopeFactor !== false) ? (scope.factor !== null ? scope.factor : 1.0) : 1.0;
    const preScope = baseEffort + expOverhead + debtOverhead + depOverhead + switchingOverhead + brooksOverhead;
    const scopeOverhead = preScope * (scopeFactor - 1);

    const totalEffort = preScope + scopeOverhead + ceremoniesTotal;

    // ── 9. Daily capacity (reduced by meetings) ─────────────────────────────
    const effectiveHoursPerDay = Math.max(1, hoursPerDay - task.meetingsPerDay * 0.75);
    const realDays = totalEffort / effectiveHoursPerDay;
    const withBuffer = realDays * (1 + bufferPercentage / 100);

    // ── 10. Calendar date simulation ────────────────────────────────────────
    let workdaysRemaining = withBuffer;
    let currentDate = new Date(startDate + "T00:00:00Z");
    if (isNaN(currentDate.getTime())) currentDate = new Date();

    while (workdaysRemaining > 0) {
      const dayOfWeek = currentDate.getUTCDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isHoliday = isHolidayFrontend(currentDate, estimationCountry, customHolidays);

      let isWorkingDay = true;
      if (!includeWeekends && isWeekend) isWorkingDay = false;
      if (!includeHolidays && isHoliday) isWorkingDay = false;

      if (isWorkingDay) {
        workdaysRemaining = workdaysRemaining >= 1 ? workdaysRemaining - 1 : 0;
      }
      if (workdaysRemaining > 0) {
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }
    }

    const projectedEndDate = currentDate;
    const calendarDays = Math.max(1, Math.ceil(
      (projectedEndDate.getTime() - new Date(startDate + "T00:00:00Z").getTime()) / (24 * 60 * 60 * 1000)
    ));

    // ── 11. Risk & confidence metrics ───────────────────────────────────────
    // combinedFactor = ratio of totalEffort over idealHours (how much it grew)
    const combinedFactor = totalEffort / Math.max(task.idealHours, 0.1);
    const riskLevel = combinedFactor > 3.5 ? "crítico" : combinedFactor > 2.2 ? "alto" : combinedFactor > 1.4 ? "medio" : "bajo";
    const confidence = Math.max(15, Math.min(95, Math.round(100 / combinedFactor)));

    return {
      totalEffort,
      realDays,
      withBuffer,
      calendarDays,
      projectedEndDateStr: formatDateUTC(projectedEndDate),
      combinedFactor,
      riskLevel,
      confidence,
      teamAvgExpFactor: averageExpFactor,
      breakdown: {
        base:             task.idealHours,
        uncertainty:      uncertaintyOverhead,
        teamOverhead:     expOverhead + brooksOverhead,
        debtOverhead:     debtOverhead,
        depOverhead:      depOverhead,
        switchingOverhead: switchingOverhead,
        scopeOverhead:    scopeOverhead,
        ceremonies:       ceremoniesTotal,
        // Individual ceremony breakdown
        codeReview:       codeReviewHours,
        testing:          testingHours,
        documentation:    documentationHours
      }
    };
  }, [
    weights,
    complexityLevels,
    techDebtOptions,
    dependencyOptions,
    scopeDefinitionLevels,
    teamJuniorCount,
    teamMidCount,
    teamSeniorCount,
    scopeDefinition,
    hoursPerDay,
    bufferPercentage,
    startDate,
    estimationCountry,
    customHolidays,
    includeWeekends,
    includeHolidays
  ]);

  const taskResults = useMemo(() => {
    return tasks.map((t) => ({
      task: t,
      res: calculateTask(t)
    }));
  }, [tasks, calculateTask]);

  const totals = useMemo(() => {
    const sumIdeal = tasks.reduce((sum, t) => sum + t.idealHours, 0);
    const sumAdjusted = taskResults.reduce((sum, r) => sum + r.res.totalEffort, 0);
    const sumRealDays = taskResults.reduce((sum, r) => sum + r.res.realDays, 0);
    const sumWithBuffer = taskResults.reduce((sum, r) => sum + r.res.withBuffer, 0);
    const sumCalendarDays = taskResults.reduce((sum, r) => sum + r.res.calendarDays, 0);

    const highestRisk = taskResults.reduce((highest, r) => {
      const scale: Record<string, number> = { bajo: 1, medio: 2, alto: 3, crítico: 4 };
      return scale[r.res.riskLevel] > scale[highest] ? r.res.riskLevel : highest;
    }, "bajo");

    const avgConfidence = taskResults.length > 0
      ? Math.round(taskResults.reduce((sum, r) => sum + r.res.confidence, 0) / taskResults.length)
      : 100;

    return {
      idealHours: sumIdeal,
      adjustedHours: sumAdjusted,
      realDays: sumRealDays,
      withBuffer: sumWithBuffer,
      calendarDays: sumCalendarDays,
      riskLevel: highestRisk,
      confidence: avgConfidence
    };
  }, [tasks, taskResults]);

  const handleAddTask = () => {
    setTasks((prev) => [...prev, INITIAL_TASK(prev.length)]);
    setActiveTaskIndex(tasks.length);
  };

  const handleRemoveTask = (id: number) => {
    if (tasks.length <= 1) return;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setActiveTaskIndex(0);
  };

  const handleUpdateTask = (id: number, field: keyof TaskInput, value: string | number | boolean) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  };

  const handleExportCSV = () => {
    const headers = [
      "Tarea",
      "Horas Ideales",
      "Complejidad",
      "Deuda Tecnica",
      "Factor Crecimiento",
      "Horas Ajustadas",
      "Dias Reales",
      "Dias con Buffer",
      "Riesgo",
      "Confianza (%)",
      "Notas"
    ];

    const rows = taskResults.map((tr) => [
      `"${tr.task.name}"`,
      tr.task.idealHours,
      tr.task.complexity,
      tr.task.techDebt,
      tr.res.combinedFactor.toFixed(2),
      tr.res.totalEffort.toFixed(1),
      tr.res.realDays.toFixed(1),
      tr.res.withBuffer.toFixed(1),
      tr.res.riskLevel,
      tr.res.confidence,
      `"${tr.task.notes.replace(/"/g, '""')}"`
    ]);

    rows.push([]);
    rows.push(["Resumen Total"]);
    rows.push(["Horas Ideales", totals.idealHours]);
    rows.push(["Horas Ajustadas", totals.adjustedHours.toFixed(1)]);
    rows.push(["Dias Reales", totals.realDays.toFixed(1)]);
    rows.push(["Dias con Buffer", totals.withBuffer.toFixed(1)]);
    rows.push(["Dias Calendario", totals.calendarDays]);
    rows.push(["Nivel de Riesgo", totals.riskLevel]);
    rows.push(["Confianza Promedio", `${totals.confidence}%`]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    
    const selectedProject = projects.find((p) => p.id === selectedProjectId);
    const projName = selectedProject ? selectedProject.name : "Estimacion";
    const ctxName = estimationContext.trim() ? `-${estimationContext.trim()}` : "";
    link.download = `U-Factor-${projName}${ctxName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    const selectedProject = projects.find((p) => p.id === selectedProjectId);
    if (!selectedProject && !estimationContext.trim()) {
      onError("Debes seleccionar un proyecto vinculado o ingresar un contexto/sprint para guardar.");
      return;
    }

    setSaving(true);
    try {
      const finalProjectName = selectedProject 
        ? (estimationContext.trim() ? `${selectedProject.name} (${estimationContext.trim()})` : selectedProject.name)
        : estimationContext.trim();

      await createEstimation({
        projectId: selectedProjectId || null,
        projectName: finalProjectName,
        totalIdealHours: totals.idealHours,
        totalAdjustedHours: totals.adjustedHours,
        bufferPercentage: bufferPercentage,
        riskLevel: totals.riskLevel,
        confidenceLevel: totals.confidence,
        rawDataJson: JSON.stringify({
          tasks,
          hoursPerDay,
          sprintDays,
          bufferPercentage,
          includeWeekends,
          totals,
          estimationContext,
          selectedProjectId,
          // Phase 3 & 4 States:
          teamSeniorCount,
          teamMidCount,
          teamJuniorCount,
          includeHolidays,
          scopeDefinition,
          startDate,
          estimationCountry,
          weights
        })
      });
      await loadEstimations();
      showSuccess("¡Estimación guardada con éxito!");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al guardar la estimación");
    } finally {
      setSaving(false);
    }
  };

  const showSuccess = (msg: string) => {
    setSuccessBanner(msg);
    setTimeout(() => setSuccessBanner(null), 4000);
  };

  const executeDelete = async () => {
    if (!deleteTargetId) return;
    try {
      await deleteEstimation(deleteTargetId);
      await loadEstimations();
      showSuccess("Estimación eliminada correctamente.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al eliminar estimación");
    } finally {
      setDeleteTargetId(null);
    }
  };

  const loadSavedData = (est: Estimation) => {
    try {
      const raw = JSON.parse(est.rawDataJson);
      if (raw.tasks) setTasks(raw.tasks);
      if (raw.hoursPerDay) setHoursPerDay(raw.hoursPerDay);
      if (raw.sprintDays) setSprintDays(raw.sprintDays);
      if (raw.bufferPercentage) setBufferPercentage(raw.bufferPercentage);
      if (raw.includeWeekends !== undefined) setIncludeWeekends(raw.includeWeekends);
      
      if (raw.estimationContext) setEstimationContext(raw.estimationContext);
      else setEstimationContext(est.projectName || "");
      
      if (raw.selectedProjectId) setSelectedProjectId(raw.selectedProjectId);
      else if (est.projectId) setSelectedProjectId(est.projectId);
      
      // Phase 3 & 4 States
      if (raw.teamSeniorCount !== undefined) setTeamSeniorCount(raw.teamSeniorCount);
      else if (raw.teamSize !== undefined) setTeamSeniorCount(raw.teamSize); // Fallback
      if (raw.teamMidCount !== undefined) setTeamMidCount(raw.teamMidCount);
      if (raw.teamJuniorCount !== undefined) setTeamJuniorCount(raw.teamJuniorCount);
      if (raw.includeHolidays !== undefined) setIncludeHolidays(raw.includeHolidays);
      if (raw.scopeDefinition !== undefined) setScopeDefinition(raw.scopeDefinition);
      if (raw.startDate !== undefined) setStartDate(raw.startDate);
      if (raw.estimationCountry !== undefined) setEstimationCountry(raw.estimationCountry);
      if (raw.weights !== undefined) setWeights({ ...DEFAULT_WEIGHTS, ...raw.weights });

      showSuccess("Estimación cargada correctamente.");
    } catch {
      onError("No se pudo cargar la data cruda de la estimación.");
    }
  };

  // Calibration weight handlers
  const handleSaveWeights = (newWeights: EstimationWeights) => {
    setWeights(newWeights);
    localStorage.setItem("synaptica_estimation_weights", JSON.stringify(newWeights));
    showSuccess("Factores de calibración guardados y aplicados.");
  };

  const handleResetWeights = () => {
    setWeights(DEFAULT_WEIGHTS);
    localStorage.setItem("synaptica_estimation_weights", JSON.stringify(DEFAULT_WEIGHTS));
    showSuccess("Calibración restaurada a valores predeterminados.");
  };

  const activeTask = tasks[activeTaskIndex] || null;

  return (
    <div className={showTooltips ? "" : "hide-tooltips"} style={{ display: "flex", flexDirection: "column", gap: "2.5rem", padding: "1rem 2rem" }}>
      
      <PageHeader
        icon="⚖"
        title="Calculadora de Estimaciones"
        description="Herramienta interactiva para estimar el esfuerzo, horas y costos de desarrollo por tareas utilizando el método PERT calibrado por U-Factor."
        actions={
          <>
            <button type="button" onClick={handleToggleTooltips} className="ghost" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem", borderRadius: "8px", borderColor: "var(--border-color)", color: "var(--text-soft)" }}>
              {showTooltips ? "ℹ️ Ocultar Tooltips" : "ℹ️ Mostrar Tooltips"}
            </button>
            <button type="button" onClick={() => setShowEducation((v) => !v)} className="ghost" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem", borderRadius: "8px", borderColor: "var(--tint-purple-border)", color: "var(--tint-purple-text)" }}>
              {showEducation ? "🎓 Ocultar Guía Educativa" : "🎓 Mostrar Guía Educativa"}
            </button>
            <button type="button" onClick={handleExportCSV} className="ghost" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem", borderRadius: "8px", borderColor: "var(--border-color)", color: "var(--state-warning-text)" }}>
              ⬇ Exportar CSV
            </button>
            {canWrite && (
              <button type="button" onClick={handleSave} disabled={saving} style={{ fontSize: "0.85rem", padding: "0.5rem 1.25rem", borderRadius: "8px", border: "none", background: "var(--gradient-accent)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {saving ? "Guardando..." : "💾 Guardar Estimación"}
              </button>
            )}
          </>
        }
      />

      {successBanner && (
        <div style={{ padding: "0.75rem 1rem", background: "var(--state-success-bg)", border: "1px solid var(--state-success-border)", color: "var(--state-success-text)", borderRadius: "10px", fontWeight: 600, fontSize: "0.9rem" }}>
          ✓ {successBanner}
        </div>
      )}

      {/* Main Tab selectors for Estimator / Weights Calibrator */}
      <div style={{ display: "flex", gap: "0.5rem", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.5rem", marginBottom: "-1rem" }}>
        <button
          type="button"
          onClick={() => setActiveMainTab("estimator")}
          style={{
            padding: "0.6rem 1.25rem",
            borderRadius: "8px 8px 0 0",
            border: "none",
            background: activeMainTab === "estimator" ? "rgba(241, 163, 35, 0.08)" : "transparent",
            color: activeMainTab === "estimator" ? "#d97706" : "var(--text-soft)",
            fontWeight: 700,
            cursor: "pointer",
            borderBottom: activeMainTab === "estimator" ? "3px solid #f1a323" : "none",
            transition: "all 0.2s"
          }}
        >
          📊 Estimador de Proyecto
        </button>
        <button
          type="button"
          onClick={() => setActiveMainTab("weights")}
          style={{
            padding: "0.6rem 1.25rem",
            borderRadius: "8px 8px 0 0",
            border: "none",
            background: activeMainTab === "weights" ? "rgba(241, 163, 35, 0.08)" : "transparent",
            color: activeMainTab === "weights" ? "#d97706" : "var(--text-soft)",
            fontWeight: 700,
            cursor: "pointer",
            borderBottom: activeMainTab === "weights" ? "3px solid #f1a323" : "none",
            transition: "all 0.2s"
          }}
        >
          ⚙️ Configuración de Pesos (Factores)
        </button>
      </div>

      {activeMainTab === "estimator" ? (
        <div className="fade-in-tab" style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
          {/* Educational Guide Drawer */}
          {showEducation && (
            <div style={{
              background: "rgba(241, 163, 35, 0.02)",
              border: "1px solid var(--border-color)",
              borderRadius: "14px",
              padding: "1.5rem"
            }}>
              {/* Tab Selector */}
              <div style={{ display: "flex", gap: "0.25rem", borderBottom: "1px solid var(--color-primary-10)", paddingBottom: "0", marginBottom: "1.25rem" }}>
                {(["concepts", "example", "factors"] as const).map((tab) => {
                  const labels: Record<string, string> = { concepts: "📖 Conceptos Clave", example: "🔢 Ejemplo Real", factors: "⚖️ Tabla de Factores" };
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setGuideTab(tab)}
                      style={{
                        padding: "0.4rem 0.9rem",
                        border: "none",
                        borderBottom: guideTab === tab ? "3px solid #f1a323" : "3px solid transparent",
                        background: "transparent",
                        color: guideTab === tab ? "#d97706" : "var(--text-soft)",
                        fontWeight: guideTab === tab ? 700 : 500,
                        fontSize: "0.82rem",
                        cursor: "pointer",
                        transition: "all 0.15s",
                        marginBottom: "-2px"
                      }}
                    >
                      {labels[tab]}
                    </button>
                  );
                })}
              </div>

              {guideTab === "concepts" ? (
                <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "1.5rem", alignItems: "start" }} className="responsive-grid">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0.85rem" }}>
                    {[
                      {
                        icon: "🧠", title: "Método U-Factor",
                        color: "var(--tint-purple-text)", bg: "var(--tint-purple-bg)", border: "var(--tint-purple-border)",
                        body: "Convierte tus horas ideales (optimistas) en horas reales añadiendo capas de overhead controladas. Cada factor es aditivo — no se multiplican entre sí.",
                        tip: "Piensa en las horas ideales como el mejor caso posible. El U-Factor estima cuánto crecerá en el mundo real."
                      },
                      {
                        icon: "🔬", title: "Complejidad (U-Factor)",
                        color: "var(--state-warning-text)", bg: "var(--state-warning-bg)", border: "var(--state-warning-border)",
                        body: `El factor base de incertidumbre. Rutinaria (×${weights.compRoutine}): trabajo conocido. Incógnitas (×${weights.compKnownUnknowns}): dependencias externas. Inexplorado (×${weights.compUnknownUnknowns}): tecnología nueva o sin documentar.`,
                        tip: "Sé conservador: un CRUD con un API externa que no conoces es 'Incógnitas', no 'Rutinaria'."
                      },
                      {
                        icon: "👥", title: "Composición del Equipo",
                        color: "var(--tint-orange-text)", bg: "var(--tint-orange-bg)", border: "var(--tint-orange-border)",
                        body: `El factor promedio ponderado del equipo se calcula automáticamente. Senior (×${weights.expSenior}) = línea base. Mid (×${weights.expMid}) = +${Math.round((weights.expMid-1)*100)}% overhead. Junior (×${weights.expJunior}) = +${Math.round((weights.expJunior-1)*100)}% overhead.`,
                        tip: "Un equipo 1SR + 1MID + 1JR tiene factor promedio ×" + (((weights.expSenior + weights.expMid + weights.expJunior) / 3).toFixed(2)) + ". Añade juniors con cuidado."
                      },
                      {
                        icon: "💬", title: "Ley de Brooks",
                        color: "var(--tint-cyan-text)", bg: "var(--tint-cyan-bg)", border: "var(--tint-cyan-border)",
                        body: `Cada persona que se une crea nuevos canales de comunicación: L = n(n-1)/2. Con ${totalDevs} personas hay ${totalChannels} canales, añadiendo +${Math.round(totalChannels * weights.brooksFactor * 100)}% overhead sobre el esfuerzo base.`,
                        tip: "Agregar un dev tarde en un proyecto retrasado lo retrasa más. Planifica el equipo desde el inicio."
                      },
                      {
                        icon: "⚠️", title: "Deuda Técnica",
                        color: "var(--tint-purple-text)", bg: "var(--tint-purple-bg)", border: "var(--tint-purple-border)",
                        body: `Estado del código base. Limpio (×${weights.debtClean}): fácil de modificar. Moderado (×${weights.debtModerate}): algunos obstáculos. Pesado (×${weights.debtHeavy}): sin tests, alto acoplamiento. Legacy (×${weights.debtLegacy}): sin documentación, miedo a cambiar.`,
                        tip: "La deuda técnica es el multiplicador silencioso más subestimado por los PMs."
                      },
                      {
                        icon: "🛡️", title: "Ceremonias Ágiles",
                        color: "var(--state-info-text)", bg: "var(--state-info-bg)", border: "var(--state-info-border)",
                        body: `Overhead fijo sobre las horas ideales. Code Review: +${Math.round(weights.ceremonyCodeReview*100)}%. Testing/QA: +${Math.round(weights.ceremonyTesting*100)}%. Documentación: +${Math.round(weights.ceremonyDocumentation*100)}%. Son horas reales que se gastan aunque no se programen explícitamente.`,
                        tip: "Nunca omitas testing en la estimación — el cliente siempre lo va a pedir al final de todos modos."
                      },
                      {
                        icon: "📐", title: "Riesgo de Alcance",
                        color: "var(--state-danger-text)", bg: "var(--state-danger-bg)", border: "var(--state-danger-border)",
                        body: `Qué tan definidos están los requisitos. Cerrado (×${weights.scopeClosed}): documentado y firmado. Pendientes (×${weights.scopePending}): detalles por confirmar. Difuso (×${weights.scopeDiffuse}): el cliente sabe qué quiere pero no el cómo. Sin cierre (×${weights.scopeNoTechnicalClosure}): alcance cambia semanalmente.`,
                        tip: "Sin cierre técnico el proyecto es potencialmente infinito. Escala esto al PM inmediatamente."
                      },
                      {
                        icon: "🔄", title: "Context Switching",
                        color: "var(--tint-pink-text)", bg: "var(--tint-pink-bg)", border: "var(--tint-pink-border)",
                        body: `Cuando el dev trabaja en múltiples tareas a la vez pierde tiempo en cambiar de contexto mental. Actívalo si el dev está asignado a más de 2 proyectos o tiene reuniones constantes. Overhead: +${Math.round((weights.contextSwitchingPenalty-1)*100)}% sobre el esfuerzo base.`,
                        tip: "Un dev interrumpido cada hora tarda hasta 23 min en recuperar el foco profundo."
                      }
                    ].map((card) => (
                      <div key={card.title} style={{
                        background: card.bg,
                        border: `1px solid ${card.border}`,
                        borderRadius: "10px",
                        padding: "0.85rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.4rem"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <span style={{ fontSize: "1rem" }}>{card.icon}</span>
                          <strong style={{ fontSize: "0.8rem", color: card.color }}>{card.title}</strong>
                        </div>
                        <p style={{ margin: 0, fontSize: "0.73rem", color: "var(--text)", lineHeight: 1.45 }}>{card.body}</p>
                        <div style={{ background: "rgba(0,0,0,0.04)", borderRadius: "6px", padding: "0.35rem 0.5rem", fontSize: "0.68rem", color: card.color, fontStyle: "italic", display: "flex", alignItems: "flex-start", gap: "0.3rem" }}>
                          <span>💡</span> <span>{card.tip}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Interactive SVG */}
                  <div style={{ background: "var(--card-bg)", padding: "1rem", borderRadius: "12px", border: "1px solid var(--border-color)", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{ textAlign: "center" }}>
                      <h5 style={{ margin: "0 0 0.2rem 0", color: "var(--text-strong)", fontSize: "0.82rem", fontWeight: 700 }}>Red de Canales (Brooks' Law)</h5>
                      <p style={{ margin: 0, fontSize: "0.68rem", color: "var(--text-soft)" }}>{totalDevs} devs → {totalChannels} canales de comunicación</p>
                    </div>
                    <div style={{ width: "210px", height: "210px", background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {totalDevs <= 1 ? (
                        <span style={{ fontSize: "0.72rem", color: "var(--text-soft)", fontStyle: "italic", textAlign: "center", padding: "0 1rem" }}>Agrega más devs en los parámetros para ver los canales</span>
                      ) : (
                        <svg width="200" height="200" viewBox="0 0 210 210" style={{ display: "block" }}>
                          {lines.map((line, idx) => (<line key={idx} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="var(--color-accent-20)" strokeWidth="1" strokeOpacity="0.75" />))}
                          {nodes.map((node, idx) => (
                            <g key={idx}>
                              <circle cx={node.x} cy={node.y} r={totalDevs > 10 ? "6" : "8"} fill={node.color} stroke="#fff" strokeWidth="1.5" style={{ filter: "drop-shadow(0px 2px 4px rgba(0,0,0,0.1))" }} />
                              <text x={node.x} y={node.y + 2.5} fill="#fff" fontSize={totalDevs > 10 ? "5px" : "6px"} fontWeight="bold" textAnchor="middle">{node.label}</text>
                            </g>
                          ))}
                        </svg>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.68rem", color: "var(--text-soft)" }}>
                      {[["#22c55e", "Senior"], ["#eab308", "Mid"], ["#ef4444", "Junior"]].map(([c, l]) => (
                        <span key={l} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                          <span style={{ width: "8px", height: "8px", background: c, borderRadius: "50%", flexShrink: 0 }} /> {l}
                        </span>
                      ))}
                    </div>
                    {totalChannels > 0 && (
                      <div style={{ background: "var(--color-accent-05)", border: "1px solid var(--border-color)", borderRadius: "8px", padding: "0.5rem 0.75rem", fontSize: "0.72rem", color: "var(--tint-orange-text)", textAlign: "center", lineHeight: 1.4 }}>
                        <strong>{totalChannels} canales</strong> × {(weights.brooksFactor * 100).toFixed(0)}% = <strong>+{Math.round(totalChannels * weights.brooksFactor * 100)}%</strong> overhead de coordinación
                      </div>
                    )}
                  </div>
                </div>
              ) : guideTab === "example" ? (
                /* Worked example tab */
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }} className="responsive-grid">
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    <div style={{ background: "var(--state-info-bg)", border: "1px solid var(--state-info-border)", borderRadius: "10px", padding: "1rem" }}>
                      <h4 style={{ margin: "0 0 0.75rem 0", color: "var(--state-info-text)", fontSize: "0.9rem", fontWeight: 700 }}>📋 Escenario de ejemplo</h4>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "0.78rem", color: "var(--text)" }}>
                        {[
                          ["Tarea", "Integración pasarela de pagos PSE"],
                          ["Horas ideales", "8h (estimado optimista)"],
                          ["Complejidad", `Incógnitas Conocidas (×${weights.compKnownUnknowns})`],
                          ["Equipo", "1 Senior + 1 Mid"],
                          ["Deuda técnica", "Código limpio"],
                          ["Dependencias", `API externa (×${weights.depExternal})`],
                          ["Ceremonias", "Code Review + Testing"],
                          ["Alcance", "Cerrado y acotado"],
                        ].map(([k, v]) => (
                          <div key={k} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.25rem" }}>
                            <span style={{ color: "var(--text-soft)" }}>{k}:</span>
                            <strong style={{ textAlign: "right", maxWidth: "60%" }}>{v}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <h4 style={{ margin: "0 0 0.25rem 0", color: "var(--color-accent)", fontSize: "0.9rem", fontWeight: 700 }}>🧮 Cálculo paso a paso</h4>
                    {(() => {
                      const ideal = 8;
                      const base = ideal * weights.compKnownUnknowns;
                      const unc = base - ideal;
                      const avgExp = (weights.expSenior + weights.expMid) / 2;
                      const expOv = base * (avgExp - 1);
                      const depOv = base * (weights.depExternal - 1);
                      const brooks = base * 1 * weights.brooksFactor; // L=1 for 2 devs
                      const ceremonies = ideal * weights.ceremonyCodeReview + ideal * weights.ceremonyTesting;
                      const total = base + expOv + depOv + brooks + ceremonies;
                      const steps = [
                        { label: "🏗 Base (8h × complejidad)",        value: base,     color: "#15803d" },
                        { label: `🔬 Incertidumbre (×${weights.compKnownUnknowns} - 1)`, value: unc, color: "var(--color-accent)" },
                        { label: `👥 Overhead equipo (factor ×${avgExp.toFixed(2)})`, value: expOv, color: "#c2410c" },
                        { label: `🔗 Dep. externa (+${Math.round((weights.depExternal-1)*100)}%)`, value: depOv, color: "#0e7490" },
                        { label: `💬 Brooks (1 canal × ${(weights.brooksFactor*100).toFixed(0)}%)`, value: brooks, color: "#6d28d9" },
                        { label: `👁 Code Review (+${Math.round(weights.ceremonyCodeReview*100)}%)`, value: ideal*weights.ceremonyCodeReview, color: "#1d4ed8" },
                        { label: `🧪 Testing (+${Math.round(weights.ceremonyTesting*100)}%)`, value: ideal*weights.ceremonyTesting, color: "#1d4ed8" },
                      ];
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                          {steps.map((s, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.3rem 0.5rem", background: i === 0 ? "var(--state-success-bg)" : "var(--state-warning-bg)", borderRadius: "6px", border: `1px solid ${i === 0 ? "var(--state-success-border)" : "var(--state-warning-border)"}`, fontSize: "0.75rem" }}>
                              <span style={{ color: "var(--text-soft)" }}>{s.label}</span>
                              <strong style={{ color: s.color }}>{i === 0 ? "" : "+"}{s.value.toFixed(1)}h</strong>
                            </div>
                          ))}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem", background: "rgba(241, 163, 35, 0.04)", borderRadius: "6px", border: "2px solid #f1a323", fontSize: "0.82rem", fontWeight: 700, marginTop: "0.25rem" }}>
                            <span style={{ color: "var(--state-warning-text)" }}>⏱ Total real estimado:</span>
                            <span style={{ color: "var(--state-warning-text)", fontSize: "1rem" }}>{total.toFixed(1)}h</span>
                          </div>
                          <div style={{ fontSize: "0.7rem", color: "var(--text-soft)", textAlign: "center", fontStyle: "italic" }}>
                            8h de código → {total.toFixed(1)}h de trabajo real (×{(total/8).toFixed(2)} factor de crecimiento)
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                /* Factors table */
                <div style={{ overflowX: "auto", fontSize: "0.76rem" }}>
                  <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.78rem", color: "var(--text)", background: "var(--color-accent-05)", borderRadius: "8px", padding: "0.6rem 0.75rem", border: "1px solid var(--border-color)" }}>
                    💡 Estos factores son <strong>configurables</strong> en la pestaña <strong>⚙️ Configuración de Pesos</strong>. Ajústalos según la realidad histórica de tu equipo.
                  </p>
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                    <thead>
                      <tr style={{ background: "var(--state-warning-bg)", color: "var(--text-strong)" }}>
                        <th style={{ padding: "0.5rem 0.6rem", borderRadius: "8px 0 0 0", fontWeight: 700, fontSize: "0.78rem" }}>Categoría</th>
                        <th style={{ padding: "0.5rem 0.6rem", fontWeight: 700, fontSize: "0.78rem" }}>Nivel / Tipo</th>
                        <th style={{ padding: "0.5rem 0.6rem", fontWeight: 700, fontSize: "0.78rem" }}>Factor / Overhead</th>
                        <th style={{ padding: "0.5rem 0.6rem", borderRadius: "0 8px 0 0", fontWeight: 700, fontSize: "0.78rem" }}>Cuándo usarlo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["🔬 Complejidad", "Rutinaria", `×${weights.compRoutine}`, "CRUD estándar, UI conocida"],
                        ["", "Incógnitas Conocidas", `×${weights.compKnownUnknowns}`, "APIs externas, refactoring"],
                        ["", "Territorio Inexplorado", `×${weights.compUnknownUnknowns}`, "Tech nueva, sin documentar"],
                        ["👥 Seniority", "Senior (baseline)", `×${weights.expSenior}`, "Referencia sin overhead"],
                        ["", "Mid-Level", `×${weights.expMid}`, "+${Math.round((weights.expMid-1)*100)}% vs senior"],
                        ["", "Junior", `×${weights.expJunior}`, "+${Math.round((weights.expJunior-1)*100)}% vs senior"],
                        ["⚠️ Deuda Técnica", "Código Limpio", `×${weights.debtClean}`, "Bien testeado, buen CI/CD"],
                        ["", "Deuda Moderada", `×${weights.debtModerate}`, "Algunos problemas de deuda"],
                        ["", "Deuda Pesada", `×${weights.debtHeavy}`, "Sin tests, alto acoplamiento"],
                        ["", "Legacy Crítico", `×${weights.debtLegacy}`, "Sin documentación, obsoleto"],
                        ["🔗 Dependencias", "Sin dependencias", `×${weights.depNone}`, "Control total del equipo"],
                        ["", "Interna (otro equipo)", `×${weights.depInternal}`, "Prioridades cruzadas"],
                        ["", "Externa (proveedor)", `×${weights.depExternal}`, "Terceros, APIs externas"],
                        ["", "Múltiples bloqueantes", `×${weights.depMultiple}`, "Varias dependencias simultáneas"],
                        ["🛡️ Ceremonias", "Code Review", `+${Math.round(weights.ceremonyCodeReview*100)}%`, "Sobre horas ideales (fijo)"],
                        ["", "Testing / QA", `+${Math.round(weights.ceremonyTesting*100)}%`, "Sobre horas ideales (fijo)"],
                        ["", "Documentación", `+${Math.round(weights.ceremonyDocumentation*100)}%`, "Sobre horas ideales (fijo)"],
                        ["📐 Alcance", "Cerrado", `×${weights.scopeClosed}`, "Requisitos firmados y estables"],
                        ["", "Pendientes menores", `×${weights.scopePending}`, "Pequeños detalles sin confirmar"],
                        ["", "Difuso / WIP", `×${weights.scopeDiffuse}`, "El cliente no sabe el cómo"],
                        ["", "Sin Cierre Técnico", `×${weights.scopeNoTechnicalClosure}`, "Alcance cambia cada semana"],
                      ].map(([cat, level, factor, when], i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? "var(--card-bg)" : "var(--state-neutral-bg)", borderBottom: "1px solid var(--border-color)" }}>
                          <td style={{ padding: "0.35rem 0.6rem", fontWeight: cat ? 700 : 400, color: cat ? "var(--tint-purple-text)" : "var(--text-soft)" }}>{cat}</td>
                          <td style={{ padding: "0.35rem 0.6rem", color: "var(--text)" }}>{level}</td>
                          <td style={{ padding: "0.35rem 0.6rem", fontWeight: 700, color: "var(--color-accent)", fontFamily: "monospace" }}>{factor}</td>
                          <td style={{ padding: "0.35rem 0.6rem", color: "var(--text-soft)", fontSize: "0.72rem", fontStyle: "italic" }}>{when}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "2.1fr 0.9fr", gap: "2rem", alignItems: "start" }} className="responsive-grid">
            
            {/* Left column: Global config & Split Workspace */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              
              {/* Global Config Card */}
              <div className="card glass-card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "var(--card-bg)", maxWidth: "1100px" }}>
                <h3 style={{ margin: "0 0 1rem 0", fontSize: "1rem", color: "var(--text-strong)", fontFamily: "var(--display)" }}>
                  ⚙ Parámetros Globales de Estimación
                </h3>
                <div className="calculator-grid">
                  
                  <div>
                    <label className="form-label">Proyecto Vinculado <InfoTooltip text="Asocia esta estimación a un proyecto existente para llevar trazabilidad." /></label>
                    <select 
                      value={selectedProjectId} 
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                      style={{ width: "100%", padding: "0.55rem", borderRadius: "6px", border: "1px solid var(--border-color)", background: "#fff" }}
                    >
                      <option value="">-- Sin Vincular / Personal --</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="form-label">
                      Nombre de Estimación
                      <InfoTooltip text="Título o descripción breve para identificar este grupo de tareas." />
                    </label>
                    <input 
                      type="text" 
                      value={estimationContext} 
                      onChange={(e) => setEstimationContext(e.target.value)} 
                      placeholder="Ej. Sprint 3 - Integración de Pagos"
                      style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border-color)", background: "#fff" }}
                    />
                  </div>

                  <div>
                    <label className="form-label">Horas Productivas Diarias <InfoTooltip text="Horas reales de programación al día, excluyendo descansos o pausas." /></label>
                    <input 
                      type="number" 
                      min={1} 
                      max={12} 
                      value={hoursPerDay} 
                      onChange={(e) => setHoursPerDay(Number(e.target.value) || 8)} 
                      style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                    />
                  </div>

                  <div>
                    <label className="form-label">Duración Sprint (Días Hábiles) <InfoTooltip text="Cuántos días laborales dura la iteración. Afecta el cálculo de fechas." /></label>
                    <input 
                      type="number" 
                      min={1} 
                      max={30} 
                      value={sprintDays} 
                      onChange={(e) => setSprintDays(Number(e.target.value) || 10)} 
                      style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                    />
                  </div>

                  <div>
                    <label className="form-label">Colchón de Imprevistos (%) <InfoTooltip text="Margen de seguridad global extra para cubrir riesgos no previstos." /></label>
                    <input 
                      type="number" 
                      min={0} 
                      max={100} 
                      value={bufferPercentage} 
                      onChange={(e) => setBufferPercentage(Number(e.target.value) || 0)} 
                      style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                    />
                  </div>

                  <div>
                    <label className="form-label">Fecha de Inicio <InfoTooltip text="Fecha en la que arranca el desarrollo." /></label>
                    <input 
                      type="date" 
                      value={startDate} 
                      onChange={(e) => setStartDate(e.target.value)} 
                      style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                    />
                  </div>

                  <div>
                    <label className="form-label">Calendario de Festivos (País) <InfoTooltip text="Define los días festivos a omitir del cálculo temporal si aplica." /></label>
                    <select 
                      value={estimationCountry} 
                      onChange={(e) => setEstimationCountry(e.target.value)}
                      style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border-color)", background: "#fff" }}
                    >
                      <option value="US">USA / Default (Federal)</option>
                      <option value="CO">Colombia 🇨🇴</option>
                      <option value="PE">Perú 🇵🇪</option>
                      <option value="CL">Chile 🇨🇱</option>
                      <option value="MX">México 🇲🇽</option>
                      <option value="EC">Ecuador 🇪🇨</option>
                    </select>
                  </div>

                  <div>
                    <label className="form-label">Riesgo de Alcance <InfoTooltip text="Evalúa qué tan cerrados y claros están los requisitos." /></label>
                    <select 
                      value={scopeDefinition} 
                      onChange={(e) => setScopeDefinition(e.target.value)}
                      style={{ width: "100%", padding: "0.55rem", borderRadius: "6px", border: "1px solid var(--border-color)", background: "#fff" }}
                    >
                      {scopeDefinitionLevels.map((s) => (
                        <option key={s.key} value={s.key}>{s.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Team Grid composition inputs */}
                  <div className="calculator-grid-span-2" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", background: "var(--color-accent-05)", padding: "0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                    <div style={{ gridColumn: "span 3", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--color-accent)" }}>
                        👥 Composición del Equipo: <InfoTooltip text="Número de programadores. Afecta el rendimiento y los canales de comunicación." />
                      </span>
                      {/* Live factor chip */}
                      {(() => {
                        const size = Math.max(1, teamSeniorCount + teamMidCount + teamJuniorCount);
                        const avg = (teamSeniorCount * weights.expSenior + teamMidCount * weights.expMid + teamJuniorCount * weights.expJunior) / size;
                        const color = avg <= 1.05 ? "#22c55e" : avg <= 1.2 ? "#eab308" : "#ef4444";
                        const label = avg <= 1.05 ? "Muy Ágil" : avg <= 1.2 ? "Ágil" : "Requiere más tiempo";
                        return (
                          <span style={{ fontSize: "0.7rem", fontWeight: 700, background: `${color}18`, color, border: `1px solid ${color}44`, borderRadius: "9999px", padding: "0.1rem 0.5rem" }}>
                            Factor Equipo: x{avg.toFixed(2)} — {label}
                          </span>
                        );
                      })()}
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, marginBottom: "0.15rem" }}>🟢 Seniors</label>
                      <input 
                        type="number" min={0} max={20}
                        value={teamSeniorCount} 
                        onChange={(e) => setTeamSeniorCount(Math.max(0, Number(e.target.value) || 0))} 
                        style={{ width: "100%", padding: "0.35rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, marginBottom: "0.15rem" }}>🟡 Mids</label>
                      <input 
                        type="number" min={0} max={20}
                        value={teamMidCount} 
                        onChange={(e) => setTeamMidCount(Math.max(0, Number(e.target.value) || 0))} 
                        style={{ width: "100%", padding: "0.35rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, marginBottom: "0.15rem" }}>🔴 Juniors</label>
                      <input 
                        type="number" min={0} max={20}
                        value={teamJuniorCount} 
                        onChange={(e) => setTeamJuniorCount(Math.max(0, Number(e.target.value) || 0))} 
                        style={{ width: "100%", padding: "0.35rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                      />
                    </div>
                  </div>

                  {/* Calendar simulation options card */}
                  <div className="calculator-grid-span-2" style={{ display: "grid", gridTemplateRows: "auto 1fr", gap: "0.75rem", background: "var(--color-accent-05)", padding: "0.75rem", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--color-accent)" }}>
                        📅 Opciones de Calendario: <InfoTooltip text="Configura si los fines de semana y festivos se consideran días laborables en la simulación temporal." />
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "0.6rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <input 
                          type="checkbox" 
                          id="includeWeekends" 
                          checked={includeWeekends} 
                          onChange={(e) => setIncludeWeekends(e.target.checked)} 
                          style={{ width: "16px", height: "16px", cursor: "pointer", flexShrink: 0 }}
                        />
                        <label htmlFor="includeWeekends" style={{ fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", margin: 0 }}>
                          Incluir Fines de Semana
                          <InfoTooltip text="Trabajar sábados y domingos (reduce la duración total del proyecto)." />
                        </label>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <input 
                          type="checkbox" 
                          id="includeHolidays" 
                          checked={includeHolidays} 
                          onChange={(e) => setIncludeHolidays(e.target.checked)} 
                          style={{ width: "16px", height: "16px", cursor: "pointer", flexShrink: 0 }}
                        />
                        <label htmlFor="includeHolidays" style={{ fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", margin: 0 }}>
                          Incluir Días Festivos (Calendario)
                          <InfoTooltip text="Considerar los festivos nacionales del país seleccionado como días laborales hábiles." />
                        </label>
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              {/* Master-Detail Task Workspace Container */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0, fontSize: "1.05rem", color: "var(--text-strong)", fontFamily: "var(--display)" }}>
                    Desglose de Tareas Estimadas ({tasks.length})
                  </h3>
                  <button 
                    type="button" 
                    onClick={handleAddTask} 
                    style={{ 
                      padding: "0.4rem 1rem", 
                      borderRadius: "8px", 
                      border: "1px solid var(--border-color)", 
                      background: "var(--color-accent-10)", 
                      color: "var(--color-accent)", 
                      fontWeight: 700, 
                      fontSize: "0.82rem",
                      cursor: "pointer" 
                    }}
                  >
                    ➕ Agregar Tarea
                  </button>
                </div>

                {/* Split Pane Work Area */}
                <div className="split-pane-wrapper" style={{ 
                  display: "flex", 
                  gap: "1rem", 
                  background: "var(--card-bg)", 
                  border: "1px solid var(--border-color)", 
                  borderRadius: "14px", 
                  padding: "1rem", 
                  backdropFilter: "blur(12px)",
                  minHeight: "580px"
                }}>
                  {/* Panel Izquierdo: Master Task list (35% width) */}
                  <div className="split-pane-master" style={{ width: "35%", display: "flex", flexDirection: "column", gap: "0.75rem", borderRight: "1px solid var(--color-primary-20)", paddingRight: "1rem" }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-soft)", borderBottom: "1px solid var(--color-primary-10)", paddingBottom: "0.25rem", display: "flex", justifyContent: "space-between" }}>
                      <span>Tareas</span>
                      <span>Horas Estimadas</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", overflowY: "auto", maxHeight: "530px", paddingRight: "0.25rem" }}>
                      {tasks.map((task, idx) => {
                        const tr = taskResults.find((r) => r.task.id === task.id)!;
                        const isActive = activeTaskIndex === idx;
                        return (
                          <div
                            key={task.id}
                            onClick={() => setActiveTaskIndex(idx)}
                            style={{
                              padding: "0.6rem 0.85rem",
                              borderRadius: "10px",
                              background: isActive ? "rgba(241, 163, 35, 0.08)" : "var(--card-bg)",
                              border: isActive ? "2px solid #f1a323" : "1px solid var(--border-color)",
                              cursor: "pointer",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              transition: "all 0.2s ease"
                            }}
                          >
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, paddingRight: "0.5rem" }}>
                              <span style={{ fontSize: "0.68rem", color: "var(--text-soft)", fontWeight: 700 }}>Tarea {idx + 1}</span>
                              <strong style={{ fontSize: "0.8rem", color: isActive ? "var(--text-strong)" : "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {task.name || "Sin nombre"}
                              </strong>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: isActive ? "#b45309" : "var(--text-soft)" }}>
                                {tr.res.totalEffort.toFixed(1)}h
                              </span>
                              {tasks.length > 1 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveTask(task.id);
                                  }}
                                  style={{
                                    border: "none",
                                    background: "none",
                                    color: "#ef4444",
                                    cursor: "pointer",
                                    fontSize: "0.9rem",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: "0.2rem",
                                    borderRadius: "50%"
                                  }}
                                  onMouseEnter={(ev) => ev.currentTarget.style.background = "rgba(239, 68, 68, 0.1)"}
                                  onMouseLeave={(ev) => ev.currentTarget.style.background = "none"}
                                  title="Eliminar tarea"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Panel Derecho: Detail Form for currently selected task (65% width) */}
                  <div className="split-pane-detail" style={{ width: "65%", display: "flex", flexDirection: "column", gap: "1rem", overflowY: "auto", maxHeight: "580px", paddingRight: "0.5rem", paddingLeft: "0.25rem" }}>
                    {activeTask ? (
                      <div key={activeTask.id} className="fade-in-detail" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--color-primary-10)", paddingBottom: "0.5rem", marginBottom: "0.25rem" }}>
                          <h4 style={{ margin: 0, fontSize: "0.92rem", color: "var(--text-strong)", fontFamily: "var(--display)" }}>
                            📝 Parámetros de Simulación de Tarea
                          </h4>
                          {(() => {
                            const size = Math.max(1, teamJuniorCount + teamMidCount + teamSeniorCount);
                            const avg = (teamSeniorCount * weights.expSenior + teamMidCount * weights.expMid + teamJuniorCount * weights.expJunior) / size;
                            const color = avg <= 1.05 ? "#22c55e" : avg <= 1.2 ? "#eab308" : "#ef4444";
                            return (
                              <span style={{ fontSize: "0.72rem", color: "var(--text-soft)" }}>
                                👥 Factor Experiencia: <strong style={{ color }}>x{avg.toFixed(2)}</strong> (Global)
                              </span>
                            );
                          })()}
                        </div>
                        <div className="task-editor-grid">
                          
                          
                          <div className="task-editor-span-2">
                            <label className="form-label">Nombre de la Tarea <InfoTooltip text="Un identificador descriptivo para esta tarea en particular." /></label>
                            <input 
                              type="text" 
                              value={activeTask.name} 
                              onChange={(e) => handleUpdateTask(activeTask.id, "name", e.target.value)} 
                              placeholder="Ej. Integración pasarela PSE"
                              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border-color)", background: "#fff" }}
                            />
                          </div>

                          <div>
                            <label className="form-label">Esfuerzo Ideal (Horas) <InfoTooltip text="Horas de programación netas en un escenario optimista perfecto." /></label>
                            <input 
                              type="number" 
                              min={0.5} 
                              step={0.5}
                              value={activeTask.idealHours} 
                              onChange={(e) => handleUpdateTask(activeTask.id, "idealHours", Number(e.target.value) || 1)} 
                              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border-color)", background: "#fff" }}
                            />
                          </div>

                          <div>
                            <label className="form-label">Complejidad (U-Factor) <InfoTooltip text="Nivel de dificultad técnica o ambigüedad intrínseca de la tarea." /></label>
                            <select 
                              value={activeTask.complexity} 
                              onChange={(e) => handleUpdateTask(activeTask.id, "complexity", e.target.value)}
                              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border-color)", background: "#fff" }}
                            >
                              {complexityLevels.map((c) => (
                                <option key={c.key} value={c.key}>{c.label}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="form-label">Deuda Técnica del Entorno <InfoTooltip text="Estado actual del código donde se inserta esta tarea (calidad, tests)." /></label>
                            <select 
                              value={activeTask.techDebt} 
                              onChange={(e) => handleUpdateTask(activeTask.id, "techDebt", e.target.value)}
                              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border-color)", background: "#fff" }}
                            >
                              {techDebtOptions.map((d) => (
                                <option key={d.key} value={d.key}>{d.label}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="form-label">Dependencias Externas <InfoTooltip text="Grado de dependencia de otros equipos, sistemas o APIs externas." /></label>
                            <select 
                              value={activeTask.dependencies} 
                              onChange={(e) => handleUpdateTask(activeTask.id, "dependencies", e.target.value)}
                              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border-color)", background: "#fff" }}
                            >
                              {dependencyOptions.map((d) => (
                                <option key={d.key} value={d.key}>{d.label}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="form-label">Reuniones al día (Promedio) <InfoTooltip text="Cantidades de interrupciones diarias que reducen el foco." /></label>
                            <select 
                              value={activeTask.meetingsPerDay} 
                              onChange={(e) => handleUpdateTask(activeTask.id, "meetingsPerDay", Number(e.target.value))}
                              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border-color)", background: "#fff" }}
                            >
                              <option value={0}>0 (Sin interrupciones)</option>
                              <option value={1}>1 (~45 min ocupados)</option>
                              <option value={2}>2 (~1.5 horas ocupadas)</option>
                              <option value={3}>3 (~2.2 horas ocupadas)</option>
                              <option value={4}>4 (~3 horas ocupadas)</option>
                            </select>
                          </div>

                          <div className="task-editor-span-2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.5rem", margin: "0.25rem 0" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                              <input 
                                type="checkbox" 
                                id={`hasCodeReview-${activeTask.id}`}
                                checked={activeTask.hasCodeReview}
                                onChange={(e) => handleUpdateTask(activeTask.id, "hasCodeReview", e.target.checked)}
                                style={{ width: "14px", height: "14px", cursor: "pointer" }}
                              />
                              <label htmlFor={`hasCodeReview-${activeTask.id}`} style={{ fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>Code Review (+{Math.round(weights.ceremonyCodeReview * 100)}%)</label>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                              <input 
                                type="checkbox" 
                                id={`hasTesting-${activeTask.id}`}
                                checked={activeTask.hasTesting}
                                onChange={(e) => handleUpdateTask(activeTask.id, "hasTesting", e.target.checked)}
                                style={{ width: "14px", height: "14px", cursor: "pointer" }}
                              />
                              <label htmlFor={`hasTesting-${activeTask.id}`} style={{ fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>Testing/QA (+{Math.round(weights.ceremonyTesting * 100)}%)</label>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                              <input 
                                type="checkbox" 
                                id={`hasDocumentation-${activeTask.id}`}
                                checked={activeTask.hasDocumentation}
                                onChange={(e) => handleUpdateTask(activeTask.id, "hasDocumentation", e.target.checked)}
                                style={{ width: "14px", height: "14px", cursor: "pointer" }}
                              />
                              <label htmlFor={`hasDocumentation-${activeTask.id}`} style={{ fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>Documentación (+{Math.round(weights.ceremonyDocumentation * 100)}%)</label>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                              <input 
                                type="checkbox" 
                                id={`contextSwitching-${activeTask.id}`}
                                checked={activeTask.contextSwitching}
                                onChange={(e) => handleUpdateTask(activeTask.id, "contextSwitching", e.target.checked)}
                                style={{ width: "14px", height: "14px", cursor: "pointer" }}
                              />
                              <label htmlFor={`contextSwitching-${activeTask.id}`} style={{ fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>Context Switching (+{Math.round((weights.contextSwitchingPenalty - 1) * 100)}%)</label>
                            </div>
                          </div>

                          <div className="task-editor-span-2">
                            <label className="form-label">Notas / Riesgos Identificados <InfoTooltip text="Observaciones o alertas importantes sobre la ejecución de esta tarea." /></label>
                            <textarea 
                              rows={2} 
                              value={activeTask.notes} 
                              onChange={(e) => handleUpdateTask(activeTask.id, "notes", e.target.value)}
                              placeholder="Ej. VPN de terceros inestable, requiere aprobación del arquitecto principal..."
                              style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border-color)", background: "#fff", resize: "vertical" }}
                            />
                          </div>

                        </div>

                        {/* Individual Task stacked horizontal bar and transparent breakdown */}
                        {(() => {
                          const tr = taskResults[activeTaskIndex];
                          if (!tr) return null;
                          const { totalEffort, breakdown, riskLevel, combinedFactor } = tr.res;
                          
                          const riskColors: Record<string, string> = { bajo: "#22c55e", medio: "#eab308", alto: "#ef4444", crítico: "#7f1d1d" };
                          const riskColor = riskColors[riskLevel] || "#22c55e";

                          // Segments for the stacked bar
                          const segments = [
                            { value: breakdown.base,             color: "#4ade80",  label: "Base" },
                            { value: breakdown.uncertainty,      color: "#fbbf24",  label: "Complejidad" },
                            { value: breakdown.teamOverhead,     color: "#f97316",  label: "Equipo" },
                            { value: breakdown.debtOverhead,     color: "#a855f7",  label: "Deuda" },
                            { value: breakdown.depOverhead,      color: "#06b6d4",  label: "Deps" },
                            { value: breakdown.switchingOverhead, color: "#ec4899", label: "Switching" },
                            { value: breakdown.scopeOverhead,    color: "#ef4444",  label: "Alcance" },
                            { value: breakdown.ceremonies,       color: "#60a5fa",  label: "Ceremonias" },
                          ].filter(s => s.value > 0.01);

                          // Named breakdown rows
                          const rows = [
                            { icon: "🏗", label: "Base ideal (sin ajustes)",        value: breakdown.base,              color: "#15803d" },
                            { icon: "🔬", label: `Incertidumbre (complejidad)`,     value: breakdown.uncertainty,       color: "var(--color-accent)" },
                            { icon: "👥", label: "Overhead de equipo (exp + Brooks)", value: breakdown.teamOverhead,    color: "#c2410c" },
                            { icon: "⚠️", label: "Deuda técnica del entorno",       value: breakdown.debtOverhead,      color: "#7c3aed" },
                            { icon: "🔗", label: "Dependencias externas",           value: breakdown.depOverhead,       color: "#0e7490" },
                            { icon: "🔄", label: "Context switching",               value: breakdown.switchingOverhead, color: "#be185d" },
                            { icon: "📐", label: "Riesgo de alcance",               value: breakdown.scopeOverhead,     color: "#b91c1c" },
                            ...(breakdown.codeReview > 0.01   ? [{ icon: "👁", label: "Code Review",        value: breakdown.codeReview,    color: "#1d4ed8" }] : []),
                            ...(breakdown.testing > 0.01      ? [{ icon: "🧪", label: "Testing / QA",       value: breakdown.testing,       color: "#1d4ed8" }] : []),
                            ...(breakdown.documentation > 0.01 ? [{ icon: "📄", label: "Documentación",     value: breakdown.documentation, color: "#1d4ed8" }] : []),
                          ].filter(r => r.value > 0.01);

                          return (
                            <div style={{ marginTop: "0.5rem", padding: "1rem", background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: "10px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.82rem", fontWeight: 700, color: "var(--color-accent)", marginBottom: "0.75rem" }}>
                                <span>📊 Desglose Completo de Esfuerzo:</span>
                                <span>Crecimiento: <strong style={{ color: riskColor }}>x{combinedFactor.toFixed(2)}</strong> — Riesgo: <strong style={{ color: riskColor, textTransform: "uppercase" }}>{riskLevel}</strong></span>
                              </div>
                              
                              {/* Stacked effort bar */}
                              <div style={{ display: "flex", height: "14px", borderRadius: "7px", overflow: "hidden", border: "1px solid var(--border-color)", background: "var(--state-neutral-bg)", marginBottom: "0.75rem" }}>
                                {segments.map((s, i) => (
                                  <div
                                    key={i}
                                    style={{ width: `${(s.value / totalEffort) * 100}%`, background: s.color, height: "100%", transition: "width 0.3s ease" }}
                                    title={`${s.label}: ${s.value.toFixed(1)}h (${Math.round((s.value / totalEffort) * 100)}%)`}
                                  />
                                ))}
                              </div>

                              {/* Named breakdown rows */}
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                                {rows.map((row, i) => (
                                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.73rem", padding: "0.2rem 0", borderBottom: i < rows.length - 1 ? "1px solid var(--border-color)" : "none" }}>
                                    <span style={{ color: "var(--text-soft)", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                                      <span>{row.icon}</span> {row.label}
                                    </span>
                                    <span style={{ fontWeight: 700, color: row.value < 0.01 ? "var(--text-soft)" : row.color, minWidth: "70px", textAlign: "right" }}>
                                      {i === 0 ? "" : "+"}{row.value.toFixed(1)}h
                                      <span style={{ fontWeight: 400, color: "var(--text-soft)", marginLeft: "0.3rem" }}>
                                        ({Math.round((row.value / totalEffort) * 100)}%)
                                      </span>
                                    </span>
                                  </div>
                                ))}
                              </div>

                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.6rem", paddingTop: "0.5rem", borderTop: "2px solid var(--color-primary-20)", fontSize: "0.82rem", fontWeight: 700, color: "var(--color-accent)" }}>
                                <span>⏱ Esfuerzo Real Total:</span>
                                <span style={{ fontSize: "1rem" }}>{totalEffort.toFixed(1)}h</span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-soft)", padding: "2rem", textAlign: "center" }}>
                        <span style={{ fontSize: "2rem" }}>📋</span>
                        <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.9rem" }}>No hay tareas agregadas en esta estimación.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right column: Consolidation, Metrics & Saved Estimations */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              
              {/* Resumen Total Card */}
              <div className="card" style={{ padding: "1.75rem", borderRadius: "14px", border: "2px solid #f1a323", background: "rgba(241, 163, 35, 0.02)", boxShadow: "0 4px 20px rgba(241, 163, 35, 0.05)" }}>
                <h3 style={{ margin: "0 0 1.25rem 0", color: "var(--text-strong)", fontFamily: "var(--display)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  📊 Consolidado del Proyecto
                </h3>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div className="summary-row">
                    <span style={{ color: "var(--text-soft)", display: "flex", alignItems: "center" }}>Horas Ideales Estimadas <InfoTooltip text="Suma del esfuerzo neto optimista (sin imprevistos, reuniones ni deuda técnica)." />:</span>
                    <strong style={{ fontSize: "1.1rem" }}>{totals.idealHours}h</strong>
                  </div>

                  <div className="summary-row">
                    <span style={{ color: "var(--text-soft)", display: "flex", alignItems: "center" }}>Esfuerzo Real Calculado <InfoTooltip text="Horas reales necesarias incluyendo el U-Factor, ceremonias, deuda y comunicación." />:</span>
                    <strong style={{ fontSize: "1.1rem", color: "var(--color-accent)" }}>{totals.adjustedHours.toFixed(1)}h</strong>
                  </div>

                  <div className="summary-row">
                    <span style={{ color: "var(--text-soft)", display: "flex", alignItems: "center" }}>Días Hábiles con Buffer <InfoTooltip text="Duración en días laborables de esfuerzo incluyendo el colchón de imprevistos." />:</span>
                    <strong style={{ fontSize: "1.3rem", color: "var(--color-accent)" }}>{totals.withBuffer.toFixed(1)} días</strong>
                  </div>

                  <div className="summary-row">
                    <span style={{ color: "var(--text-soft)", display: "flex", alignItems: "center" }}>Días Calendario Aproximados <InfoTooltip text="Estimación del tiempo de entrega incluyendo fines de semana y festivos." />:</span>
                    <strong style={{ fontSize: "1.1rem" }}>~{totals.calendarDays} días</strong>
                  </div>

                  <div className="summary-row">
                    <span style={{ color: "var(--text-soft)", display: "flex", alignItems: "center" }}>Confianza de la Estimación <InfoTooltip text="Nivel de certeza basado en la proporción de horas base vs overhead añadido." />:</span>
                    <strong style={{ color: totals.confidence > 60 ? "#22c55e" : totals.confidence > 35 ? "#eab308" : "#ef4444", fontSize: "1.1rem" }}>{totals.confidence}%</strong>
                  </div>

                  <div className="summary-row" style={{ borderBottom: "none" }}>
                    <span style={{ color: "var(--text-soft)", display: "flex", alignItems: "center" }}>Nivel de Riesgo del Proyecto <InfoTooltip text="Clasificación general de riesgo técnico y de alcance para reportar." />:</span>
                    <span style={{ padding: "0.2rem 0.6rem", borderRadius: "9999px", background: totals.riskLevel === "crítico" || totals.riskLevel === "alto" ? "var(--state-danger-bg)" : "var(--state-success-bg)", color: totals.riskLevel === "crítico" || totals.riskLevel === "alto" ? "var(--state-danger-text)" : "var(--state-success-text)", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase" }}>
                      {totals.riskLevel}
                    </span>
                  </div>
                </div>

                <div style={{ background: "var(--color-accent-10)", border: "1px dashed var(--color-accent)", borderRadius: "8px", padding: "1rem", marginTop: "1rem", fontSize: "0.85rem", color: "var(--text)", lineHeight: "140%" }}>
                  💡 <strong>Recomendación Comercial:</strong> Al negociar o armar la propuesta, comunica un rango de <strong>{totals.realDays.toFixed(0)} a {totals.withBuffer.toFixed(0)} días hábiles</strong>. Nunca des una sola cifra rígida.
                </div>

                {/* Warning PM banners based on Scope Definition */}
                {scopeDefinition === "diffuse" && (
                  <div style={{
                    marginTop: "1rem",
                    padding: "0.75rem 1rem",
                    background: "var(--state-warning-bg)",
                    border: "1px solid var(--state-warning-border)",
                    color: "var(--state-warning-text)",
                    borderRadius: "8px",
                    fontSize: "0.82rem",
                    lineHeight: "1.4"
                  }}>
                    ⚠️ <strong>Aviso del PM:</strong> El alcance de este proyecto está catalogado como <strong>Difuso (WIP)</strong>. Se aconseja incorporar un colchón de imprevistos más amplio y solicitar definiciones clave al cliente.
                  </div>
                )}
                {scopeDefinition === "no_closure" && (
                  <div style={{
                    marginTop: "1rem",
                    padding: "0.75rem 1rem",
                    background: "var(--state-danger-bg)",
                    border: "1px solid var(--state-danger-border)",
                    color: "var(--state-danger-text)",
                    borderRadius: "8px",
                    fontSize: "0.82rem",
                    lineHeight: "1.4"
                  }}>
                    🚨 <strong>Alerta Crítica del PM:</strong> El proyecto no cuenta con <strong>Cierre Técnico</strong>. Se recomienda alertar al PM inmediatamente para negociar un cierre técnico, dar tiempo al cliente para organizarse o congelar avances.
                  </div>
                )}

                {/* Comparación visual de Ideal vs Ajustada */}
                <div style={{ marginTop: "1.25rem", paddingTop: "1.25rem", borderTop: "1px solid var(--border-color)" }}>
                  <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.85rem", color: "var(--text-strong)", fontWeight: 700 }}>
                    Comparación: Ideal vs. Realidad Calculada
                  </h4>
                  <div style={{ display: "flex", height: "24px", background: "var(--state-neutral-bg)", borderRadius: "6px", overflow: "hidden", margin: "0.5rem 0" }}>
                    <div style={{
                      width: `${Math.max(15, Math.min(85, (totals.idealHours / Math.max(totals.adjustedHours, 1)) * 100))}%`,
                      background: "#234175",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.72rem",
                      fontWeight: "bold",
                      transition: "width 0.3s ease"
                    }}>
                      {totals.idealHours}h Ideal
                    </div>
                    <div style={{
                      flexGrow: 1,
                      background: "#f1a323",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.72rem",
                      fontWeight: "bold",
                      transition: "width 0.3s ease"
                    }}>
                      {totals.adjustedHours.toFixed(1)}h Real
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.76rem", color: "var(--text-soft)", lineHeight: 1.4, display: "flex", alignItems: "flex-start", gap: "0.3rem" }}>
                    <span>💡</span>
                    <span>
                      {totals.adjustedHours > totals.idealHours * 2.5 ? (
                        <>Tu estimación ideal subestima el esfuerzo real en un <strong>{Math.round(((totals.adjustedHours - totals.idealHours) / totals.idealHours) * 100)}%</strong>. Comunica esto al negocio con datos.</>
                      ) : totals.adjustedHours > totals.idealHours * 1.5 ? (
                        <>Hay un recargo del <strong>{Math.round(((totals.adjustedHours - totals.idealHours) / totals.idealHours) * 100)}%</strong> sobre el ideal debido a la complejidad y riesgos detectados.</>
                      ) : (
                        <>La diferencia es del <strong>{Math.round(((totals.adjustedHours - totals.idealHours) / totals.idealHours) * 100)}%</strong>. Tareas rutinarias con baja fricción. Buen escenario.</>
                      )}
                    </span>
                  </p>
                </div>
              </div>

              {/* Saved Estimations List */}
              <div className="card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "#fff" }}>
                <h3 style={{ margin: "0 0 1rem 0", fontSize: "1rem", color: "var(--text-strong)", fontFamily: "var(--display)" }}>
                  💾 Estimaciones Guardadas en Sistema ({estimations.length})
                </h3>
                {loadingEstimations ? (
                  <p className="loading">Cargando...</p>
                ) : estimations.length === 0 ? (
                  <p style={{ color: "var(--text-soft)", fontSize: "0.85rem", fontStyle: "italic" }}>No hay estimaciones guardadas todavía.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "300px", overflowY: "auto" }}>
                    {estimations.map((est) => (
                      <div 
                        key={est.id} 
                        style={{ 
                          padding: "0.75rem", 
                          borderRadius: "8px", 
                          border: "1px solid var(--border-color)", 
                          background: "var(--card-bg)", 
                          display: "flex", 
                          justifyContent: "space-between", 
                          alignItems: "center" 
                        }}
                      >
                        <div style={{ cursor: "pointer", flex: 1 }} onClick={() => loadSavedData(est)}>
                          <strong style={{ fontSize: "0.85rem", color: "var(--color-accent)", display: "block" }}>{est.projectName}</strong>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-soft)" }}>
                            {Number(est.totalAdjustedHours).toFixed(1)}h | Riesgo: {est.riskLevel.toUpperCase()}
                          </span>
                        </div>
                        
                        <button 
                          type="button" 
                          onClick={() => setDeleteTargetId(est.id)} 
                          style={{ color: "#ef4444", border: "none", background: "none", cursor: "pointer", fontSize: "0.9rem" }}
                          title="Eliminar estimación"
                        >
                          🗑
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

          </div>
        </div>
      ) : (
        /* Weights Config Tab */
        <div className="card glass-card fade-in-tab" style={{ padding: "1.75rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "var(--card-bg)" }}>
          <h3 style={{ margin: "0 0 1.5rem 0", color: "var(--text-strong)", fontFamily: "var(--display)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            ⚙️ Configuración y Calibración de Pesos (Factores Científicos)
          </h3>
          
          <p style={{ fontSize: "0.85rem", color: "var(--text-soft)", margin: "-0.5rem 0 1.5rem 0", lineHeight: "1.4" }}>
            Calibra los multiplicadores de la fórmula científica U-Factor de Synaptica. Estos coeficientes determinan cómo se escala el esfuerzo real de desarrollo según la complejidad del código, el seniority disponible, la deuda técnica, las dependencias y los riesgos de alcance.
          </p>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            
            {/* 1. Complejidad (U-Factor) */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--color-primary-10)", paddingBottom: "0.25rem", marginBottom: "0.75rem" }}>
                <h4 style={{ margin: 0, fontSize: "0.9rem", color: "var(--color-accent)" }}>
                  1. Complejidad del Trabajo (U-Factor base)
                </h4>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "var(--color-accent)", fontWeight: "bold", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={weights.useComplexityFactor !== false}
                    onChange={(e) => setWeights({ ...weights, useComplexityFactor: e.target.checked })}
                    style={{ cursor: "pointer" }}
                  />
                  <span>Activo</span>
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", opacity: weights.useComplexityFactor !== false ? 1 : 0.5 }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Rutinaria (Routine)</label>
                  <input
                    type="number" step="0.05" min="1.0" max="5.0"
                    disabled={weights.useComplexityFactor === false}
                    value={weights.compRoutine}
                    onChange={(e) => setWeights({ ...weights, compRoutine: Number(e.target.value) || 1.3 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Incógnitas Conocidas (Known Unknowns)</label>
                  <input
                    type="number" step="0.05" min="1.0" max="5.0"
                    disabled={weights.useComplexityFactor === false}
                    value={weights.compKnownUnknowns}
                    onChange={(e) => setWeights({ ...weights, compKnownUnknowns: Number(e.target.value) || 2.0 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Territorio Inexplorado (Unknown Unknowns)</label>
                  <input
                    type="number" step="0.05" min="1.0" max="10.0"
                    disabled={weights.useComplexityFactor === false}
                    value={weights.compUnknownUnknowns}
                    onChange={(e) => setWeights({ ...weights, compUnknownUnknowns: Number(e.target.value) || 3.5 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
              </div>
            </div>

            {/* 2. Experiencia (Seniority) */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--color-primary-10)", paddingBottom: "0.25rem", marginBottom: "0.75rem" }}>
                <h4 style={{ margin: 0, fontSize: "0.9rem", color: "var(--color-accent)" }}>
                  2. Coeficientes de Seniority / Experiencia
                </h4>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "var(--color-accent)", fontWeight: "bold", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={weights.useExperienceFactor !== false}
                    onChange={(e) => setWeights({ ...weights, useExperienceFactor: e.target.checked })}
                    style={{ cursor: "pointer" }}
                  />
                  <span>Activo</span>
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", opacity: weights.useExperienceFactor !== false ? 1 : 0.5 }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Senior (5+ años)</label>
                  <input
                    type="number" step="0.05" min="0.5" max="3.0"
                    disabled={weights.useExperienceFactor === false}
                    value={weights.expSenior}
                    onChange={(e) => setWeights({ ...weights, expSenior: Number(e.target.value) || 1.0 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Mid-Level (2-5 años)</label>
                  <input
                    type="number" step="0.05" min="0.5" max="3.0"
                    disabled={weights.useExperienceFactor === false}
                    value={weights.expMid}
                    onChange={(e) => setWeights({ ...weights, expMid: Number(e.target.value) || 1.25 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Junior (&lt;2 años)</label>
                  <input
                    type="number" step="0.05" min="0.5" max="3.0"
                    disabled={weights.useExperienceFactor === false}
                    value={weights.expJunior}
                    onChange={(e) => setWeights({ ...weights, expJunior: Number(e.target.value) || 1.6 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
              </div>
            </div>

            {/* 3. Deuda Técnica */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--color-primary-10)", paddingBottom: "0.25rem", marginBottom: "0.75rem" }}>
                <h4 style={{ margin: 0, fontSize: "0.9rem", color: "var(--color-accent)" }}>
                  3. Fricción por Deuda Técnica
                </h4>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "var(--color-accent)", fontWeight: "bold", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={weights.useTechDebtFactor !== false}
                    onChange={(e) => setWeights({ ...weights, useTechDebtFactor: e.target.checked })}
                    style={{ cursor: "pointer" }}
                  />
                  <span>Activo</span>
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem", opacity: weights.useTechDebtFactor !== false ? 1 : 0.5 }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Código Limpio</label>
                  <input
                    type="number" step="0.05" min="1.0" max="3.0"
                    disabled={weights.useTechDebtFactor === false}
                    value={weights.debtClean}
                    onChange={(e) => setWeights({ ...weights, debtClean: Number(e.target.value) || 1.0 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Deuda Moderada</label>
                  <input
                    type="number" step="0.05" min="1.0" max="3.0"
                    disabled={weights.useTechDebtFactor === false}
                    value={weights.debtModerate}
                    onChange={(e) => setWeights({ ...weights, debtModerate: Number(e.target.value) || 1.3 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Deuda Pesada</label>
                  <input
                    type="number" step="0.05" min="1.0" max="3.0"
                    disabled={weights.useTechDebtFactor === false}
                    value={weights.debtHeavy}
                    onChange={(e) => setWeights({ ...weights, debtHeavy: Number(e.target.value) || 1.6 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Legacy Crítico</label>
                  <input
                    type="number" step="0.05" min="1.0" max="4.0"
                    disabled={weights.useTechDebtFactor === false}
                    value={weights.debtLegacy}
                    onChange={(e) => setWeights({ ...weights, debtLegacy: Number(e.target.value) || 2.0 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
              </div>
            </div>

            {/* 4. Dependencias */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--color-primary-10)", paddingBottom: "0.25rem", marginBottom: "0.75rem" }}>
                <h4 style={{ margin: 0, fontSize: "0.9rem", color: "var(--color-accent)" }}>
                  4. Bloqueos por Dependencias Externas
                </h4>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "var(--color-accent)", fontWeight: "bold", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={weights.useDependencyFactor !== false}
                    onChange={(e) => setWeights({ ...weights, useDependencyFactor: e.target.checked })}
                    style={{ cursor: "pointer" }}
                  />
                  <span>Activo</span>
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem", opacity: weights.useDependencyFactor !== false ? 1 : 0.5 }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Sin dependencias</label>
                  <input
                    type="number" step="0.05" min="1.0" max="3.0"
                    disabled={weights.useDependencyFactor === false}
                    value={weights.depNone}
                    onChange={(e) => setWeights({ ...weights, depNone: Number(e.target.value) || 1.0 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Interna (Otro equipo)</label>
                  <input
                    type="number" step="0.05" min="1.0" max="3.0"
                    disabled={weights.useDependencyFactor === false}
                    value={weights.depInternal}
                    onChange={(e) => setWeights({ ...weights, depInternal: Number(e.target.value) || 1.2 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Externa (Proveedor/API)</label>
                  <input
                    type="number" step="0.05" min="1.0" max="3.0"
                    disabled={weights.useDependencyFactor === false}
                    value={weights.depExternal}
                    onChange={(e) => setWeights({ ...weights, depExternal: Number(e.target.value) || 1.4 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Múltiples bloqueantes</label>
                  <input
                    type="number" step="0.05" min="1.0" max="4.0"
                    disabled={weights.useDependencyFactor === false}
                    value={weights.depMultiple}
                    onChange={(e) => setWeights({ ...weights, depMultiple: Number(e.target.value) || 1.6 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
              </div>
            </div>

            {/* 5. Ceremonias, Contexto & Brooks' Law */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--color-primary-10)", paddingBottom: "0.25rem", marginBottom: "0.75rem" }}>
                <h4 style={{ margin: 0, fontSize: "0.9rem", color: "var(--color-accent)" }}>
                  5. Ceremonias, Contexto y Ley de Brooks
                </h4>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "var(--color-accent)", fontWeight: "bold", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={weights.useBrooksFactor !== false}
                    onChange={(e) => setWeights({ ...weights, useBrooksFactor: e.target.checked })}
                    style={{ cursor: "pointer" }}
                  />
                  <span>Ley de Brooks Activa</span>
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Code Review (Proporción, ej: 0.15 = 15%)</label>
                  <input
                    type="number" step="0.01" min="0.0" max="1.0"
                    value={weights.ceremonyCodeReview}
                    onChange={(e) => setWeights({ ...weights, ceremonyCodeReview: Number(e.target.value) || 0.15 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Testing/QA (Proporción, ej: 0.25 = 25%)</label>
                  <input
                    type="number" step="0.01" min="0.0" max="1.0"
                    value={weights.ceremonyTesting}
                    onChange={(e) => setWeights({ ...weights, ceremonyTesting: Number(e.target.value) || 0.25 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Documentación (Proporción, ej: 0.10 = 10%)</label>
                  <input
                    type="number" step="0.01" min="0.0" max="1.0"
                    value={weights.ceremonyDocumentation}
                    onChange={(e) => setWeights({ ...weights, ceremonyDocumentation: Number(e.target.value) || 0.10 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Recargo por Context Switching</label>
                  <input
                    type="number" step="0.05" min="1.0" max="2.0"
                    value={weights.contextSwitchingPenalty}
                    onChange={(e) => setWeights({ ...weights, contextSwitchingPenalty: Number(e.target.value) || 1.15 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div style={{ opacity: weights.useBrooksFactor !== false ? 1 : 0.5 }}>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Recargo Canal Comunicación Brooks</label>
                  <input
                    type="number" step="0.01" min="0.0" max="0.5"
                    disabled={weights.useBrooksFactor === false}
                    value={weights.brooksFactor}
                    onChange={(e) => setWeights({ ...weights, brooksFactor: Number(e.target.value) || 0.08 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
              </div>
            </div>

            {/* 6. Riesgo de Alcance */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--color-primary-10)", paddingBottom: "0.25rem", marginBottom: "0.75rem" }}>
                <h4 style={{ margin: 0, fontSize: "0.9rem", color: "var(--color-accent)" }}>
                  6. Coeficientes por Claridad de Alcance
                </h4>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "var(--color-accent)", fontWeight: "bold", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={weights.useScopeFactor !== false}
                    onChange={(e) => setWeights({ ...weights, useScopeFactor: e.target.checked })}
                    style={{ cursor: "pointer" }}
                  />
                  <span>Activo</span>
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", opacity: weights.useScopeFactor !== false ? 1 : 0.5 }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Cerrado y Acotado</label>
                  <input
                    type="number" step="0.05" min="1.0" max="3.0"
                    disabled={weights.useScopeFactor === false}
                    value={weights.scopeClosed}
                    onChange={(e) => setWeights({ ...weights, scopeClosed: Number(e.target.value) || 1.0 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Pendientes Menores</label>
                  <input
                    type="number" step="0.05" min="1.0" max="3.0"
                    disabled={weights.useScopeFactor === false}
                    value={weights.scopePending}
                    onChange={(e) => setWeights({ ...weights, scopePending: Number(e.target.value) || 1.25 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Difuso / WIP</label>
                  <input
                    type="number" step="0.05" min="1.0" max="4.0"
                    disabled={weights.useScopeFactor === false}
                    value={weights.scopeDiffuse}
                    onChange={(e) => setWeights({ ...weights, scopeDiffuse: Number(e.target.value) || 1.6 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.25rem" }}>Sin Cierre Técnico</label>
                  <input
                    type="number" step="0.05" min="1.0" max="5.0"
                    disabled={weights.useScopeFactor === false}
                    value={weights.scopeNoTechnicalClosure}
                    onChange={(e) => setWeights({ ...weights, scopeNoTechnicalClosure: Number(e.target.value) || 2.0 })}
                    style={{ width: "100%", padding: "0.45rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                  />
                </div>
              </div>
            </div>

          </div>
          
          <div style={{ display: "flex", gap: "1rem", marginTop: "2rem", borderTop: "1px solid var(--border-color)", paddingTop: "1.5rem" }}>
            <button
              type="button"
              onClick={() => handleSaveWeights(weights)}
              style={{
                padding: "0.6rem 1.5rem",
                borderRadius: "8px",
                border: "none",
                background: "var(--gradient-accent)",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              💾 Guardar Calibración
            </button>
            <button
              type="button"
              onClick={handleResetWeights}
              style={{
                padding: "0.6rem 1.5rem",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
                background: "var(--color-accent-10)",
                color: "var(--color-accent)",
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              🔄 Restaurar Predeterminados
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTargetId !== null}
        title="Eliminar Estimación"
        message="¿Está seguro de que desea eliminar permanentemente esta estimación?"
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        danger={true}
        onConfirm={executeDelete}
        onCancel={() => setDeleteTargetId(null)}
      />

    </div>
  );
}
