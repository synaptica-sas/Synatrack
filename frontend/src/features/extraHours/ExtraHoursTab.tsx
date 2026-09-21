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


  const getStatusLabel = (status: string) => {
    switch (status) {
      case "PENDING_PM": return { label: "Pte. PM (Nivel 1)", bg: "var(--color-accent-10)", color: "var(--color-accent)" };
      case "PENDING_FINANCE": return { label: "Pte. Nómina (Nivel 2)", bg: "var(--color-blue-10)", color: "var(--color-sec-blue)" };
      case "APPROVED": return { label: "Aprobada total", bg: "var(--color-green-10)", color: "var(--color-sec-green)" };
      case "REJECTED": return { label: "Rechazada", bg: "var(--color-red-10)", color: "var(--color-sec-red)" };
      default: return { label: status, bg: "var(--color-primary-05)", color: "var(--text)" };
    }
  };

  // Filter projects with allowExtraHours = true
  const availableProjects = projects.filter((p) => p.allowExtraHours !== false);

  // Filter entries based on approval views
  const pmPendingEntries = entries.filter((e) => e.status === "PENDING_PM");
  const financePendingEntries = entries.filter((e) => e.status === "PENDING_FINANCE");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", padding: "1rem 2rem" }}>
      
      {/* Success banner */}
      {successMessage && (
        <div style={{
          position: "fixed",
          top: "20px",
          right: "20px",
          background: "#10b981",
          color: "#fff",
          padding: "0.75rem 1.5rem",
          borderRadius: "8px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          zIndex: 9999,
          fontWeight: 700,
          fontSize: "0.85rem",
          transition: "all 0.3s ease",
          animation: "slideIn 0.3s ease forwards"
        }}>
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
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className={activeSubTab === "config" ? "" : "ghost"}
                onClick={() => setActiveSubTab("config")}
                style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem", borderRadius: "8px" }}
              >
                ⚙ Parámetros y Recargos
              </button>
              <button
                type="button"
                className={activeSubTab === "holidays" ? "" : "ghost"}
                onClick={() => setActiveSubTab("holidays")}
                style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem", borderRadius: "8px" }}
              >
                📅 Calendario y Festivos
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              {can("extrahours:write") && (
                <button
                  type="button"
                  className={activeSubTab === "report" ? "" : "ghost"}
                  onClick={() => setActiveSubTab("report")}
                  style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem", borderRadius: "8px" }}
                >
                  📝 Reportar y Mis Solicitudes
                </button>
              )}

              {can("extrahours:review") && (
                <button
                  type="button"
                  className={activeSubTab === "pm" ? "" : "ghost"}
                  onClick={() => setActiveSubTab("pm")}
                  style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem", borderRadius: "8px" }}
                >
                  👥 Aprobaciones PM ({pmPendingEntries.length})
                </button>
              )}

              {can("extrahours:review") && (authUser?.roles.includes("FINANCE") || authUser?.roles.includes("ADMIN")) && (
                <button
                  type="button"
                  className={activeSubTab === "finance" ? "" : "ghost"}
                  onClick={() => setActiveSubTab("finance")}
                  style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem", borderRadius: "8px" }}
                >
                  💰 Aprobaciones Nómina ({financePendingEntries.length})
                </button>
              )}

              {(authUser?.roles.includes("FINANCE") || authUser?.roles.includes("ADMIN")) && (
                <button
                  type="button"
                  className={activeSubTab === "payroll" ? "" : "ghost"}
                  onClick={() => setActiveSubTab("payroll")}
                  style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem", borderRadius: "8px" }}
                >
                  📁 Cierre de Nómina
                </button>
              )}
              {(can("projects:write") || authUser?.roles.includes("ADMIN")) && (
                <button
                  type="button"
                  className={activeSubTab === "delegations" ? "" : "ghost"}
                  onClick={() => { setActiveSubTab("delegations"); void loadDelegationsList(); }}
                  style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem", borderRadius: "8px" }}
                >
                  🤝 Delegaciones
                </button>
              )}
            </div>
          )
        }
      />

      {/* Rejection Modal overlay */}
      {rejectionTargetId && createPortal(
        <div className="modal-overlay">
          <form onSubmit={handleRejectSubmit} className="modal-card" style={{ maxWidth: "450px" }}>
            <div className="modal-header">
              <h3>Rechazar Solicitud de Horas Extra</h3>
              <button type="button" className="ghost" onClick={() => setRejectionTargetId(null)} style={{ padding: "0.2rem 0.5rem" }}>✕</button>
            </div>
            <div className="form-grid">
              <div>
                <label className="form-label" style={{ fontSize: "0.85rem", fontWeight: 700 }}>Motivo de Rechazo *</label>
                <textarea
                  required
                  placeholder="Por favor explica brevemente por qué rechazas la solicitud..."
                  value={rejectionNote}
                  onChange={(e) => setRejectionNote(e.target.value)}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
            </div>
            <div className="modal-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="ghost" onClick={() => setRejectionTargetId(null)}>Cancelar</button>
              <button type="submit" style={{ background: "var(--color-sec-red)", borderColor: "var(--color-sec-red)" }}>Rechazar Solicitud</button>
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
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.9fr", gap: "2rem", alignItems: "start" }}>
          
          {/* Form and Preview */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <div className="card glass-card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "var(--card-bg)" }}>
              <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.05rem", color: "var(--text-strong)", fontFamily: "var(--display)" }}>
                Registrar Solicitud
              </h3>
              
              <form onSubmit={handleReportSubmit} className="form-grid" style={{ gap: "0.8rem" }}>
                {authUser?.roles.includes("ADMIN") ? (
                  <div>
                    <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Consultor *</label>
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
                    <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Consultor</label>
                    <input
                      type="text"
                      readOnly
                      value={myConsultant ? `${myConsultant.fullName} (${displayCountryWithFlag(myConsultant.country || "Default")})` : authUser?.displayName || ""}
                      style={{ background: "#f3f4f6", cursor: "not-allowed" }}
                    />
                  </div>
                )}

                <div>
                  <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Proyecto *</label>
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
                  <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Fecha *</label>
                  <input
                    type="date"
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Hora Inicio *</label>
                    <input
                      type="time"
                      value={reportStartTime}
                      onChange={(e) => setReportStartTime(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Hora Fin *</label>
                    <input
                      type="time"
                      value={reportEndTime}
                      onChange={(e) => setReportEndTime(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Observaciones / Tarea Realizada</label>
                  <textarea
                    rows={2}
                    value={reportObservations}
                    onChange={(e) => setReportObservations(e.target.value)}
                    placeholder="Describe el entregable, debugging o despliegue realizado..."
                  />
                </div>

                {/* Warnings warning box */}
                {formWarnings.length > 0 && (
                  <div style={{ padding: "0.5rem 0.75rem", background: "var(--color-accent-10)", border: "1px solid var(--color-accent-20)", color: "var(--text)", borderRadius: "8px", fontSize: "0.8rem" }}>
                    ⚠️ <strong>Límite advertencia:</strong>
                    <ul style={{ margin: "0.25rem 0 0 0", paddingLeft: "1.2rem" }}>
                      {formWarnings.map((w, idx) => <li key={idx}>{w}</li>)}
                    </ul>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={reporting || previewLoading}
                  style={{ marginTop: "0.5rem", width: "100%", background: "var(--gradient-accent)", border: "none" }}
                >
                  {reporting ? "Registrando..." : "Enviar a Aprobación"}
                </button>
              </form>
            </div>

            {/* Live calculation details card */}
            {previewResult && (
              <div className="card" style={{ padding: "1.25rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "rgba(241, 163, 35, 0.03)" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--color-accent)", fontSize: "0.9rem", fontWeight: 700 }}>🧮 Simulación en Vivo (Cálculo Backend)</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.8rem", color: "var(--text-soft)" }}>
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
                        <div style={{ gridColumn: "span 2", padding: "0.3rem 0.5rem", background: isAfterLaw ? "var(--color-green-10)" : "var(--color-blue-10)", border: `1px solid ${isAfterLaw ? "var(--color-sec-green)" : "var(--color-sec-blue)"}`, color: isAfterLaw ? "var(--color-sec-green)" : "var(--color-sec-blue)", borderRadius: "6px", fontSize: "0.72rem", marginTop: "0.2rem" }}>
                          ℹ️ Colombia: Se aplica la jornada de <strong>{isAfterLaw ? "42 hs (Ley 2101 - Jul 2026)" : "44 hs (Reglamento Anterior)"}</strong>
                        </div>
                      );
                    } else if (ctry === "Ecuador") {
                      return (
                        <div style={{ gridColumn: "span 2", padding: "0.3rem 0.5rem", background: "var(--color-blue-10)", border: "1px solid var(--color-sec-blue)", color: "var(--color-sec-blue)", borderRadius: "6px", fontSize: "0.72rem", marginTop: "0.2rem" }}>
                          ℹ️ Ecuador: Código del Trabajo (Horas Suplementarias 50% / Extraordinarias 100% sobre divisor 240)
                        </div>
                      );
                    }
                    return null;
                  })()}

                  <div style={{ gridColumn: "span 2", borderTop: "1px dashed var(--border-color)", paddingTop: "0.4rem", marginTop: "0.2rem" }}>
                    Valor Estimado Pago: <strong style={{ color: "var(--color-accent)", fontSize: "0.95rem" }}>${previewResult.totalAmount.toLocaleString("es-CO")}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* List of my entries */}
          <div className="card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.05rem", color: "var(--text-strong)", fontFamily: "var(--display)" }}>
                Historial de Solicitudes
              </h3>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: "250px" }}>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-soft)", whiteSpace: "nowrap" }}>Filtrar Consultor:</label>
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
              <p style={{ fontStyle: "italic", color: "var(--text-soft)", fontSize: "0.85rem" }}>No se han registrado solicitudes todavía.</p>
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
                            <td colSpan={8} style={{ textAlign: "center", fontStyle: "italic", color: "var(--text-soft)", padding: "1.5rem" }}>
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
                            <td style={{ fontSize: "0.75rem" }}>{entry.startTime.slice(0, 5)} - {entry.endTime.slice(0, 5)}</td>
                            <td>
                              <strong>{Number(entry.totalHours).toFixed(1)}</strong>
                              <span style={{ fontSize: "0.7rem", color: "#888", display: "block" }}>
                                D:{Number(entry.diurnal).toFixed(1)} N:{Number(entry.nocturnal).toFixed(1)} F:{Number(Number(entry.diurnalHoliday) + Number(entry.nocturnalHoliday)).toFixed(1)}
                              </span>
                            </td>
                            <td>
                              <strong>${Number(entry.totalAmount).toLocaleString("es-CO")}</strong>
                              <span style={{ fontSize: "0.7rem", color: "#888", display: "block" }}>{entry.consultant?.rateCurrency || "COP"}</span>
                            </td>
                            <td>
                              <span className="pill" style={{ background: stat.bg, color: stat.color, fontSize: "0.72rem", padding: "0.15rem 0.45rem", fontWeight: 700 }}>
                                {stat.label}
                              </span>
                              {entry.rejectionNote && (
                                <span style={{ display: "block", color: "var(--color-sec-red)", fontSize: "0.7rem", marginTop: "0.2rem", maxWidth: "150px" }}>
                                  Motivo: {entry.rejectionNote}
                                </span>
                              )}
                            </td>
                            <td>
                              {canDelete ? (
                                <button
                                  type="button"
                                  onClick={() => setDeleteTargetId(entry.id)}
                                  style={{ background: "none", color: "var(--color-sec-red)", border: "none", cursor: "pointer", fontSize: "0.95rem" }}
                                  title="Eliminar solicitud"
                                >
                                  🗑
                                </button>
                              ) : (
                                <span style={{ color: "#aaa", fontSize: "0.8rem" }}>—</span>
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
        <div className="card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "#fff" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.05rem", color: "var(--text-strong)", fontFamily: "var(--display)" }}>
            Buzón de Aprobaciones del Supervisor (Nivel 1)
          </h3>
          <p style={{ color: "var(--text-soft)", fontSize: "0.82rem", marginBottom: "1rem" }}>
            Revisa y valida de forma operativa las horas extra registradas en tus proyectos. Luego pasarán a Nómina.
          </p>

          {pmPendingEntries.length === 0 ? (
            <p style={{ color: "var(--text-soft)", fontStyle: "italic", fontSize: "0.85rem" }}>No hay solicitudes pendientes por aprobación PM.</p>
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
                        <span style={{ fontSize: "0.7rem", color: "#888", display: "block" }}>
                          D:{Number(entry.diurnal).toFixed(1)} N:{Number(entry.nocturnal).toFixed(1)} F:{Number(Number(entry.diurnalHoliday) + Number(entry.nocturnalHoliday)).toFixed(1)}
                        </span>
                      </td>
                      <td>
                        <strong>${Number(entry.totalAmount).toLocaleString("es-CO")}</strong>
                        <span style={{ fontSize: "0.7rem", color: "#888", display: "block" }}>{entry.consultant?.rateCurrency || "COP"}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-soft)" }}>{entry.observations || "Sin observaciones"}</span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          <button
                            type="button"
                            disabled={approvingId === entry.id}
                            onClick={() => void handleApprove(entry.id)}
                            style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", background: "var(--color-sec-green)", borderColor: "var(--color-sec-green)" }}
                          >
                            {approvingId === entry.id ? "Aprobando..." : "✓ Aprobar"}
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => { setRejectionTargetId(entry.id); setRejectionNote(""); }}
                            style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", borderColor: "var(--color-sec-red)", color: "var(--color-sec-red)", background: "var(--color-red-10)" }}
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
        <div className="card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "#fff" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.05rem", color: "var(--text-strong)", fontFamily: "var(--display)" }}>
            Buzón de Aprobaciones de Nómina / Recursos Humanos (Nivel 2)
          </h3>
          <p style={{ color: "var(--text-soft)", fontSize: "0.82rem", marginBottom: "1rem" }}>
            Valida financieramente para consolidar en el pago final.
          </p>

          {financePendingEntries.length === 0 ? (
            <p style={{ color: "var(--text-soft)", fontStyle: "italic", fontSize: "0.85rem" }}>No hay solicitudes pendientes de validación final.</p>
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
                      <td>{entry.consultant?.identification || "No asignado"}</td>
                      <td><CountryFlag country={entry.consultant?.country || "Default"} /></td>
                      <td>{entry.project?.name}</td>
                      <td>{entry.date.slice(0, 10)}</td>
                      <td>{entry.startTime.slice(0, 5)} - {entry.endTime.slice(0, 5)}</td>
                      <td>
                        <strong>{Number(entry.totalHours).toFixed(1)}</strong>
                        <span style={{ fontSize: "0.7rem", color: "#888", display: "block" }}>
                          D:{Number(entry.diurnal).toFixed(1)} N:{Number(entry.nocturnal).toFixed(1)} F:{Number(Number(entry.diurnalHoliday) + Number(entry.nocturnalHoliday)).toFixed(1)}
                        </span>
                      </td>
                      <td>
                        <strong>${Number(entry.totalAmount).toLocaleString("es-CO")}</strong>
                        <span style={{ fontSize: "0.7rem", color: "#888", display: "block" }}>{entry.consultant?.rateCurrency || "COP"}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-soft)" }}>{entry.observations || "Sin observaciones"}</span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          <button
                            type="button"
                            disabled={approvingId === entry.id}
                            onClick={() => void handleApprove(entry.id)}
                            style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", background: "var(--color-sec-green)", borderColor: "var(--color-sec-green)" }}
                          >
                            {approvingId === entry.id ? "Aprobando..." : "✓ Aprobar Pago"}
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => { setRejectionTargetId(entry.id); setRejectionNote(""); }}
                            style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", borderColor: "var(--color-sec-red)", color: "var(--color-sec-red)", background: "var(--color-red-10)" }}
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
        <div className="card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "#fff" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.05rem", color: "var(--text-strong)", fontFamily: "var(--display)" }}>
            Cierre Consolidado de Nómina Mensual
          </h3>
          <p style={{ color: "var(--text-soft)", fontSize: "0.82rem", marginBottom: "1rem" }}>
            Filtra por periodo para descargar el reporte CSV de horas aprobadas consolidado en bimoneda local y USD.
          </p>

          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "120px" }}>
              <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Año</label>
              <select value={payrollYear} onChange={(e) => setPayrollYear(Number(e.target.value))}>
                {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "150px" }}>
              <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Mes</label>
              <select value={payrollMonth} onChange={(e) => setPayrollMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString("es-CO", { month: "long" })}</option>
                ))}
              </select>
            </div>
            <button type="button" onClick={handleLoadPayroll} disabled={loadingPayroll} style={{ padding: "0.55rem 1.2rem", background: "var(--gradient-accent)", border: "none" }}>
              {loadingPayroll ? "Consolidando..." : "🔍 Consolidar Horas"}
            </button>
            {payrollRows.length > 0 && (
              <button type="button" className="ghost" onClick={handleExportPayrollCSV} style={{ padding: "0.55rem 1.2rem", borderColor: "var(--border-color)" }}>
                ⬇ Descargar Reporte CSV
              </button>
            )}
          </div>

          {payrollRows.length === 0 ? (
            <p style={{ color: "var(--text-soft)", fontStyle: "italic", fontSize: "0.85rem" }}>No se han consultado cierres de nómina para este periodo o no hay horas aprobadas.</p>
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
                      <td><strong style={{ color: "var(--color-accent)" }}>${row.totalAmountUSD.toLocaleString("es-CO", { maximumFractionDigits: 2 })} USD</strong></td>
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
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* Header */}
          <div className="card glass-card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "var(--card-bg)" }}>
            <h3 style={{ margin: 0, fontSize: "1.15rem", color: "var(--text-strong)", fontFamily: "var(--display)" }}>
              ⚙ Configuración Multipaís de Horas Extra
            </h3>
            <p style={{ color: "var(--text-soft)", fontSize: "0.82rem", marginTop: "0.25rem" }}>
              Define y edita los multiplicadores, límites semanales y jornada diurna de forma independiente para cada país en el que opere la empresa.
            </p>
          </div>

          {/* Country Selection Tabs (Pills) */}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", borderBottom: "1px dashed var(--border-color)", paddingBottom: "1rem" }}>
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
                  style={{
                    fontSize: "0.85rem",
                    padding: "0.45rem 1rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    borderRadius: "20px"
                  }}
                >
                  <span style={{ fontSize: "1.1rem" }}>{leg.flag}</span>
                  <span>{leg.country}</span>
                </button>
              );
            })}
          </div>

          {/* Grid Layout (Legislation helper + Edit Form) */}
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr", gap: "2rem", alignItems: "start" }}>
            
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
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    <span style={{ fontSize: "1.5rem" }}>{activeLeg.flag}</span>
                    <h4 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
                      Legislación: {activeLeg.country}
                    </h4>
                  </div>
                  <p style={{ fontSize: "0.82rem", lineHeight: 1.5, marginBottom: "1.25rem" }}>
                    {activeLeg.desc}
                  </p>
                  
                  <ul style={{ paddingLeft: "1.2rem", margin: 0, display: "flex", flexDirection: "column", gap: "0.6rem", fontSize: "0.78rem" }}>
                    {activeLeg.points.map((pt, idx) => (
                      <li key={idx} style={{ lineHeight: 1.4 }}>{pt}</li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            {/* Right Column: Edit Form */}
            <form onSubmit={handleSaveConfig} className="card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "#fff", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <h4 style={{ margin: 0, paddingBottom: "0.5rem", borderBottom: "1px solid #f3f4f6", fontSize: "0.95rem", color: "var(--text-strong)" }}>
                Editar Parámetros - {selectedCountryConfig}
              </h4>

              <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                
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

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "1rem", marginTop: "1rem", flexWrap: "wrap", width: "100%" }}>
                <button
                  type="button"
                  onClick={handleRestoreDefaults}
                  disabled={savingConfig}
                  style={{
                    background: "var(--color-red-10)",
                    color: "var(--color-sec-red)",
                    border: "1px solid var(--color-sec-red)",
                    padding: "0.5rem 1.25rem",
                    borderRadius: "8px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s ease"
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = "var(--color-red-20)";
                    e.currentTarget.style.borderColor = "var(--color-sec-red)";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = "rgba(239, 68, 68, 0.08)";
                    e.currentTarget.style.borderColor = "#fecaca";
                  }}
                >
                  Volver a predeterminados
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                  style={{
                    background: "var(--gradient-accent)",
                    border: "none",
                    fontWeight: 600,
                    padding: "0.5rem 1.25rem",
                    borderRadius: "8px",
                    color: "white"
                  }}
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
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* Header */}
          <div className="card glass-card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "var(--card-bg)" }}>
            <h3 style={{ margin: 0, fontSize: "1.15rem", color: "var(--text-strong)", fontFamily: "var(--display)" }}>
              📅 Gestión de Días No Laborables y Festivos
            </h3>
            <p style={{ color: "var(--text-soft)", fontSize: "0.82rem", marginTop: "0.25rem" }}>
              Visualiza los calendarios oficiales de festivos nacionales por país y registra los días festivos especiales de la empresa (feriados corporativos).
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr", gap: "2rem", alignItems: "start" }}>
            
            {/* Left Column: Official Holiday Calendar */}
            <div className="card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "#fff" }}>
              <h4 style={{ margin: 0, paddingBottom: "0.5rem", borderBottom: "1px solid #f3f4f6", fontSize: "0.95rem", color: "var(--text-strong)" }}>
                🗓️ Calendario de Festivos Oficiales
              </h4>
              
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "1rem", marginBottom: "1.25rem" }}>
                <div>
                  <label className="form-label" style={{ fontSize: "0.78rem" }}>País</label>
                  <select
                    value={calendarCountry}
                    onChange={(e) => setCalendarCountry(e.target.value)}
                    style={{ fontSize: "0.85rem", padding: "0.35rem 0.5rem" }}
                  >
                    {supportedCountries.filter(c => c !== "Default").map(c => {
                      const leg = LEGISLATIONS[c];
                      return <option key={c} value={c}>{leg ? `${leg.country} ${leg.flag}` : c}</option>;
                    })}
                    {supportedCountries.includes("Default") && <option value="Default">{LEGISLATIONS.Default?.country ?? "Default"} {LEGISLATIONS.Default?.flag ?? "🌐"}</option>}
                  </select>
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: "0.78rem" }}>Año</label>
                  <input
                    type="number"
                    min={2020}
                    max={2030}
                    value={calendarYear}
                    onChange={(e) => setCalendarYear(Number(e.target.value))}
                    style={{ fontSize: "0.85rem", padding: "0.35rem 0.5rem" }}
                  />
                </div>
              </div>

              <div style={{ maxHeight: "350px", overflowY: "auto", border: "1px solid #f3f4f6", borderRadius: "8px", padding: "0.5rem" }}>
                {loadingHolidaysList ? (
                  <div style={{ padding: "1rem", textAlign: "center", color: "#6b7280", fontSize: "0.85rem" }}>Cargando feriados...</div>
                ) : holidaysList.length === 0 ? (
                  <div style={{ padding: "1rem", textAlign: "center", color: "#6b7280", fontSize: "0.85rem" }}>No hay feriados para este año y país.</div>
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
                      <div
                        key={index}
                        style={{
                          padding: "0.5rem 0.75rem",
                          borderBottom: "1px solid #f3f4f6",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: "0.78rem"
                        }}
                      >
                        <span style={{ fontWeight: 600, color: "var(--text-strong)", textTransform: "capitalize" }}>
                          {formattedDate}
                        </span>
                        <span style={{ 
                          color: h.isCustom ? "var(--color-sec-green)" : "var(--color-accent)", 
                          background: h.isCustom ? "var(--color-green-10)" : "var(--color-accent-10)", 
                          padding: "0.15rem 0.4rem", 
                          borderRadius: "12px", 
                          fontSize: "0.72rem", 
                          border: h.isCustom ? "1px solid var(--color-sec-green)" : "1px solid var(--color-accent-20)" 
                        }}>
                          {h.name} {h.isCustom ? "🌐" : "🏛️"}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Custom Holiday Administration */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              
              {/* Form to Create Custom Holiday */}
              <form onSubmit={handleAddHoliday} className="card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "#fff" }}>
                <h4 style={{ margin: 0, paddingBottom: "0.5rem", borderBottom: "1px solid #f3f4f6", fontSize: "0.95rem", color: "var(--text-strong)" }}>
                  ➕ Agregar Feriado Corporativo / Especial
                </h4>
                
                <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", gap: "0.75rem", marginTop: "1rem", alignItems: "end" }}>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.78rem" }}>Nombre del Evento *</label>
                    <input
                      type="text"
                      required
                      placeholder="Ej. Aniversario Synaptica"
                      value={holidayName}
                      onChange={(e) => setHolidayName(e.target.value)}
                      style={{ fontSize: "0.85rem", padding: "0.35rem 0.5rem" }}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.78rem" }}>Fecha *</label>
                    <input
                      type="date"
                      required
                      value={holidayDate}
                      onChange={(e) => setHolidayDate(e.target.value)}
                      style={{ fontSize: "0.85rem", padding: "0.35rem 0.5rem" }}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: "0.78rem" }}>País / Alcance</label>
                    <select
                      value={holidayCountry}
                      onChange={(e) => setHolidayCountry(e.target.value)}
                      style={{ fontSize: "0.85rem", padding: "0.35rem 0.5rem" }}
                    >
                      <option value="All">Todos (Corporativo) 🌐</option>
                      {supportedCountries.filter(c => c !== "Default").map(c => {
                        const leg = LEGISLATIONS[c];
                        return <option key={c} value={c}>{leg ? `${leg.country} ${leg.flag}` : c}</option>;
                      })}
                    </select>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
                  <button
                    type="submit"
                    disabled={savingHoliday}
                    style={{
                      background: "var(--gradient-accent)",
                      border: "none",
                      padding: "0.45rem 1rem",
                      fontSize: "0.8rem",
                      color: "white",
                      borderRadius: "8px",
                      cursor: "pointer"
                    }}
                  >
                    {savingHoliday ? "Guardando..." : "Agregar Feriado"}
                  </button>
                </div>
              </form>

              {/* Table of Custom Holidays */}
              <div className="card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "#fff" }}>
                <h4 style={{ margin: 0, paddingBottom: "0.5rem", borderBottom: "1px solid #f3f4f6", fontSize: "0.95rem", color: "var(--text-strong)" }}>
                  📋 Feriados Corporativos Registrados
                </h4>

                <div style={{ marginTop: "1rem" }} className="table-container">
                  {loadingHolidays ? (
                    <p style={{ textAlign: "center", color: "var(--text-soft)", fontSize: "0.8rem", padding: "1rem" }}>
                      Cargando feriados...
                    </p>
                  ) : customHolidays.length === 0 ? (
                    <p style={{ textAlign: "center", color: "var(--text-soft)", fontSize: "0.8rem", padding: "1.5rem" }}>
                      No hay feriados corporativos especiales registrados.
                    </p>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                          <th style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-soft)", fontWeight: 600 }}>Nombre</th>
                          <th style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-soft)", fontWeight: 600 }}>Fecha</th>
                          <th style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-soft)", fontWeight: 600 }}>Alcance</th>
                          <th style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-soft)", fontWeight: 600, textAlign: "right" }}>Acciones</th>
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
                            <tr key={h.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                              <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-strong)", fontWeight: 600 }}>{h.name}</td>
                              <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-normal)" }}>{formattedDate}</td>
                              <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-normal)" }}>
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
                              <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", textAlign: "right" }}>
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={() => handleDeleteHoliday(h.id)}
                                  style={{
                                    color: "var(--color-sec-red)",
                                    padding: "0.25rem 0.5rem",
                                    fontSize: "0.75rem",
                                    border: "none",
                                    background: "none",
                                    cursor: "pointer"
                                  }}
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
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* Header */}
          <div className="card glass-card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "var(--card-bg)" }}>
            <h3 style={{ margin: 0, fontSize: "1.15rem", color: "var(--text-strong)", fontFamily: "var(--display)" }}>
              🤝 Delegación de Aprobaciones
            </h3>
            <p style={{ color: "var(--text-soft)", fontSize: "0.82rem", marginTop: "0.25rem" }}>
              Permite a los Directores de Proyecto (PM) delegar temporalmente la aprobación Nivel 1 a un consultor normal para un proyecto y rango de fechas específico.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr", gap: "2rem", alignItems: "start" }}>
            
            {/* Left Column: Create Delegation */}
            <form onSubmit={handleAddDelegation} className="card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "#fff", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <h4 style={{ margin: 0, paddingBottom: "0.5rem", borderBottom: "1px solid #f3f4f6", fontSize: "0.95rem", color: "var(--text-strong)" }}>
                ➕ Registrar Nueva Delegación
              </h4>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                <div>
                  <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Proyecto *</label>
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
                  <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Delegar a (Consultor) *</label>
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
                  <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Fecha Inicio *</label>
                  <input
                    type="date"
                    required
                    value={delegateStartDate}
                    onChange={(e) => setDelegateStartDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: "0.8rem", fontWeight: 700 }}>Fecha Fin *</label>
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
                disabled={savingDelegation}
                style={{
                  background: "var(--gradient-accent)",
                  border: "none",
                  marginTop: "0.5rem",
                  width: "100%",
                  color: "white",
                  borderRadius: "8px",
                  padding: "0.55rem",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                {savingDelegation ? "Guardando..." : "Delegar Aprobación"}
              </button>
            </form>

            {/* Right Column: Delegations List */}
            <div className="card" style={{ padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--border-color)", background: "#fff" }}>
              <h4 style={{ margin: 0, paddingBottom: "0.5rem", borderBottom: "1px solid #f3f4f6", fontSize: "0.95rem", color: "var(--text-strong)" }}>
                📋 Delegaciones Activas y Registradas
              </h4>

              <div style={{ marginTop: "1rem" }} className="table-container">
                {loadingDelegations ? (
                  <p style={{ textAlign: "center", color: "var(--text-soft)", fontSize: "0.8rem", padding: "1rem" }}>
                    Cargando delegaciones...
                  </p>
                ) : delegations.length === 0 ? (
                  <p style={{ textAlign: "center", color: "var(--text-soft)", fontSize: "0.8rem", padding: "1.5rem" }}>
                    No hay delegaciones de aprobación registradas.
                  </p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                        <th style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-soft)", fontWeight: 600 }}>Proyecto</th>
                        <th style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-soft)", fontWeight: 600 }}>Delegado Por</th>
                        <th style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-soft)", fontWeight: 600 }}>Delegado A</th>
                        <th style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-soft)", fontWeight: 600 }}>Rango</th>
                        <th style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-soft)", fontWeight: 600, textAlign: "right" }}>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {delegations.map((d) => {
                        const project = projects.find(p => p.id === d.projectId);
                        const startFormatted = new Date(d.startDate).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
                        const endFormatted = new Date(d.endDate).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
                        return (
                          <tr key={d.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-strong)", fontWeight: 600 }}>{project ? project.name : d.projectId}</td>
                            <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-normal)" }}>{d.fromUserEmail}</td>
                            <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-normal)", fontWeight: 600 }}>{d.toUserEmail}</td>
                            <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "var(--text-soft)" }}>{startFormatted} al {endFormatted}</td>
                            <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.78rem", textAlign: "right" }}>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => handleDeleteDelegation(d.id)}
                                style={{
                                  color: "var(--color-sec-red)",
                                  padding: "0.25rem 0.5rem",
                                  fontSize: "0.75rem",
                                  border: "none",
                                  background: "none",
                                  cursor: "pointer"
                                }}
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
