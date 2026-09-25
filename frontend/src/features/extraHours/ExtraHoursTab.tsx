import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { PageHeader } from "../../components/PageHeader";
import { SearchableSelect } from "../../components/SearchableSelect";
import {
  listExtraHours,
  createExtraHour,
  calculateExtraHoursApi,
  listExtraHoursConfigs,
  updateCountryExtraHoursConfig,
  resetCountryExtraHoursConfig,
  approveExtraHour,
  rejectExtraHour,
  getPayrollSummary,
  deleteExtraHour,
  listCustomHolidays,
  createCustomHoliday,
  deleteCustomHoliday,
  type CustomHoliday,
  getOfficialHolidays,
  type OfficialHoliday,
  type Project,
  type Consultant,
  type AuthUser,
  type ExtraHourEntry,
  type ExtraHoursConfig,
  type ExtraHoursCalculationResult,
  type PayrollConsolidationRow,
  type ApprovalDelegation,
  listSupportedCountries,
  listDelegations,
  createDelegation,
  deleteDelegation
} from "../../services/api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { displayCountryWithFlag } from "../../utils/statusLabels";
import { CountryFlag } from "../../components/CountryFlag";




type ExtraHoursTabProps = {
  projects: Project[];
  consultants: Consultant[];
  authUser: AuthUser | null;
  can: (permission: string) => boolean;
  onError: (msg: string) => void;
  configModeOnly?: boolean;
};

type LegislationInfo = {
  country: string;
  flag: string;
  desc: string;
  points: string[];
};

const LEGISLATIONS: Record<string, LegislationInfo> = {
  Colombia: {
    country: "Colombia",
    flag: "🇨🇴",
    desc: "Reducción gradual de jornada laboral según Ley 2101 y recargos nocturnos reformados.",
    points: [
      "Jornada semanal actual: 44 horas (divisor 220).",
      "Reducción a 42 horas en julio 2026 (divisor 210).",
      "Franja Nocturna: Inicia a las 19:00 (7:00 PM) con recargo del +35%.",
      "Límite legal: Máximo 2 horas extras diarias, 12 horas semanales.",
      "Recargo Festivo Diurno: +100% (2.0x). Festivo Nocturno: +150% (2.5x)."
    ]
  },
  Peru: {
    country: "Perú",
    flag: "🇵🇪",
    desc: "Recargos progresivos diarios sobre las horas de trabajo extra y recargo nocturno especial.",
    points: [
      "Primeras 2 horas extras/día: +25% de la tarifa base.",
      "A partir de la 3ª hora extra/día: +35% de la tarifa base.",
      "Franja Nocturna (22:00–06:00): Recargo especial del +35% sobre la tarifa base.",
      "Domingos y Festivos: +100% (pago doble)."
    ]
  },
  Chile: {
    country: "Chile",
    flag: "🇨🇱",
    desc: "Cálculo simplificado de recargo diario con límites estrictos de salud ocupacional.",
    points: [
      "Tarifa Extra Única: +50% de recargo sobre la tarifa normal.",
      "Límite legal absoluto: Máximo 2 horas extras diarias.",
      "Solo se permiten horas extras por necesidades temporales de la empresa."
    ]
  },
  Mexico: {
    country: "México",
    flag: "🇲🇽",
    desc: "Límites semanales estrictos con doble y triple compensación según la LFT.",
    points: [
      "Primeras 9 horas extras semanales: Se pagan con +100% (tarifa doble).",
      "Excedente de 9 horas semanales: Se pagan con +200% (tarifa triple).",
      "Franja Diurna: 06:00–20:00. Franja Nocturna: 20:00–06:00.",
      "Máximo sugerido: 3 horas diarias, 3 veces por semana."
    ]
  },
  Ecuador: {
    country: "Ecuador",
    flag: "🇪🇨",
    desc: "Cálculo de horas suplementarias y extraordinarias según el Código del Trabajo de Ecuador.",
    points: [
      "Divisor mensual: 240 horas.",
      "Horas Suplementarias (+50%): Fuera de la jornada regular, hasta las 24:00 (Lunes a Viernes).",
      "Horas Extraordinarias (+100%): Sábados, domingos, festivos nacionales, o de 00:00 a 06:00.",
      "Límite legal: Máximo 4 horas extras diarias, 12 horas semanales."
    ]
  },
  Argentina: {
    country: "Argentina",
    flag: "🇦🇷",
    desc: "Recargos de horas extra según la Ley 11.544 y la Ley de Contrato de Trabajo (LCT).",
    points: [
      "Divisor mensual: 200 horas (jornada legal de 48 horas semanales).",
      "Horas extras en días hábiles: +50% de recargo (1.5x).",
      "Horas extras en sábados después de las 13:00, domingos y feriados: +100% (2.0x).",
      "Franja Nocturna (21:00–06:00): Jornada reducida a 7 horas.",
      "Límite legal: Máximo 3 horas extras diarias, 30 horas mensuales."
    ]
  },
  "España": {
    country: "España",
    flag: "🇪🇸",
    desc: "Regulación de horas extraordinarias según el Estatuto de los Trabajadores (Real Decreto Legislativo 2/2015).",
    points: [
      "Divisor mensual: 160 horas (jornada legal de 40 horas semanales).",
      "Recargo mínimo por hora extra: +75% (1.75x) en jornada diurna.",
      "Recargo nocturno: +100% (2.0x) como mínimo.",
      "Festivos y domingos: +100% (2.0x) diurno, +150% (2.5x) nocturno.",
      "Límite legal absoluto: Máximo 80 horas extras anuales."
    ]
  },
  Default: {
    country: "USA",
    flag: "🇺🇸",
    desc: "Compensación estándar de horas extra semanales aplicable cuando no hay legislación específica del país (USA/EEUU).",
    points: [
      "Cálculo semanal: Horas que superen las 40 horas semanales.",
      "Multiplicador: +50% de recargo (1.5x).",
      "Se aplica de manera general si el país no cuenta con una legislación específica."
    ]
  }
};

export function ExtraHoursTab({ projects, consultants, authUser, can, onError, configModeOnly = false }: ExtraHoursTabProps) {
  // Sub-navigation tabs
  const [activeSubTab, setActiveSubTab] = useState<"report" | "pm" | "finance" | "payroll" | "config" | "holidays" | "delegations">(
    configModeOnly ? "config" : "report"
  );

  // Success message banner state
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Global lists
  const [entries, setEntries] = useState<ExtraHourEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  // Supported countries from backend
  const [supportedCountries, setSupportedCountries] = useState<string[]>([]);

  // --- Custom Holidays state ---
  const [customHolidays, setCustomHolidays] = useState<CustomHoliday[]>([]);
  const [loadingHolidays, setLoadingHolidays] = useState(false);
  const [holidayName, setHolidayName] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayCountry, setHolidayCountry] = useState("All");
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarCountry, setCalendarCountry] = useState("Colombia");
  const [savingHoliday, setSavingHoliday] = useState(false);

  // Consolidated holidays state from API
  const [holidaysList, setHolidaysList] = useState<OfficialHoliday[]>([]);
  const [loadingHolidaysList, setLoadingHolidaysList] = useState(false);

  const fetchHolidays = useCallback(async () => {
    setLoadingHolidaysList(true);
    try {
      const data = await getOfficialHolidays(calendarCountry, calendarYear);
      const mapped = data.map((h) => ({
        date: h.date.includes("T") ? h.date.split("T")[0] : h.date,
        name: h.name,
        isCustom: h.isCustom,
      }));
      setHolidaysList(mapped);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al cargar feriados");
    } finally {
      setLoadingHolidaysList(false);
    }
  }, [calendarCountry, calendarYear, onError]);

  useEffect(() => {
    void fetchHolidays();
  }, [fetchHolidays]);


  // --- 1. Report Form state ---
  const myConsultant = consultants.find((c) => c.email?.toLowerCase() === authUser?.email?.toLowerCase());
  const [reportConsultantId, setReportConsultantId] = useState(myConsultant?.id || "");
  const [reportProjectId, setReportProjectId] = useState("");
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [reportStartTime, setReportStartTime] = useState("18:00");
  const [reportEndTime, setReportEndTime] = useState("20:00");
  const [reportObservations, setReportObservations] = useState("");
  const [historyConsultantFilter, setHistoryConsultantFilter] = useState("");
  
  // Real-time calculation preview state
  const [previewResult, setPreviewResult] = useState<ExtraHoursCalculationResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [formWarnings, setFormWarnings] = useState<string[]>([]);
  const [reporting, setReporting] = useState(false);

  // --- 2. Approvals PM & Finance ---
  const [rejectionTargetId, setRejectionTargetId] = useState<string | null>(null);
  const [rejectionNote, setRejectionNote] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // --- 3. Delete confirmation state ---
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // --- 4. Payroll closure state ---
  const [payrollYear, setPayrollYear] = useState(() => new Date().getFullYear());
  const [payrollMonth, setPayrollMonth] = useState(() => new Date().getMonth() + 1);
  const [payrollRows, setPayrollRows] = useState<PayrollConsolidationRow[]>([]);
  const [loadingPayroll, setLoadingPayroll] = useState(false);

  // --- 5. Config state (Multi-country) ---
  const [configsList, setConfigsList] = useState<ExtraHoursConfig[]>([]);
  const [selectedCountryConfig, setSelectedCountryConfig] = useState<string>("Colombia");
  const [configLimit, setConfigLimit] = useState<number>(12);
  const [configDiurnalMult, setConfigDiurnalMult] = useState<number>(1.25);
  const [configNocturnalMult, setConfigNocturnalMult] = useState<number>(1.75);
  const [configHolidayDiurnalMult, setConfigHolidayDiurnalMult] = useState<number>(2.00);
  const [configHolidayNocturnalMult, setConfigHolidayNocturnalMult] = useState<number>(2.50);
  const [configDiurnalStart, setConfigDiurnalStart] = useState<string>("06:00");
  const [configDiurnalEnd, setConfigDiurnalEnd] = useState<string>("21:00");
  const [configMonthlyDivisor, setConfigMonthlyDivisor] = useState<number>(220);
  const [savingConfig, setSavingConfig] = useState(false);

  // --- 6. Delegations state ---
  const [delegations, setDelegations] = useState<ApprovalDelegation[]>([]);
  const [loadingDelegations, setLoadingDelegations] = useState(false);
  const [delegateProjectId, setDelegateProjectId] = useState("");
  const [delegateToEmail, setDelegateToEmail] = useState("");
  const [delegateStartDate, setDelegateStartDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [delegateEndDate, setDelegateEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [savingDelegation, setSavingDelegation] = useState(false);

  // Show a success message that auto-dismisses
  const triggerSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => {
      setSuccessMessage(null);
    }, 5000);
  };

  const loadDelegationsList = useCallback(async () => {
    if (!can("extrahours:review") && !authUser?.roles.includes("ADMIN")) return;
    setLoadingDelegations(true);
    try {
      const data = await listDelegations();
      setDelegations(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al cargar delegaciones");
    } finally {
      setLoadingDelegations(false);
    }
  }, [onError, can, authUser]);

  const handleAddDelegation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!delegateProjectId || !delegateToEmail || !delegateStartDate || !delegateEndDate) {
      onError("Por favor completa todos los campos.");
      return;
    }
    setSavingDelegation(true);
    try {
      await createDelegation({
        projectId: delegateProjectId,
        toUserEmail: delegateToEmail,
        startDate: delegateStartDate,
        endDate: delegateEndDate,
      });
      triggerSuccess("Delegación registrada con éxito.");
      setDelegateProjectId("");
      setDelegateToEmail("");
      await loadDelegationsList();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al registrar delegación");
    } finally {
      setSavingDelegation(false);
    }
  };

  const handleDeleteDelegation = async (id: string) => {
    if (!window.confirm("¿Está seguro de que desea eliminar esta delegación?")) {
      return;
    }
    try {
      await deleteDelegation(id);
      triggerSuccess("Delegación eliminada con éxito.");
      await loadDelegationsList();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al eliminar delegación");
    }
  };

  // Fetch entries
  const loadEntries = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const data = await listExtraHours();
      setEntries(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al cargar solicitudes de horas extra");
    } finally {
      setLoadingEntries(false);
    }
  }, [onError]);

  // Load configs
  const loadConfigs = useCallback(async () => {
    try {
      const data = await listExtraHoursConfigs();
      setConfigsList(data);
      
      // Load current country details
      const current = data.find((c) => c.country === selectedCountryConfig);
      if (current) {
        setConfigLimit(Number(current.weeklyExtraHoursLimit));
        setConfigDiurnalMult(Number(current.diurnalMultiplier));
        setConfigNocturnalMult(Number(current.nocturnalMultiplier));
        setConfigHolidayDiurnalMult(Number(current.diurnalHolidayMultiplier));
        setConfigHolidayNocturnalMult(Number(current.nocturnalHolidayMultiplier));
        setConfigDiurnalStart(current.diurnalStart.slice(0, 5));
        setConfigDiurnalEnd(current.diurnalEnd.slice(0, 5));
        setConfigMonthlyDivisor(current.monthlyDivisor ? Number(current.monthlyDivisor) : 220);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al cargar configuraciones de horas extra");
    }
  }, [selectedCountryConfig, onError]);

  // Load custom holidays
  const loadCustomHolidaysList = useCallback(async () => {
    setLoadingHolidays(true);
    try {
      const data = await listCustomHolidays();
      setCustomHolidays(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al cargar feriados especiales");
    } finally {
      setLoadingHolidays(false);
    }
  }, [onError]);

  // Load initial data
  useEffect(() => {
    void loadEntries();
    if (can("extrahours:config")) {
      void loadConfigs();
      void loadCustomHolidaysList();
    }
    if (can("extrahours:review") || authUser?.roles.includes("ADMIN")) {
      void loadDelegationsList();
    }
    // Fetch supported countries from backend
    void listSupportedCountries().then(setSupportedCountries).catch(() => {});
  }, [loadEntries, loadConfigs, loadCustomHolidaysList, loadDelegationsList, can, authUser]);


  // Handle selected country changes in config
  useEffect(() => {
    if (configsList.length > 0) {
      const current = configsList.find((c) => c.country === selectedCountryConfig);
      if (current) {
        setConfigLimit(Number(current.weeklyExtraHoursLimit));
        setConfigDiurnalMult(Number(current.diurnalMultiplier));
        setConfigNocturnalMult(Number(current.nocturnalMultiplier));
        setConfigHolidayDiurnalMult(Number(current.diurnalHolidayMultiplier));
        setConfigHolidayNocturnalMult(Number(current.nocturnalHolidayMultiplier));
        setConfigDiurnalStart(current.diurnalStart.slice(0, 5));
        setConfigDiurnalEnd(current.diurnalEnd.slice(0, 5));
        setConfigMonthlyDivisor(current.monthlyDivisor ? Number(current.monthlyDivisor) : 220);
      } else {
        // Default placeholders if not seeded yet
        const defaults = LEGISLATIONS[selectedCountryConfig] ? {
          limit: 12,
          dMult: 1.25,
          nMult: 1.75,
          hdMult: 2.0,
          hnMult: 2.5,
          start: "06:00",
          end: "21:00",
          divisor: ({ Colombia: 220, Peru: 240, Ecuador: 240, Mexico: 240, Chile: 180, Argentina: 200, "España": 160 } as Record<string, number>)[selectedCountryConfig] ?? 220
        } : {
          limit: 12,
          dMult: 1.5,
          nMult: 1.5,
          hdMult: 1.5,
          hnMult: 1.5,
          start: "06:00",
          end: "21:00",
          divisor: 220
        };
        setConfigLimit(defaults.limit);
        setConfigDiurnalMult(defaults.dMult);
        setConfigNocturnalMult(defaults.nMult);
        setConfigHolidayDiurnalMult(defaults.hdMult);
        setConfigHolidayNocturnalMult(defaults.hnMult);
        setConfigDiurnalStart(defaults.start);
        setConfigDiurnalEnd(defaults.end);
        setConfigMonthlyDivisor(defaults.divisor);
      }
    }
  }, [selectedCountryConfig, configsList]);

  // Default consultant ID when consultants load
  useEffect(() => {
    if (myConsultant && !reportConsultantId) {
      setReportConsultantId(myConsultant.id);
    }
  }, [consultants, myConsultant, reportConsultantId]);

  // Real-time backend calculation preview
  useEffect(() => {
    if (!reportConsultantId || !reportDate || !reportStartTime || !reportEndTime) {
      setPreviewResult(null);
      return;
    }

    const timeRegex = /^\d{2}:\d{2}$/;
    if (!timeRegex.test(reportStartTime) || !timeRegex.test(reportEndTime)) {
      return;
    }

    let isMounted = true;
    const triggerCalculation = async () => {
      setPreviewLoading(true);
      try {
        const result = await calculateExtraHoursApi({
          consultantId: reportConsultantId,
          date: reportDate,
          startTime: `${reportStartTime}:00`,
          endTime: `${reportEndTime}:00`
        });
        if (isMounted) {
          setPreviewResult(result);
          setFormWarnings(result.warnings || []);
        }
      } catch {
        if (isMounted) setPreviewResult(null);
      } finally {
        if (isMounted) setPreviewLoading(false);
      }
    };

    const delayDebounce = setTimeout(() => {
      void triggerCalculation();
    }, 400);

    return () => {
      isMounted = false;
      clearTimeout(delayDebounce);
    };
  }, [reportConsultantId, reportDate, reportStartTime, reportEndTime]);

  // Handle report submission
  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportProjectId) {
      onError("Por favor selecciona un proyecto.");
      return;
    }
    if (!reportConsultantId) {
      onError("Por favor selecciona o define un consultor.");
      return;
    }

    const isManager = authUser?.roles.includes("ADMIN") || authUser?.roles.includes("PM");
    if (!isManager) {
      const todayStr = new Date().toLocaleDateString("en-CA");
      if (reportDate < todayStr) {
        onError("No se pueden solicitar horas extra para días anteriores al actual.");
        return;
      }
    }

    setReporting(true);
    try {
      const res = await createExtraHour({
        projectId: reportProjectId,
        consultantId: reportConsultantId,
        date: reportDate,
        startTime: `${reportStartTime}:00`,
        endTime: `${reportEndTime}:00`,
        observations: reportObservations.trim() || undefined
      });
      
      triggerSuccess(`¡Solicitud registrada con éxito! ${res.warnings?.length ? `Aviso: ${res.warnings.join(", ")}` : ""}`);
      setReportObservations("");
      await loadEntries();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al reportar horas extra");
    } finally {
      setReporting(false);
    }
  };

  // Handle delete
  const handleDeleteEntry = async () => {
    if (!deleteTargetId) return;
    try {
      await deleteExtraHour(deleteTargetId);
      triggerSuccess("Solicitud de horas extra eliminada.");
      setDeleteTargetId(null);
      await loadEntries();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al eliminar solicitud");
    }
  };

  // Handle sequential approvals
  const handleApprove = async (id: string) => {
    if (!authUser) return;
    setApprovingId(id);
    try {
      await approveExtraHour(id);
      triggerSuccess("Solicitud aprobada correctamente.");
      await loadEntries();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al aprobar la solicitud");
    } finally {
      setApprovingId(null);
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectionTargetId || !rejectionNote.trim() || !authUser) return;
    if (rejectionNote.trim().length < 3) {
      onError("El motivo de rechazo debe tener al menos 3 caracteres.");
      return;
    }

    try {
      await rejectExtraHour(rejectionTargetId, {
        rejectionNote: rejectionNote.trim()
      });
      setRejectionTargetId(null);
      setRejectionNote("");
      triggerSuccess("Solicitud rechazada con éxito.");
      await loadEntries();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al rechazar la solicitud");
    }
  };

  // Fetch consolidated payroll closure
  const handleLoadPayroll = async () => {
    setLoadingPayroll(true);
    try {
      const summary = await getPayrollSummary(payrollYear, payrollMonth);
      setPayrollRows(summary);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al consultar cierre de nómina");
    } finally {
      setLoadingPayroll(false);
    }
  };

  const handleExportPayrollCSV = () => {
    if (payrollRows.length === 0) return;
    const headers = [
      "Consultor",
      "Identificación DNI/Cédula",
      "País",
      "Moneda",
      "Horas Totales",
      "Diurnas",
      "Nocturnas",
      "Festivas Diurnas",
      "Festivas Nocturnas",
      "Monto Local",
      "Monto USD"
    ];

    const rows = payrollRows.map((r) => [
      `"${r.consultantName}"`,
      `"${r.identification}"`,
      `"${r.country}"`,
      `"${r.currency}"`,
      r.totalHours,
      r.diurnal,
      r.nocturnal,
      r.diurnalHoliday,
      r.nocturnalHoliday,
      r.totalAmountLocal.toFixed(2),
      r.totalAmountUSD.toFixed(2)
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Cierre_Nomina_${payrollYear}_${payrollMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Update configurations per country
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      await updateCountryExtraHoursConfig(selectedCountryConfig, {
        weeklyExtraHoursLimit: configLimit,
        diurnalMultiplier: configDiurnalMult,
        nocturnalMultiplier: configNocturnalMult,
        diurnalHolidayMultiplier: configHolidayDiurnalMult,
        nocturnalHolidayMultiplier: configHolidayNocturnalMult,
        diurnalStart: `${configDiurnalStart}:00`,
        diurnalEnd: `${configDiurnalEnd}:00`,
        monthlyDivisor: configMonthlyDivisor
      });
      triggerSuccess(`Configuración de ${selectedCountryConfig} actualizada con éxito.`);
      await loadConfigs();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al actualizar configuración");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleRestoreDefaults = async () => {
    if (!window.confirm(`¿Estás seguro de que deseas restablecer los parámetros de ${selectedCountryConfig} a sus valores predeterminados de ley?`)) {
      return;
    }
    setSavingConfig(true);
    try {
      const updated = await resetCountryExtraHoursConfig(selectedCountryConfig);
      setConfigLimit(Number(updated.weeklyExtraHoursLimit));
      setConfigDiurnalMult(Number(updated.diurnalMultiplier));
      setConfigNocturnalMult(Number(updated.nocturnalMultiplier));
      setConfigHolidayDiurnalMult(Number(updated.diurnalHolidayMultiplier));
      setConfigHolidayNocturnalMult(Number(updated.nocturnalHolidayMultiplier));
      
      const formatTime = (t: string) => {
        const parts = t.split(":");
        return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : t;
      };
      setConfigDiurnalStart(formatTime(updated.diurnalStart));
      setConfigDiurnalEnd(formatTime(updated.diurnalEnd));
      setConfigMonthlyDivisor(Number(updated.monthlyDivisor));

      triggerSuccess(`Configuración de ${selectedCountryConfig} restablecida a los valores predeterminados con éxito.`);
      await loadConfigs();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al restablecer configuración");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayName.trim() || !holidayDate) {
      onError("Por favor ingresa un nombre y una fecha válida.");
      return;
    }
    setSavingHoliday(true);
    try {
      await createCustomHoliday({
        name: holidayName,
        date: holidayDate,
        country: holidayCountry,
      });
      triggerSuccess("Feriado corporativo agregado con éxito.");
      setHolidayName("");
      setHolidayDate("");
      setHolidayCountry("All");
      await loadCustomHolidaysList();
      void fetchHolidays();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al agregar feriado especial");
    } finally {
      setSavingHoliday(false);
    }
  };

  const handleDeleteHoliday = async (id: string) => {
    if (!window.confirm("¿Está seguro de que desea eliminar este feriado especial?")) {
      return;
    }
    try {
      await deleteCustomHoliday(id);
      triggerSuccess("Feriado corporativo eliminado con éxito.");
      await loadCustomHolidaysList();
      void fetchHolidays();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al eliminar feriado especial");
    }
  };


  /**
   * Estado de una solicitud: etiqueta visible + modificador de `.state-chip`.
   * Antes devolvía dos colores sueltos (`bg`/`color`) que se inyectaban como
   * estilo en línea y no tenían contraparte en modo oscuro. La etiqueta es la
   * que comunica el estado; el tinte solo lo refuerza.
   */
  const getStatusLabel = (status: string): { label: string; tone: string } => {
    switch (status) {
      case "PENDING_PM": return { label: "Pte. PM (Nivel 1)", tone: "warning" };
      case "PENDING_FINANCE": return { label: "Pte. Nómina (Nivel 2)", tone: "info" };
      case "APPROVED": return { label: "Aprobada total", tone: "success" };
      case "REJECTED": return { label: "Rechazada", tone: "danger" };
      default: return { label: status, tone: "neutral" };
    }
  };

  // Filter projects with allowExtraHours = true
  const availableProjects = projects.filter((p) => p.allowExtraHours !== false);

  // Filter entries based on approval views
  const pmPendingEntries = entries.filter((e) => e.status === "PENDING_PM");
  const financePendingEntries = entries.filter((e) => e.status === "PENDING_FINANCE");

  return (
    <div className="page-stack page-stack--padded">

      {/* Success banner */}
      {successMessage && (
        <div className="success-banner" role="status">
          ✅ {successMessage}
        </div>
      )}

      <PageHeader
        icon={configModeOnly ? "⚙" : "⧗"}
        title={configModeOnly ? "Configuración de Horas Extra" : "Solicitud de Horas Extra"}
        description={
          configModeOnly
            ? "Administra los límites diarios/semanales, recargos por tipo de hora, festivos y jornada laboral."
            : "Registra y consulta tus solicitudes de horas extras con cálculo automático de recargos y estado de aprobación."
        }
        actions={
          configModeOnly ? (
            <>
              <button
                type="button"
                className={activeSubTab === "config" ? "toolbar-btn" : "toolbar-btn ghost"}
                onClick={() => setActiveSubTab("config")}
              >
                ⚙ Parámetros y Recargos
              </button>
              <button
                type="button"
                className={activeSubTab === "holidays" ? "toolbar-btn" : "toolbar-btn ghost"}
                onClick={() => setActiveSubTab("holidays")}
              >
                📅 Calendario y Festivos
              </button>
            </>
          ) : (
            <>
              {can("extrahours:write") && (
                <button
                  type="button"
                  className={activeSubTab === "report" ? "toolbar-btn" : "toolbar-btn ghost"}
                  onClick={() => setActiveSubTab("report")}
                >
                  📝 Reportar y Mis Solicitudes
                </button>
              )}

              {can("extrahours:review") && (
                <button
                  type="button"
                  className={activeSubTab === "pm" ? "toolbar-btn" : "toolbar-btn ghost"}
                  onClick={() => setActiveSubTab("pm")}
                >
                  👥 Aprobaciones PM ({pmPendingEntries.length})
                </button>
              )}

              {can("extrahours:review") && (authUser?.roles.includes("FINANCE") || authUser?.roles.includes("ADMIN")) && (
                <button
                  type="button"
                  className={activeSubTab === "finance" ? "toolbar-btn" : "toolbar-btn ghost"}
                  onClick={() => setActiveSubTab("finance")}
                >
                  💰 Aprobaciones Nómina ({financePendingEntries.length})
                </button>
              )}

              {(authUser?.roles.includes("FINANCE") || authUser?.roles.includes("ADMIN")) && (
                <button
                  type="button"
                  className={activeSubTab === "payroll" ? "toolbar-btn" : "toolbar-btn ghost"}
                  onClick={() => setActiveSubTab("payroll")}
                >
                  📁 Cierre de Nómina
                </button>
              )}
              {(can("projects:write") || authUser?.roles.includes("ADMIN")) && (
                <button
                  type="button"
                  className={activeSubTab === "delegations" ? "toolbar-btn" : "toolbar-btn ghost"}
                  onClick={() => { setActiveSubTab("delegations"); void loadDelegationsList(); }}
                >
                  🤝 Delegaciones
                </button>
              )}
            </>
          )
        }
      />

      {/* Rejection Modal overlay */}
      {rejectionTargetId && createPortal(
        <div className="modal-overlay">
          <form onSubmit={handleRejectSubmit} className="modal-card modal-card--sm">
            <div className="modal-header">
              <h3>Rechazar Solicitud de Horas Extra</h3>
              <button type="button" className="ghost modal-close" onClick={() => setRejectionTargetId(null)}>✕</button>
            </div>
            <div className="form-grid">
              <div>
                <label className="form-label form-label--sm">Motivo de Rechazo *</label>
                <textarea
                  required
                  placeholder="Por favor explica brevemente por qué rechazas la solicitud..."
                  value={rejectionNote}
                  onChange={(e) => setRejectionNote(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-actions modal-actions--spaced">
              <button type="button" className="ghost" onClick={() => setRejectionTargetId(null)}>Cancelar</button>
              <button type="submit" className="btn-danger">Rechazar Solicitud</button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteTargetId !== null}
        title="¿Eliminar Solicitud?"
        message="¿Está seguro de que desea eliminar permanentemente esta solicitud de horas extra? Esta acción no se puede deshacer."
        confirmLabel="Sí, eliminar"
        cancelLabel="Cancelar"
        danger={true}
        onConfirm={handleDeleteEntry}
        onCancel={() => setDeleteTargetId(null)}
      />

      {/* --- REPORT SUB-TAB --- */}
      {activeSubTab === "report" && (
        <div className="two-pane">

          {/* Form and Preview */}
          <div className="page-stack">
            <div className="card glass-card card--roomy">
              <h3 className="card-title">
                Registrar Solicitud
              </h3>

              <form onSubmit={handleReportSubmit} className="form-grid form-grid--tight">
                {authUser?.roles.includes("ADMIN") ? (
                  <div>
                    <label className="form-label form-label--sm">Consultor *</label>
                    <select
                      value={reportConsultantId}
                      onChange={(e) => setReportConsultantId(e.target.value)}
                      required
                    >
                      <option value="">-- Selecciona --</option>
                      {consultants.map((c) => (
                        <option key={c.id} value={c.id}>{c.fullName} ({displayCountryWithFlag(c.country || "Default")})</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="form-label form-label--sm">Consultor</label>
                    <input
                      type="text"
                      readOnly
                      className="input-readonly"
                      value={myConsultant ? `${myConsultant.fullName} (${displayCountryWithFlag(myConsultant.country || "Default")})` : authUser?.displayName || ""}
                    />
                  </div>
                )}

                <div>
                  <label className="form-label form-label--sm">Proyecto *</label>
                  <select
                    value={reportProjectId}
                    onChange={(e) => setReportProjectId(e.target.value)}
                    required
                  >
                    <option value="">-- Selecciona Proyecto (Habilitados) --</option>
                    {availableProjects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label form-label--sm">Fecha *</label>
                  <input
                    type="date"
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                    required
                  />
                </div>

                <div className="field-pair">
                  <div>
                    <label className="form-label form-label--sm">Hora Inicio *</label>
                    <input
                      type="time"
                      value={reportStartTime}
                      onChange={(e) => setReportStartTime(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label form-label--sm">Hora Fin *</label>
                    <input
                      type="time"
                      value={reportEndTime}
                      onChange={(e) => setReportEndTime(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="form-label form-label--sm">Observaciones / Tarea Realizada</label>
                  <textarea
                    rows={2}
                    value={reportObservations}
                    onChange={(e) => setReportObservations(e.target.value)}
                    placeholder="Describe el entregable, debugging o despliegue realizado..."
                  />
                </div>

                {/* Warnings warning box */}
                {formWarnings.length > 0 && (
                  <div className="notice notice--warning" role="status">
                    <div className="notice__title">
                      <span aria-hidden="true">⚠️</span>
                      <strong>Límite advertencia:</strong>
                    </div>
                    <ul className="notice__list">
                      {formWarnings.map((w, idx) => <li key={idx}>{w}</li>)}
                    </ul>
                  </div>
                )}

                <button
                  type="submit"
                  className="btn-block"
                  disabled={reporting || previewLoading}
                >
                  {reporting ? "Registrando..." : "Enviar a Aprobación"}
                </button>
              </form>
            </div>

            {/* Live calculation details card */}
            {previewResult && (
              <div className="card preview-card">
                <h4 className="preview-card__title">🧮 Simulación en Vivo (Cálculo Backend)</h4>
                <div className="preview-grid">
                  <div>Horas Totales: <strong>{previewResult.totalHours} hrs</strong></div>
                  <div>¿Día Festivo?: <strong>{previewResult.isHoliday ? "Sí" : "No"}</strong></div>
                  <div>Diurnas / Nocturnas: <strong>{previewResult.diurnal} / {previewResult.nocturnal}</strong></div>
                  <div>Festivas (D / N): <strong>{previewResult.diurnalHoliday} / {previewResult.nocturnalHoliday}</strong></div>
                  
                  {/* Tarifa y Divisor */}
                  <div>Divisor Mensual: <strong>{previewResult.divisorUsed || "220"} hrs</strong></div>
                  <div>Tarifa por Hora: <strong>{previewResult.hourlyRate > 0 ? `$${previewResult.hourlyRate.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr` : "Costo/Mes div."}</strong></div>
                  
                  {/* Legislación aplicada */}
                  {(() => {
                    const selConsultant = authUser?.roles.includes("ADMIN")
                      ? consultants.find(c => c.id === reportConsultantId)
                      : myConsultant;
                    const ctry = selConsultant?.country || "Default";
                    if (ctry === "Colombia") {
                      const isAfterLaw = previewResult.divisorUsed === 210;
                      return (
                        <div className={`preview-note preview-note--${isAfterLaw ? "success" : "info"}`}>
                          ℹ️ Colombia: Se aplica la jornada de <strong>{isAfterLaw ? "42 hs (Ley 2101 - Jul 2026)" : "44 hs (Reglamento Anterior)"}</strong>
                        </div>
                      );
                    } else if (ctry === "Ecuador") {
                      return (
                        <div className="preview-note preview-note--info">
                          ℹ️ Ecuador: Código del Trabajo (Horas Suplementarias 50% / Extraordinarias 100% sobre divisor 240)
                        </div>
                      );
                    }
                    return null;
                  })()}

                  <div className="preview-total">
                    Valor Estimado Pago: <strong className="preview-total__amount">${previewResult.totalAmount.toLocaleString("es-CO")}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* List of my entries */}
          <div className="card card--roomy">
            <div className="card-head">
              <h3 className="card-title card-title--tight">
                Historial de Solicitudes
              </h3>
              <div className="inline-filter">
                <label className="inline-filter__label">Filtrar Consultor:</label>
                <SearchableSelect
                  options={consultants.map((c) => ({ value: c.id, label: c.fullName }))}
                  value={historyConsultantFilter}
                  onChange={(val) => setHistoryConsultantFilter(val)}
                  placeholder="Buscar consultor..."
                  emptyLabel="-- Todos --"
                />
              </div>
            </div>

            {loadingEntries ? (
              <p className="loading">Cargando...</p>
            ) : entries.length === 0 ? (
              <p className="empty-note">No se han registrado solicitudes todavía.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Proyecto</th>
                      <th>Consultor</th>
                      <th>Horario</th>
                      <th>Horas</th>
                      <th>Monto</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const filtered = entries.filter((entry) => {
                        if (historyConsultantFilter && entry.consultantId !== historyConsultantFilter) {
                          return false;
                        }
                        return true;
                      });
                      if (filtered.length === 0) {
                        return (
                          <tr>
                            <td colSpan={8} className="cell-empty cell-empty--roomy">
                              No se encontraron solicitudes para el consultor seleccionado.
                            </td>
                          </tr>
                        );
                      }
                      return filtered.map((entry) => {
                        const stat = getStatusLabel(entry.status);
                        const isOwn = entry.consultantId === myConsultant?.id || authUser?.roles.includes("ADMIN");
                        const canDelete = isOwn && entry.status !== "APPROVED";

                        return (
                          <tr key={entry.id}>
                            <td>{entry.date.slice(0, 10)}</td>
                            <td><strong>{entry.project?.name || "Sin proyecto"}</strong></td>
                            <td>{entry.consultant?.fullName}</td>
                            <td className="cell-small">{entry.startTime.slice(0, 5)} - {entry.endTime.slice(0, 5)}</td>
                            <td>
                              <strong>{Number(entry.totalHours).toFixed(1)}</strong>
                              <span className="cell-meta">
                                D:{Number(entry.diurnal).toFixed(1)} N:{Number(entry.nocturnal).toFixed(1)} F:{Number(Number(entry.diurnalHoliday) + Number(entry.nocturnalHoliday)).toFixed(1)}
                              </span>
                            </td>
                            <td>
                              <strong>${Number(entry.totalAmount).toLocaleString("es-CO")}</strong>
                              <span className="cell-meta">{entry.consultant?.rateCurrency || "COP"}</span>
                            </td>
                            <td>
                              <span className={`state-chip state-chip--${stat.tone}`}>
                                {stat.label}
                              </span>
                              {entry.rejectionNote && (
                                <span className="cell-reject-note">
                                  Motivo: {entry.rejectionNote}
                                </span>
                              )}
                            </td>
                            <td>
                              {canDelete ? (
                                <button
                                  type="button"
                                  className="btn-icon-danger"
                                  onClick={() => setDeleteTargetId(entry.id)}
                                  title="Eliminar solicitud"
                                >
                                  🗑
                                </button>
                              ) : (
                                <span className="cell-dash">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      )}

      {/* --- PM APPROVALS SUB-TAB --- */}
      {activeSubTab === "pm" && (
        <div className="card card--roomy">
          <h3 className="card-title">
            Buzón de Aprobaciones del Supervisor (Nivel 1)
          </h3>
          <p className="card-lead">
            Revisa y valida de forma operativa las horas extra registradas en tus proyectos. Luego pasarán a Nómina.
          </p>

          {pmPendingEntries.length === 0 ? (
            <p className="empty-note">No hay solicitudes pendientes por aprobación PM.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Consultor</th>
                    <th>Proyecto</th>
                    <th>Fecha</th>
                    <th>Horario</th>
                    <th>Horas</th>
                    <th>Monto Local</th>
                    <th>Observaciones</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {pmPendingEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td><strong>{entry.consultant?.fullName}</strong> (<CountryFlag country={entry.consultant?.country || "Default"} />)</td>
                      <td>{entry.project?.name}</td>
                      <td>{entry.date.slice(0, 10)}</td>
                      <td>{entry.startTime.slice(0, 5)} - {entry.endTime.slice(0, 5)}</td>
                      <td>
                        <strong>{Number(entry.totalHours).toFixed(1)}</strong>
                        <span className="cell-meta">
                          D:{Number(entry.diurnal).toFixed(1)} N:{Number(entry.nocturnal).toFixed(1)} F:{Number(Number(entry.diurnalHoliday) + Number(entry.nocturnalHoliday)).toFixed(1)}
                        </span>
                      </td>
                      <td>
                        <strong>${Number(entry.totalAmount).toLocaleString("es-CO")}</strong>
                        <span className="cell-meta">{entry.consultant?.rateCurrency || "COP"}</span>
                      </td>
                      <td>
                        <span className="cell-note">{entry.observations || "Sin observaciones"}</span>
                      </td>
                      <td>
                        <div className="inline-actions">
                          <button
                            type="button"
                            className="btn-sm btn-success"
                            disabled={approvingId === entry.id}
                            onClick={() => void handleApprove(entry.id)}
                          >
                            {approvingId === entry.id ? "Aprobando..." : "✓ Aprobar"}
                          </button>
                          <button
                            type="button"
                            className="btn-sm btn-danger-soft"
                            onClick={() => { setRejectionTargetId(entry.id); setRejectionNote(""); }}
                          >
                            ✕ Rechazar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* --- FINANCE/PAYROLL APPROVALS SUB-TAB --- */}
      {activeSubTab === "finance" && (
        <div className="card card--roomy">
          <h3 className="card-title">
            Buzón de Aprobaciones de Nómina / Recursos Humanos (Nivel 2)
          </h3>
          <p className="card-lead">
            Valida financieramente para consolidar en el pago final.
          </p>

          {financePendingEntries.length === 0 ? (
            <p className="empty-note">No hay solicitudes pendientes de validación final.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Consultor</th>
                    <th>Identificación</th>
                    <th>País</th>
                    <th>Proyecto</th>
                    <th>Fecha</th>
                    <th>Horario</th>
                    <th>Horas</th>
                    <th>Monto Local</th>
                    <th>Observaciones</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {financePendingEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td><strong>{entry.consultant?.fullName}</strong></td>
                      {/* `undefined` = el rol no puede ver el documento (DEP-38); `null` = no lo tiene cargado. */}
                      <td>{entry.consultant?.identification === undefined ? "—" : entry.consultant.identification || "No asignado"}</td>
                      <td><CountryFlag country={entry.consultant?.country || "Default"} /></td>
                      <td>{entry.project?.name}</td>
                      <td>{entry.date.slice(0, 10)}</td>
                      <td>{entry.startTime.slice(0, 5)} - {entry.endTime.slice(0, 5)}</td>
                      <td>
                        <strong>{Number(entry.totalHours).toFixed(1)}</strong>
                        <span className="cell-meta">
                          D:{Number(entry.diurnal).toFixed(1)} N:{Number(entry.nocturnal).toFixed(1)} F:{Number(Number(entry.diurnalHoliday) + Number(entry.nocturnalHoliday)).toFixed(1)}
                        </span>
                      </td>
                      <td>
                        <strong>${Number(entry.totalAmount).toLocaleString("es-CO")}</strong>
                        <span className="cell-meta">{entry.consultant?.rateCurrency || "COP"}</span>
                      </td>
                      <td>
                        <span className="cell-note">{entry.observations || "Sin observaciones"}</span>
                      </td>
                      <td>
                        <div className="inline-actions">
                          <button
                            type="button"
                            className="btn-sm btn-success"
                            disabled={approvingId === entry.id}
                            onClick={() => void handleApprove(entry.id)}
                          >
                            {approvingId === entry.id ? "Aprobando..." : "✓ Aprobar Pago"}
                          </button>
                          <button
                            type="button"
                            className="btn-sm btn-danger-soft"
                            onClick={() => { setRejectionTargetId(entry.id); setRejectionNote(""); }}
                          >
                            ✕ Rechazar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* --- PAYROLL CLOSURE SUB-TAB --- */}
      {activeSubTab === "payroll" && (
        <div className="card card--roomy">
          <h3 className="card-title">
            Cierre Consolidado de Nómina Mensual
          </h3>
          <p className="card-lead">
            Filtra por periodo para descargar el reporte CSV de horas aprobadas consolidado en bimoneda local y USD.
          </p>

          <div className="inline-form inline-form--spaced">
            <div className="inline-form__field inline-form__field--narrow">
              <label className="form-label form-label--sm">Año</label>
              <select value={payrollYear} onChange={(e) => setPayrollYear(Number(e.target.value))}>
                {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="inline-form__field inline-form__field--mid">
              <label className="form-label form-label--sm">Mes</label>
              <select value={payrollMonth} onChange={(e) => setPayrollMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString("es-CO", { month: "long" })}</option>
                ))}
              </select>
            </div>
            <button type="button" className="inline-form__submit" onClick={handleLoadPayroll} disabled={loadingPayroll}>
              {loadingPayroll ? "Consolidando..." : "🔍 Consolidar Horas"}
            </button>
            {payrollRows.length > 0 && (
              <button type="button" className="ghost inline-form__submit" onClick={handleExportPayrollCSV}>
                ⬇ Descargar Reporte CSV
              </button>
            )}
          </div>

          {payrollRows.length === 0 ? (
            <p className="empty-note">No se han consultado cierres de nómina para este periodo o no hay horas aprobadas.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Consultor</th>
                    <th>Identificación DNI</th>
                    <th>País</th>
                    <th>Moneda</th>
                    <th>Total Horas</th>
                    <th>Diurnas</th>
                    <th>Nocturnas</th>
                    <th>Festivas Diu.</th>
                    <th>Festivas Noc.</th>
                    <th>Total Local</th>
                    <th>Total USD</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollRows.map((row, idx) => (
                    <tr key={idx}>
                      <td><strong>{row.consultantName}</strong></td>
                      <td>{row.identification}</td>
                      <td><CountryFlag country={row.country || "Default"} /></td>
                      <td>{row.currency}</td>
                      <td><strong>{row.totalHours}</strong></td>
                      <td>{row.diurnal}</td>
                      <td>{row.nocturnal}</td>
                      <td>{row.diurnalHoliday}</td>
                      <td>{row.nocturnalHoliday}</td>
                      <td><strong>${row.totalAmountLocal.toLocaleString("es-CO")}</strong></td>
                      <td><strong className="tone-warning">${row.totalAmountUSD.toLocaleString("es-CO", { maximumFractionDigits: 2 })} USD</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* --- CONFIGURATION SUB-TAB (Multi-Country Selector & Forms) --- */}
      {activeSubTab === "config" && (
        <div className="page-stack">

          {/* Header */}
          <div className="card glass-card card--roomy">
            <h3 className="section-intro__title">
              ⚙ Configuración Multipaís de Horas Extra
            </h3>
            <p className="section-intro__text">
              Define y edita los multiplicadores, límites semanales y jornada diurna de forma independiente para cada país en el que opere la empresa.
            </p>
          </div>

          {/* Country Selection Tabs (Pills) */}
          <div className="country-tabs">
            {(supportedCountries.length > 0 ? supportedCountries : Object.keys(LEGISLATIONS)).map((cName) => {
              const leg = LEGISLATIONS[cName] || {
                country: cName,
                flag: "🌐",
                desc: `Legislación y parámetros específicos para ${cName}.`,
                points: []
              };
              return (
                <button
                  key={cName}
                  type="button"
                  className={`country-tab-btn ${selectedCountryConfig === cName ? "active" : "ghost"}`}
                  onClick={() => setSelectedCountryConfig(cName)}
                >
                  <span className="country-tab-btn__flag" aria-hidden="true">{leg.flag}</span>
                  <span>{leg.country}</span>
                </button>
              );
            })}
          </div>

          {/* Grid Layout (Legislation helper + Edit Form) */}
          <div className="two-pane">
            
            {/* Left Column: Legislation Helper */}
            {(() => {
              const activeLeg = LEGISLATIONS[selectedCountryConfig] || {
                country: selectedCountryConfig,
                flag: "🌐",
                desc: "Configuración de parámetros legales cargada desde el backend.",
                points: ["Los parámetros de este país se sincronizan dinámicamente con el backend."]
              };
              return (
                <div className="legislation-card">
                  <div className="legislation-card__head">
                    <span className="legislation-card__flag" aria-hidden="true">{activeLeg.flag}</span>
                    <h4>
                      Legislación: {activeLeg.country}
                    </h4>
                  </div>
                  <p>
                    {activeLeg.desc}
                  </p>

                  <ul>
                    {activeLeg.points.map((pt, idx) => (
                      <li key={idx}>{pt}</li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            {/* Right Column: Edit Form */}
            <form onSubmit={handleSaveConfig} className="card card--roomy card--stack">
              <h4 className="card-title card-title--rule">
                Editar Parámetros - {selectedCountryConfig}
              </h4>

              <div className="field-grid">
                
                <div>
                  <label className="form-label">
                    Límite Semanal (Horas)
                    <span className="info-tooltip-wrapper">
                      <span className="info-tooltip-icon">i</span>
                      <span className="info-tooltip-bubble">
                        Máximo de horas extras sugeridas o permitidas a la semana.
                        <span className="info-tooltip-arrow"></span>
                      </span>
                    </span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={48}
                    required
                    value={configLimit}
                    onChange={(e) => setConfigLimit(Number(e.target.value))}
                  />
                </div>

                <div>
                  <label className="form-label">
                    Inicio Jornada Diurna (HH:mm)
                    <span className="info-tooltip-wrapper">
                      <span className="info-tooltip-icon">i</span>
                      <span className="info-tooltip-bubble">
                        Hora de inicio para el cálculo de la jornada diurna regular (ej: 06:00).
                        <span className="info-tooltip-arrow"></span>
                      </span>
                    </span>
                  </label>
                  <input
                    type="time"
                    required
                    value={configDiurnalStart}
                    onChange={(e) => setConfigDiurnalStart(e.target.value)}
                  />
                </div>

                <div>
                  <label className="form-label">
                    Fin Jornada Diurna (HH:mm)
                    <span className="info-tooltip-wrapper">
                      <span className="info-tooltip-icon">i</span>
                      <span className="info-tooltip-bubble">
                        Hora en la que termina el horario diurno e inicia el recargo nocturno.
                        <span className="info-tooltip-arrow"></span>
                      </span>
                    </span>
                  </label>
                  <input
                    type="time"
                    required
                    value={configDiurnalEnd}
                    onChange={(e) => setConfigDiurnalEnd(e.target.value)}
                  />
                </div>

                <div>
                  <label className="form-label">
                    Multiplicador Diurno Regular
                    <span className="info-tooltip-wrapper">
                      <span className="info-tooltip-icon">i</span>
                      <span className="info-tooltip-bubble">
                        Factor de recargo aplicado sobre la hora base durante el día (ej: 1.25 representa +25%).
                        <span className="info-tooltip-arrow"></span>
                      </span>
                    </span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    step={0.05}
                    required
                    value={configDiurnalMult}
                    onChange={(e) => setConfigDiurnalMult(Number(e.target.value))}
                  />
                </div>

                <div>
                  <label className="form-label">
                    Multiplicador Nocturno Regular
                    <span className="info-tooltip-wrapper">
                      <span className="info-tooltip-icon">i</span>
                      <span className="info-tooltip-bubble">
                        Factor de recargo aplicado sobre la hora base en jornada nocturna (ej: 1.75 representa +75%).
                        <span className="info-tooltip-arrow"></span>
                      </span>
                    </span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    step={0.05}
                    required
                    value={configNocturnalMult}
                    onChange={(e) => setConfigNocturnalMult(Number(e.target.value))}
                  />
                </div>

                <div>
                  <label className="form-label">
                    Multiplicador Festivo Diurno
                    <span className="info-tooltip-wrapper">
                      <span className="info-tooltip-icon">i</span>
                      <span className="info-tooltip-bubble">
                        Factor de recargo para domingos o festivos en horario diurno (ej: 2.0 representa +100%).
                        <span className="info-tooltip-arrow"></span>
                      </span>
                    </span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    step={0.05}
                    required
                    value={configHolidayDiurnalMult}
                    onChange={(e) => setConfigHolidayDiurnalMult(Number(e.target.value))}
                  />
                </div>

                <div>
                  <label className="form-label">
                    Multiplicador Festivo Nocturno
                    <span className="info-tooltip-wrapper">
                      <span className="info-tooltip-icon">i</span>
                      <span className="info-tooltip-bubble">
                        Factor de recargo para domingos o festivos en horario nocturno (ej: 2.5 representa +150%).
                        <span className="info-tooltip-arrow"></span>
                      </span>
                    </span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    step={0.05}
                    required
                    value={configHolidayNocturnalMult}
                    onChange={(e) => setConfigHolidayNocturnalMult(Number(e.target.value))}
                  />
                </div>

                <div>
                  <label className="form-label">
                    Divisor Mensual de Horas
                    <span className="info-tooltip-wrapper">
                      <span className="info-tooltip-icon">i</span>
                      <span className="info-tooltip-bubble">
                        Cantidad de horas laborables al mes utilizadas para calcular la tarifa por hora de consultores con costo fijo mensual.
                        <span className="info-tooltip-arrow"></span>
                      </span>
                    </span>
                  </label>
                  <input
                    type="number"
                    min={100}
                    max={300}
                    step={1}
                    required
                    value={configMonthlyDivisor}
                    onChange={(e) => setConfigMonthlyDivisor(Number(e.target.value))}
                  />
                </div>

              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn-danger-soft"
                  onClick={handleRestoreDefaults}
                  disabled={savingConfig}
                >
                  Volver a predeterminados
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                >
                  {savingConfig ? "Guardando..." : "Guardar Configuración"}
                </button>
              </div>
            </form>

          </div>

        </div>
      )}

      {/* --- HOLIDAYS SUB-TAB (Official Calendar & Corporate Non-Working Days) --- */}
      {activeSubTab === "holidays" && (
        <div className="page-stack">

          {/* Header */}
          <div className="card glass-card card--roomy">
            <h3 className="section-intro__title">
              📅 Gestión de Días No Laborables y Festivos
            </h3>
            <p className="section-intro__text">
              Visualiza los calendarios oficiales de festivos nacionales por país y registra los días festivos especiales de la empresa (feriados corporativos).
            </p>
          </div>

          <div className="two-pane">

            {/* Left Column: Official Holiday Calendar */}
            <div className="card card--roomy">
              <h4 className="card-title card-title--rule">
                🗓️ Calendario de Festivos Oficiales
              </h4>

              <div className="field-pair field-pair--spaced">
                <div>
                  <label className="form-label form-label--sm">País</label>
                  <select
                    className="control-sm"
                    value={calendarCountry}
                    onChange={(e) => setCalendarCountry(e.target.value)}
                  >
                    {supportedCountries.filter(c => c !== "Default").map(c => {
                      const leg = LEGISLATIONS[c];
                      return <option key={c} value={c}>{leg ? `${leg.country} ${leg.flag}` : c}</option>;
                    })}
                    {supportedCountries.includes("Default") && <option value="Default">{LEGISLATIONS.Default?.country ?? "Default"} {LEGISLATIONS.Default?.flag ?? "🌐"}</option>}
                  </select>
                </div>
                <div>
                  <label className="form-label form-label--sm">Año</label>
                  <input
                    type="number"
                    className="control-sm"
                    min={2020}
                    max={2030}
                    value={calendarYear}
                    onChange={(e) => setCalendarYear(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="holiday-list">
                {loadingHolidaysList ? (
                  <div className="empty-note empty-note--center">Cargando feriados...</div>
                ) : holidaysList.length === 0 ? (
                  <div className="empty-note empty-note--center">No hay feriados para este año y país.</div>
                ) : (
                  holidaysList.map((h, index) => {
                    const [y, m, d] = h.date.split("-");
                    const dateObj = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
                    const formattedDate = dateObj.toLocaleDateString("es-ES", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      timeZone: "UTC"
                    });
                    return (
                      <div key={index} className="holiday-list__row">
                        <span className="holiday-list__date">
                          {formattedDate}
                        </span>
                        {/* Corporativo (verde) frente a oficial (ámbar): la misma
                            pareja de colores que ya tenía, ahora con su icono y
                            con contraste y modo oscuro resueltos por el chip. */}
                        <span className={`state-chip state-chip--${h.isCustom ? "success" : "warning"}`}>
                          {h.name} {h.isCustom ? "🌐" : "🏛️"}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Custom Holiday Administration */}
            <div className="page-stack">

              {/* Form to Create Custom Holiday */}
              <form onSubmit={handleAddHoliday} className="card card--roomy">
                <h4 className="card-title card-title--rule">
                  ➕ Agregar Feriado Corporativo / Especial
                </h4>

                <div className="form-row-3">
                  <div>
                    <label className="form-label form-label--sm">Nombre del Evento *</label>
                    <input
                      type="text"
                      className="control-sm"
                      required
                      placeholder="Ej. Aniversario Synaptica"
                      value={holidayName}
                      onChange={(e) => setHolidayName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label form-label--sm">Fecha *</label>
                    <input
                      type="date"
                      className="control-sm"
                      required
                      value={holidayDate}
                      onChange={(e) => setHolidayDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label form-label--sm">País / Alcance</label>
                    <select
                      className="control-sm"
                      value={holidayCountry}
                      onChange={(e) => setHolidayCountry(e.target.value)}
                    >
                      <option value="All">Todos (Corporativo) 🌐</option>
                      {supportedCountries.filter(c => c !== "Default").map(c => {
                        const leg = LEGISLATIONS[c];
                        return <option key={c} value={c}>{leg ? `${leg.country} ${leg.flag}` : c}</option>;
                      })}
                    </select>
                  </div>
                </div>

                <div className="form-actions">
                  <button
                    type="submit"
                    className="btn-compact"
                    disabled={savingHoliday}
                  >
                    {savingHoliday ? "Guardando..." : "Agregar Feriado"}
                  </button>
                </div>
              </form>

              {/* Table of Custom Holidays */}
              <div className="card card--roomy">
                <h4 className="card-title card-title--rule">
                  📋 Feriados Corporativos Registrados
                </h4>

                <div className="table-wrap table-wrap--spaced">
                  {loadingHolidays ? (
                    <p className="empty-note empty-note--center">
                      Cargando feriados...
                    </p>
                  ) : customHolidays.length === 0 ? (
                    <p className="empty-note empty-note--center">
                      No hay feriados corporativos especiales registrados.
                    </p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Nombre</th>
                          <th>Fecha</th>
                          <th>Alcance</th>
                          <th className="cell-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customHolidays.map((h) => {
                          const dateObj = new Date(h.date);
                          const formattedDate = dateObj.toLocaleDateString("es-ES", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            timeZone: "UTC"
                          });
                          return (
                            <tr key={h.id}>
                              <td className="cell-strong">{h.name}</td>
                              <td>{formattedDate}</td>
                              <td>
                                {h.country === "All" ? "🌐 Todos" : (
                                  <span>
                                    {h.country === "Colombia" && "🇨🇴 "}
                                    {h.country === "Peru" && "🇵🇪 "}
                                    {h.country === "Chile" && "🇨🇱 "}
                                    {h.country === "Mexico" && "🇲🇽 "}
                                    {h.country === "Ecuador" && "🇪🇨 "}
                                    {h.country}
                                  </span>
                                )}
                              </td>
                              <td className="cell-right">
                                <button
                                  type="button"
                                  className="btn-icon-danger btn-sm"
                                  onClick={() => handleDeleteHoliday(h.id)}
                                >
                                  🗑️ Eliminar
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

            </div>

          </div>

        </div>
      )}

      {/* --- DELEGATIONS SUB-TAB --- */}
      {activeSubTab === "delegations" && (
        <div className="page-stack">

          {/* Header */}
          <div className="card glass-card card--roomy">
            <h3 className="section-intro__title">
              🤝 Delegación de Aprobaciones
            </h3>
            <p className="section-intro__text">
              Permite a los Directores de Proyecto (PM) delegar temporalmente la aprobación Nivel 1 a un consultor normal para un proyecto y rango de fechas específico.
            </p>
          </div>

          <div className="two-pane">

            {/* Left Column: Create Delegation */}
            <form onSubmit={handleAddDelegation} className="card card--roomy card--stack">
              <h4 className="card-title card-title--rule">
                ➕ Registrar Nueva Delegación
              </h4>

              <div className="form-stack">
                <div>
                  <label className="form-label form-label--sm">Proyecto *</label>
                  <select
                    value={delegateProjectId}
                    onChange={(e) => setDelegateProjectId(e.target.value)}
                    required
                  >
                    <option value="">-- Selecciona --</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label form-label--sm">Delegar a (Consultor) *</label>
                  <select
                    value={delegateToEmail || ""}
                    onChange={(e) => setDelegateToEmail(e.target.value)}
                    required
                  >
                    <option value="">-- Selecciona --</option>
                    {consultants
                      .filter(c => c.email && c.email.toLowerCase() !== authUser?.email?.toLowerCase())
                      .map((c) => (
                        <option key={c.id} value={c.email || ""}>{c.fullName} ({c.email})</option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="form-label form-label--sm">Fecha Inicio *</label>
                  <input
                    type="date"
                    required
                    value={delegateStartDate}
                    onChange={(e) => setDelegateStartDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className="form-label form-label--sm">Fecha Fin *</label>
                  <input
                    type="date"
                    required
                    value={delegateEndDate}
                    onChange={(e) => setDelegateEndDate(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn-block"
                disabled={savingDelegation}
              >
                {savingDelegation ? "Guardando..." : "Delegar Aprobación"}
              </button>
            </form>

            {/* Right Column: Delegations List */}
            <div className="card card--roomy">
              <h4 className="card-title card-title--rule">
                📋 Delegaciones Activas y Registradas
              </h4>

              <div className="table-wrap table-wrap--spaced">
                {loadingDelegations ? (
                  <p className="empty-note empty-note--center">
                    Cargando delegaciones...
                  </p>
                ) : delegations.length === 0 ? (
                  <p className="empty-note empty-note--center">
                    No hay delegaciones de aprobación registradas.
                  </p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Proyecto</th>
                        <th>Delegado Por</th>
                        <th>Delegado A</th>
                        <th>Rango</th>
                        <th className="cell-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {delegations.map((d) => {
                        const project = projects.find(p => p.id === d.projectId);
                        const startFormatted = new Date(d.startDate).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
                        const endFormatted = new Date(d.endDate).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
                        return (
                          <tr key={d.id}>
                            <td className="cell-strong">{project ? project.name : d.projectId}</td>
                            <td>{d.fromUserEmail}</td>
                            <td className="cell-strong">{d.toUserEmail}</td>
                            <td className="cell-date">{startFormatted} al {endFormatted}</td>
                            <td className="cell-right">
                              <button
                                type="button"
                                className="btn-icon-danger btn-sm"
                                onClick={() => handleDeleteDelegation(d.id)}
                              >
                                🗑️ Eliminar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

          </div>

        </div>
      )}

    </div>
  );
}
