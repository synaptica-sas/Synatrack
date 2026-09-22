import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useMsal } from "@azure/msal-react";
import {
  listActivities,
  createActivity,
  updateActivity,
  deleteActivity,
  createExtraHour,
  type Project,
  type Consultant,
  type AuthUser,
  type Activity,
  type ActivityType,
  type ActivityPriority,
  type ActivityStatus,
} from "../../services/api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeader } from "../../components/PageHeader";
import { SearchableSelect } from "../../components/SearchableSelect";
import { listCustomHolidays, type CustomHoliday } from "../../services/api";
import type { TabId } from "../../types";

function MicrosoftTeamsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg fill="none" viewBox="4 4 36 38" width={size} height={size} xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path fill="url(#microsoft_teams__a)" d="M22 20h12a6 6 0 0 1 6 6v10a6 6 0 0 1-12 0V26a6 6 0 0 0-6-6Z"/>
      <path fill="url(#microsoft_teams__b)" d="M8 24a6 6 0 0 1 6-6h8a6 6 0 0 1 6 6v12a6 6 0 0 0 6 6H18c-5.523 0-10-4.477-10-10v-8Z"/>
      <path fill="url(#microsoft_teams__c)" fillOpacity=".7" d="M8 24a6 6 0 0 1 6-6h8a6 6 0 0 1 6 6v12a6 6 0 0 0 6 6H18c-5.523 0-10-4.477-10-10v-8Z"/>
      <path fill="url(#microsoft_teams__d)" fillOpacity=".7" d="M8 24a6 6 0 0 1 6-6h8a6 6 0 0 1 6 6v12a6 6 0 0 0 6 6H18c-5.523 0-10-4.477-10-10v-8Z"/>
      <path fill="url(#microsoft_teams__e)" d="M33 18a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"/>
      <path fill="url(#microsoft_teams__f)" fillOpacity=".46" d="M33 18a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"/>
      <path fill="url(#microsoft_teams__g)" fillOpacity=".4" d="M33 18a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"/>
      <path fill="url(#microsoft_teams__h)" d="M18 16a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"/>
      <path fill="url(#microsoft_teams__i)" fillOpacity=".6" d="M18 16a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"/>
      <path fill="url(#microsoft_teams__j)" fillOpacity=".5" d="M18 16a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"/>
      <rect width="16" height="16" x="4" y="23" fill="url(#microsoft_teams__k)" rx="3.25"/>
      <rect width="16" height="16" x="4" y="23" fill="url(#microsoft_teams__l)" fillOpacity=".7" rx="3.25"/>
      <path fill="#fff" d="M15.48 28.105h-2.448v7.466h-2.065v-7.466H8.52V26.43h6.96v1.676Z"/>
      <defs>
        <radialGradient id="microsoft_teams__a" cx="0" cy="0" r="1" gradientTransform="matrix(13.4784 0 0 33.2694 39.797 22.174)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A98AFF"/>
          <stop offset=".14" stopColor="#8C75FF"/>
          <stop offset=".565" stopColor="#5F50E2"/>
          <stop offset=".9" stopColor="#3C2CB8"/>
        </radialGradient>
        <radialGradient id="microsoft_teams__b" cx="0" cy="0" r="1" gradientTransform="matrix(12.1875 30.39997 -30.74442 12.3256 8.812 16.4)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#85C2FF"/>
          <stop offset=".69" stopColor="#7588FF"/>
          <stop offset="1" stopColor="#6459FE"/>
        </radialGradient>
        <radialGradient id="microsoft_teams__d" cx="0" cy="0" r="1" gradientTransform="rotate(113.326 8.093 17.645) scale(19.2186 15.4273)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#BD96FF"/>
          <stop offset=".687" stopColor="#BD96FF" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="microsoft_teams__e" cx="0" cy="0" r="1" gradientTransform="matrix(0 -10 12.6216 0 33 11.571)" gradientUnits="userSpaceOnUse">
          <stop offset=".268" stopColor="#6868F7"/>
          <stop offset="1" stopColor="#3923B1"/>
        </radialGradient>
        <radialGradient id="microsoft_teams__f" cx="0" cy="0" r="1" gradientTransform="matrix(5.47024 4.59847 -6.65117 7.91208 28.867 10.544)" gradientUnits="userSpaceOnUse">
          <stop offset=".271" stopColor="#A1D3FF"/>
          <stop offset=".813" stopColor="#A1D3FF" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="microsoft_teams__g" cx="0" cy="0" r="1" gradientTransform="rotate(-41.658 32.118 -43.42) scale(8.51275 20.8824)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E3ACFD"/>
          <stop offset=".816" stopColor="#9FA2FF" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="microsoft_teams__h" cx="0" cy="0" r="1" gradientTransform="matrix(0 -12 15.146 0 18 8.286)" gradientUnits="userSpaceOnUse">
          <stop offset=".268" stopColor="#8282FF"/>
          <stop offset="1" stopColor="#3923B1"/>
        </radialGradient>
        <radialGradient id="microsoft_teams__i" cx="0" cy="0" r="1" gradientTransform="rotate(40.052 -3.155 21.416) scale(8.57554 12.4035)" gradientUnits="userSpaceOnUse">
          <stop offset=".271" stopColor="#A1D3FF"/>
          <stop offset=".813" stopColor="#A1D3FF" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="microsoft_teams__j" cx="0" cy="0" r="1" gradientTransform="rotate(-41.658 20.382 -26.516) scale(10.2153 25.0589)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E3ACFD"/>
          <stop offset=".816" stopColor="#9FA2FF" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="microsoft_teams__k" cx="0" cy="0" r="1" gradientTransform="rotate(45 -25.763 16.328) scale(22.6274)" gradientUnits="userSpaceOnUse">
          <stop offset=".047" stopColor="#688EFF"/>
          <stop offset=".947" stopColor="#230F94"/>
        </radialGradient>
        <radialGradient id="microsoft_teams__l" cx="0" cy="0" r="1" gradientTransform="matrix(0 11.2 -13.0702 0 12 32.6)" gradientUnits="userSpaceOnUse">
          <stop offset=".571" stopColor="#6965F6" stopOpacity="0"/>
          <stop offset="1" stopColor="#8F8FFF"/>
        </radialGradient>
        <linearGradient id="microsoft_teams__c" x1="20.594" x2="20.594" y1="18" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset=".801" stopColor="#6864F6" stopOpacity="0"/>
          <stop offset="1" stopColor="#5149DE"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

type ActivitiesTabProps = {
  projects: Project[];
  consultants: Consultant[];
  authUser: AuthUser | null;
  onError: (msg: string) => void;
  onDrillTo?: (tabId: TabId) => void;
};

export function ActivitiesTab({ projects, consultants, authUser, onError, onDrillTo }: ActivitiesTabProps) {
  const [view, setView] = useState<"week" | "month" | "list" | "report">("week");
  const [reportRange, setReportRange] = useState<"week" | "month" | "all">("week");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const myConsultant = consultants.find((c) => c.email?.toLowerCase() === authUser?.email?.toLowerCase());
  const [filterConsultantId, setFilterConsultantId] = useState(myConsultant?.id || "");
  const [filterProjectId, setFilterProjectId] = useState("");
  const [filterType, setFilterType] = useState<string>("");
  const [showWeekends, setShowWeekends] = useState(false);

  // Navigation states
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  // Daily shift config state
  const [shiftStart, setShiftStart] = useState(() => localStorage.getItem("syn_shift_start") || "08:00");
  const [shiftEnd, setShiftEnd] = useState(() => localStorage.getItem("syn_shift_end") || "17:00");
  const [shiftConfigOpen, setShiftConfigOpen] = useState(false);

  const saveShiftConfig = (start: string, end: string) => {
    setShiftStart(start);
    setShiftEnd(end);
    localStorage.setItem("syn_shift_start", start);
    localStorage.setItem("syn_shift_end", end);
  };

  // Date helper utilities
  const getDaysOfWeek = (baseDate: Date) => {
    const date = new Date(baseDate);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Monday is start
    const monday = new Date(date.setDate(diff));

    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const nextDay = new Date(monday);
      nextDay.setDate(monday.getDate() + i);
      weekDays.push(nextDay);
    }
    return weekDays;
  };

  const weekDays = useMemo(() => getDaysOfWeek(selectedDate), [selectedDate]);
  
  // Activity Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [teamsModalOpen, setTeamsModalOpen] = useState(false);

  // Activity Form Fields
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formConsultantId, setFormConsultantId] = useState(myConsultant?.id || "");
  const [formProjectId, setFormProjectId] = useState("");
  const [formType, setFormType] = useState<ActivityType>("project");
  const [formDate, setFormDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [formDueDate, setFormDueDate] = useState("");
  const [formEstimatedHours, setFormEstimatedHours] = useState("2");
  const [formActualHours, setFormActualHours] = useState("0");
  const [formStatus, setFormStatus] = useState<ActivityStatus>("pending");
  const [formPriority, setFormPriority] = useState<ActivityPriority>("medium");
  const [formComments, setFormComments] = useState("");

  // Extra Hours integration fields
  const [isExtraHoursEligible, setIsExtraHoursEligible] = useState(false);
  const [applyForExtraHours, setApplyForExtraHours] = useState(false);
  const [extraHoursStartTime, setExtraHoursStartTime] = useState("18:00");
  const [extraHoursEndTime, setExtraHoursEndTime] = useState("20:00");
  const [extraHoursNote, setExtraHoursNote] = useState("");

  interface TeamsEvent {
    id: string;
    subject: string;
    start: string;
    end: string;
    bodyPreview: string;
    duration: number;
    isImported?: boolean;
  }

  // Teams synchronization states
  const [syncEvents, setSyncEvents] = useState<TeamsEvent[]>([]);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncSelectedIds, setSyncSelectedIds] = useState<string[]>([]);
  const [syncProjectId, setSyncProjectId] = useState("");
  const [syncConsultantId, setSyncConsultantId] = useState("");
  const [syncingInProgress, setSyncingInProgress] = useState(false);

  const { instance, accounts } = useMsal();

  const loadTeamsEvents = useCallback(async (targetConsId: string) => {
    if (!targetConsId) return;
    setSyncLoading(true);
    setSyncSelectedIds([]);
    try {
      const startISO = weekDays[0].toISOString();
      const endISO = weekDays[6].toISOString();

      let fetchedEvents: TeamsEvent[] = [];
      let isRealMsal = false;

      // Try calling MS Graph if authenticated and scopes available
      if (accounts.length > 0) {
        try {
          const tokenResponse = await instance.acquireTokenSilent({
            scopes: ["Calendars.Read"],
            account: accounts[0]
          });
          const token = tokenResponse.accessToken;
          
          const response = await fetch(
            `https://graph.microsoft.com/v1.0/me/calendar/events?$orderby=start/dateTime&$filter=start/dateTime ge '${startISO}' and end/dateTime le '${endISO}'&$select=id,subject,start,end,bodyPreview`,
            {
              headers: { Authorization: `Bearer ${token}` }
            }
          );
          if (response.ok) {
            const data = await response.json();
            fetchedEvents = (data.value || []).map((ev: { id: string; subject: string; start: { dateTime: string }; end: { dateTime: string }; bodyPreview?: string }) => {
              const start = new Date(ev.start.dateTime);
              const end = new Date(ev.end.dateTime);
              const duration = Math.max(0.5, Math.round(((end.getTime() - start.getTime()) / (1000 * 60 * 60)) * 2) / 2);
              return {
                id: ev.id,
                subject: ev.subject,
                start: ev.start.dateTime,
                end: ev.end.dateTime,
                bodyPreview: ev.bodyPreview || "",
                duration
              };
            });
            isRealMsal = true;
          }
        } catch (err) {
          console.warn("MSAL Silent Token acquisition for Graph failed, using mock data.", err);
        }
      }

      if (!isRealMsal) {
        // Fallback to high-fidelity mock events customized for the selected consultant
        const targetCons = consultants.find(c => c.id === targetConsId);
        const consName = targetCons ? targetCons.fullName : "Consultor";

        const mockMeetings = [
          {
            id: `mock-${targetConsId}-1`,
            subject: `Daily Standup - ${consName}`,
            start: new Date(weekDays[0].getTime()).toISOString().replace(/T.*/, "T09:00:00.000Z"),
            end: new Date(weekDays[0].getTime()).toISOString().replace(/T.*/, "T09:30:00.000Z"),
            bodyPreview: `Sincronización diaria de ${consName} para revisar el tablero Kanban y avances del sprint.`,
            duration: 0.5
          },
          {
            id: `mock-${targetConsId}-2`,
            subject: `Revisión de Requerimientos - ${consName}`,
            start: new Date(weekDays[0].getTime()).toISOString().replace(/T.*/, "T14:00:00.000Z"),
            end: new Date(weekDays[0].getTime()).toISOString().replace(/T.*/, "T15:30:00.000Z"),
            bodyPreview: `Sesión de refinamiento y detalle técnico de requerimientos asignados a ${consName}.`,
            duration: 1.5
          },
          {
            id: `mock-${targetConsId}-3`,
            subject: `Demo de Avance Sprint - ${consName}`,
            start: new Date(weekDays[1].getTime()).toISOString().replace(/T.*/, "T10:00:00.000Z"),
            end: new Date(weekDays[1].getTime()).toISOString().replace(/T.*/, "T11:00:00.000Z"),
            bodyPreview: `Presentación a stakeholders de los entregables desarrollados por ${consName}.`,
            duration: 1.0
          },
          {
            id: `mock-${targetConsId}-4`,
            subject: `Reunión Técnica con Cliente (${consName.split(" ")[0]})`,
            start: new Date(weekDays[2].getTime()).toISOString().replace(/T.*/, "T15:00:00.000Z"),
            end: new Date(weekDays[2].getTime()).toISOString().replace(/T.*/, "T16:30:00.000Z"),
            bodyPreview: `Alineación de arquitectura y seguridad de datos para el módulo de facturación.`,
            duration: 1.5
          },
          {
            id: `mock-${targetConsId}-5`,
            subject: `Capacitación: Seguridad en Nube`,
            start: new Date(weekDays[3].getTime()).toISOString().replace(/T.*/, "T11:00:00.000Z"),
            end: new Date(weekDays[3].getTime()).toISOString().replace(/T.*/, "T12:00:00.000Z"),
            bodyPreview: `Buenas prácticas de IAM y rotación de credenciales.`,
            duration: 1.0
          },
          {
            id: `mock-${targetConsId}-6`,
            subject: `Alineación Semanal de Equipo`,
            start: new Date(weekDays[4].getTime()).toISOString().replace(/T.*/, "T14:00:00.000Z"),
            end: new Date(weekDays[4].getTime()).toISOString().replace(/T.*/, "T16:00:00.000Z"),
            bodyPreview: `Cierre de semana, lecciones aprendidas y retrospectiva del equipo de desarrollo.`,
            duration: 2.0
          }
        ];
        fetchedEvents = mockMeetings;
      }

      // Check if any event has already been imported
      const enrichedEvents = fetchedEvents.map(ev => {
        const isImported = activities.some(act => 
          act.title.toLowerCase() === ev.subject.toLowerCase() && 
          act.scheduledDate.slice(0, 10) === ev.start.slice(0, 10) &&
          act.consultantId === targetConsId
        );
        return { ...ev, isImported };
      });

      setSyncEvents(enrichedEvents);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al cargar reuniones de Teams");
    } finally {
      setSyncLoading(false);
    }
  }, [weekDays, activities, accounts, instance, onError, consultants]);

  // Set initial sync consultant ID
  useEffect(() => {
    if (teamsModalOpen) {
      if (accounts.length > 0 && myConsultant) {
        setSyncConsultantId(myConsultant.id);
      } else {
        const initialConsId = filterConsultantId || myConsultant?.id || consultants[0]?.id || "";
        setSyncConsultantId(initialConsId);
      }
    }
  }, [teamsModalOpen, filterConsultantId, myConsultant, consultants, accounts]);

  // Load events when modal opens OR selected consultant changes
  useEffect(() => {
    if (teamsModalOpen && syncConsultantId) {
      void loadTeamsEvents(syncConsultantId);
    }
  }, [teamsModalOpen, syncConsultantId, loadTeamsEvents]);

  const handleImportMeetings = async () => {
    if (syncSelectedIds.length === 0) {
      onError("Por favor selecciona al menos una reunión.");
      return;
    }
    const consultantId = syncConsultantId;
    if (!consultantId) {
      onError("Por favor selecciona un consultor para asignar estas reuniones.");
      return;
    }

    setSyncingInProgress(true);
    try {
      const selectedEvents = syncEvents.filter(ev => syncSelectedIds.includes(ev.id));
      for (const ev of selectedEvents) {
        await createActivity({
          title: ev.subject,
          description: ev.bodyPreview ? ev.bodyPreview.slice(0, 200) : "Importado desde Microsoft Teams",
          consultantId,
          projectId: syncProjectId || null,
          activityType: "meeting",
          scheduledDate: new Date(ev.start).toISOString(),
          dueDate: new Date(ev.end).toISOString(),
          estimatedHours: ev.duration,
          actualHours: ev.duration,
          status: "completed",
          priority: "medium",
          comments: "Importado automáticamente de Teams"
        });
      }
      
      setTeamsModalOpen(false);
      await loadActivities();
      setSuccessMessage(`¡Se importaron ${selectedEvents.length} reuniones como actividades exitosamente!`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al importar reuniones");
    } finally {
      setSyncingInProgress(false);
    }
  };

  const formatMeetingTime = (startStr: string, endStr: string) => {
    const start = new Date(startStr);
    const end = new Date(endStr);
    const weekday = start.toLocaleDateString("es-CO", { weekday: "short" });
    const day = start.getDate();
    const month = start.toLocaleDateString("es-CO", { month: "short" });
    const startTimeStr = start.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });
    const endTimeStr = end.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });
    return `${weekday} ${day} de ${month}, ${startTimeStr} - ${endTimeStr}`;
  };

  // Loading/submitting states
  const [submitting, setSubmitting] = useState(false);
  const [holidays, setHolidays] = useState<CustomHoliday[]>([]);

  useEffect(() => {
    const fetchHolidays = async () => {
      try {
        const data = await listCustomHolidays();
        setHolidays(data);
      } catch {
        // fail silently
      }
    };
    void fetchHolidays();
  }, []);

  // Helper to check if a YYYY-MM-DD date string is a weekend or holiday
  const checkIsWeekendOrHoliday = useCallback((dateStr: string) => {
    if (!dateStr) return { isWeekend: false, isHoliday: false, isWeekendOrHoliday: false, label: "" };
    const dateObj = new Date(dateStr);
    const dayOfWeek = dateObj.getUTCDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // Match date part only
    const isHoliday = holidays.some((h) => h.date.slice(0, 10) === dateStr);
    const holidayName = holidays.find((h) => h.date.slice(0, 10) === dateStr)?.name || "";
    
    return {
      isWeekend,
      isHoliday,
      isWeekendOrHoliday: isWeekend || isHoliday,
      label: isWeekend ? (dayOfWeek === 0 ? "Domingo" : "Sábado") : (isHoliday ? `Festivo: ${holidayName}` : "")
    };
  }, [holidays]);

  // Success message and confirmation states
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [activityToDelete, setActivityToDelete] = useState<string | null>(null);

  // Fetch activities
  const loadActivities = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listActivities({
        consultantId: filterConsultantId || undefined,
        projectId: filterProjectId || undefined,
      });
      setActivities(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al cargar actividades");
    } finally {
      setLoading(false);
    }
  }, [filterConsultantId, filterProjectId, onError]);

  useEffect(() => {
    void loadActivities();
  }, [loadActivities]);

  // Set default consultant if loaded
  useEffect(() => {
    if (myConsultant && !filterConsultantId) {
      setFilterConsultantId(myConsultant.id);
    }
    if (myConsultant && !formConsultantId) {
      setFormConsultantId(myConsultant.id);
    }
  }, [consultants, myConsultant, filterConsultantId, formConsultantId]);

  // Date helper utilities (moved above)

  // Change selected week
  const navigateWeek = (weeks: number) => {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + weeks * 7);
      return next;
    });
  };

  // Change selected month
  const navigateMonth = (months: number) => {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setMonth(prev.getMonth() + months);
      return next;
    });
  };

  // Group activities by date key YYYY-MM-DD
  const activitiesByDate = useMemo(() => {
    const map = new Map<string, Activity[]>();
    activities.forEach((act) => {
      const dateKey = act.scheduledDate.slice(0, 10);
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(act);
    });
    return map;
  }, [activities]);

  // Handle open modal for creation
  const handleOpenAddModal = (dateStr?: string) => {
    setEditingActivity(null);
    setFormTitle("");
    setFormDescription("");
    setFormConsultantId(myConsultant?.id || filterConsultantId || consultants[0]?.id || "");
    setFormProjectId("");
    setFormType("project");
    setFormDate(dateStr || new Date().toISOString().split("T")[0]);
    setFormDueDate("");
    setFormEstimatedHours("2");
    setFormActualHours("0");
    setFormStatus("pending");
    setFormPriority("medium");
    setFormComments("");
    setIsExtraHoursEligible(false);
    setApplyForExtraHours(false);
    setExtraHoursNote("");
    setModalOpen(true);
  };

  // Handle open modal for edit
  const handleOpenEditModal = (act: Activity) => {
    setEditingActivity(act);
    setFormTitle(act.title);
    setFormDescription(act.description || "");
    setFormConsultantId(act.consultantId);
    setFormProjectId(act.projectId || "");
    setFormType(act.activityType);
    setFormDate(act.scheduledDate.slice(0, 10));
    setFormDueDate(act.dueDate ? act.dueDate.slice(0, 10) : "");
    setFormEstimatedHours(Number(act.estimatedHours).toString());
    setFormActualHours(Number(act.actualHours).toString());
    setFormStatus(act.status);
    setFormPriority(act.priority);
    setFormComments(act.comments || "");
    setIsExtraHoursEligible(false);
    setApplyForExtraHours(false);
    setExtraHoursNote("");
    setModalOpen(true);
  };

  // Extra hours eligibility live check
  useEffect(() => {
    const actual = Number(formActualHours || 0);
    const dateObj = new Date(formDate);
    // Date standard getDay() returns 0 for Sunday, 6 for Saturday.
    const isSatOrSun = dateObj.getUTCDay() === 0 || dateObj.getUTCDay() === 6;
    
    // Check if eligible: actual > 8 OR weekend OR is training/support that might apply
    if (actual > 8 || isSatOrSun) {
      setIsExtraHoursEligible(true);
      // Pre-fill extra hours note
      setExtraHoursNote(`Horas extras automáticas de la actividad: ${formTitle || "Registro de actividad"}`);
      // Calculate default end time based on actual hours (e.g. 18:00 to 18:00 + actualHours - 8)
      if (actual > 8) {
        const extraHours = actual - 8;
        setExtraHoursStartTime("18:00");
        const endHour = 18 + extraHours;
        setExtraHoursEndTime(`${endHour.toString().padStart(2, "0")}:00`);
      } else {
        setExtraHoursStartTime("08:00");
        const endHour = 8 + actual;
        setExtraHoursEndTime(`${endHour.toString().padStart(2, "0")}:00`);
      }
    } else {
      setIsExtraHoursEligible(false);
      setApplyForExtraHours(false);
    }
  }, [formActualHours, formDate, formTitle]);

  // Handle submit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      onError("Por favor ingresa un título.");
      return;
    }
    if (!formConsultantId) {
      onError("Por favor selecciona un consultor.");
      return;
    }

    // Past date check for extra hours automatic request
    if (applyForExtraHours && formProjectId) {
      const isManager = authUser?.roles.includes("ADMIN") || authUser?.roles.includes("PM");
      if (!isManager) {
        const todayStr = new Date().toLocaleDateString("en-CA");
        if (formDate < todayStr) {
          onError("No se pueden solicitar horas extra para días anteriores al actual.");
          return;
        }
      }
    }

    // Weekend and Holiday validation
    const dateCheck = checkIsWeekendOrHoliday(formDate);
    const selectedConsultant = consultants.find((c) => c.id === formConsultantId);
    if (dateCheck.isWeekendOrHoliday) {
      const isAdminOrPM = authUser?.roles.includes("ADMIN") || authUser?.roles.includes("PM");
      const hasWeekendPermission = selectedConsultant?.allowWeekendWork === true || isAdminOrPM;
      
      if (!hasWeekendPermission) {
        onError(`El consultor ${selectedConsultant?.fullName || ""} no está autorizado para registrar actividades en fines de semana o festivos (${dateCheck.label}).`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        title: formTitle.trim(),
        description: formDescription.trim() || null,
        consultantId: formConsultantId,
        projectId: formProjectId || null,
        activityType: formType,
        scheduledDate: new Date(formDate).toISOString(),
        dueDate: formDueDate ? new Date(formDueDate).toISOString() : null,
        completedDate: formStatus === "completed" ? new Date().toISOString() : null,
        estimatedHours: Number(formEstimatedHours),
        actualHours: Number(formActualHours),
        status: formStatus,
        priority: formPriority,
        comments: formComments.trim() || null,
      };

      if (editingActivity) {
        await updateActivity(editingActivity.id, payload);
      } else {
        await createActivity(payload);
      }

      // If user opted to submit extra hours automatically
      if (applyForExtraHours && formProjectId) {
        // Validate project allows extra hours
        const selectedProj = projects.find((p) => p.id === formProjectId);
        if (selectedProj && selectedProj.allowExtraHours !== false) {
          await createExtraHour({
            projectId: formProjectId,
            consultantId: formConsultantId,
            date: formDate,
            startTime: extraHoursStartTime,
            endTime: extraHoursEndTime,
            observations: extraHoursNote.trim() || undefined
          });
        }
      }

      setModalOpen(false);
      await loadActivities();
      setSuccessMessage(applyForExtraHours 
        ? "¡Actividad y solicitud de horas extras registradas con éxito!" 
        : "Actividad guardada con éxito."
      );
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al guardar actividad");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle delete activity click
  const handleDeleteClick = (id: string) => {
    setActivityToDelete(id);
    setDeleteConfirmOpen(true);
  };

  // Handle confirm delete
  const handleConfirmDelete = async () => {
    if (!activityToDelete) return;
    try {
      await deleteActivity(activityToDelete);
      setSuccessMessage("Actividad eliminada con éxito.");
      setTimeout(() => setSuccessMessage(null), 4000);
      await loadActivities();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error al eliminar actividad");
    } finally {
      setDeleteConfirmOpen(false);
      setActivityToDelete(null);
    }
  };

  // Monthly calendar days rendering helper
  const monthDays = useMemo(() => {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sunday
    // Adjust for Monday as 1st day of week:
    // Sunday (0) -> index 6
    // Monday (1) -> index 0, Tuesday (2) -> index 1 etc.
    const startOffset = firstDayIndex === 0 ? 6 : firstDayIndex - 1;
    
    const lastDay = new Date(year, month + 1, 0).getDate();
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    const days = [];
    
    // Previous month padding days
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevMonthLastDay - i);
      days.push({ date: d, currentMonth: false });
    }

    // Current month days
    for (let i = 1; i <= lastDay; i++) {
      const d = new Date(year, month, i);
      days.push({ date: d, currentMonth: true });
    }

    // Next month padding days to make it multiples of 7 (full week rows)
    const remaining = 42 - days.length; // standard 6 rows of 7 days
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      days.push({ date: d, currentMonth: false });
    }

    return days;
  }, [selectedDate]);

  const monthLabel = selectedDate.toLocaleString("es-CO", { month: "long", year: "numeric" });

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "urgent": return { label: "Urgente", bg: "var(--state-danger-bg)", color: "var(--state-danger-text)" };
      case "high": return { label: "Alta", bg: "var(--state-warning-bg)", color: "var(--state-warning-text)" };
      case "medium": return { label: "Media", bg: "var(--state-info-bg)", color: "var(--state-info-text)" };
      case "low": return { label: "Baja", bg: "var(--state-neutral-bg)", color: "var(--state-neutral-text)" };
      default: return { label: priority, bg: "var(--state-neutral-bg)", color: "var(--state-neutral-text)" };
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "completed": return { label: "Completado", bg: "var(--state-success-bg)", color: "var(--state-success-text)" };
      case "in_progress": return { label: "En Progreso", bg: "var(--state-info-bg)", color: "var(--state-info-text)" };
      case "pending": return { label: "Pendiente", bg: "var(--state-warning-bg)", color: "var(--state-warning-text)" };
      case "blocked": return { label: "Bloqueado", bg: "var(--state-danger-bg)", color: "var(--state-danger-text)" };
      case "cancelled": return { label: "Cancelado", bg: "var(--state-neutral-bg)", color: "var(--state-neutral-text)" };
      default: return { label: status, bg: "var(--state-neutral-bg)", color: "var(--state-neutral-text)" };
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "project": return "💻 Proyecto";
      case "personal": return "👤 Personal";
      case "meeting": return "🤝 Reunión";
      case "training": return "📚 Capacitación";
      case "support": return "🔧 Soporte";
      default: return "📝 Otros";
    }
  };

  // Filter list activities in frontend too for search filters
  const filteredActivities = useMemo(() => {
    return activities.filter((act) => {
      if (filterType && act.activityType !== filterType) return false;
      return true;
    });
  }, [activities, filterType]);

  const reportActivities = useMemo(() => {
    return activities.filter((act) => {
      const actDate = new Date(act.scheduledDate);
      if (reportRange === "week") {
        const start = new Date(weekDays[0]);
        start.setHours(0, 0, 0, 0);
        const end = new Date(weekDays[6]);
        end.setHours(23, 59, 59, 999);
        return actDate >= start && actDate <= end;
      }
      if (reportRange === "month") {
        return actDate.getFullYear() === selectedDate.getFullYear() && actDate.getMonth() === selectedDate.getMonth();
      }
      return true;
    });
  }, [activities, reportRange, weekDays, selectedDate]);

  const reportStats = useMemo(() => {
    let totalActualHours = 0;
    let totalEstimatedHours = 0;
    const hoursByProject: Record<string, number> = {};
    const hoursByType: Record<string, number> = {};
    const hoursByConsultant: Record<string, { name: string; hours: number; email: string; actsCount: number; weekendWork: boolean }> = {};
    let completedCount = 0;
    let totalCount = 0;

    for (const act of reportActivities) {
      const actHours = Number(act.actualHours || 0);
      const estHours = Number(act.estimatedHours || 0);
      totalActualHours += actHours;
      totalEstimatedHours += estHours;
      totalCount++;
      if (act.status === "completed") completedCount++;

      // Project breakdown
      const projName = act.project?.name || "Sin Proyecto / Personal";
      hoursByProject[projName] = (hoursByProject[projName] || 0) + actHours;

      // Type breakdown
      const typeLabel = getTypeLabel(act.activityType);
      hoursByType[typeLabel] = (hoursByType[typeLabel] || 0) + actHours;

      // Consultant breakdown
      const consName = consultants.find((c) => c.id === act.consultantId)?.fullName || "Desconocido";
      const consEmail = consultants.find((c) => c.id === act.consultantId)?.email || "";
      const actDate = new Date(act.scheduledDate);
      const isWeekend = actDate.getUTCDay() === 0 || actDate.getUTCDay() === 6;
      const dateKeyStr = act.scheduledDate.slice(0, 10);
      const isHoli = holidays.some((h) => h.date.slice(0, 10) === dateKeyStr);

      if (!hoursByConsultant[act.consultantId]) {
        hoursByConsultant[act.consultantId] = {
          name: consName,
          hours: 0,
          email: consEmail,
          actsCount: 0,
          weekendWork: false
        };
      }
      hoursByConsultant[act.consultantId].hours += actHours;
      hoursByConsultant[act.consultantId].actsCount++;
      if (isWeekend || isHoli) {
        hoursByConsultant[act.consultantId].weekendWork = true;
      }
    }

    return {
      totalActualHours,
      totalEstimatedHours,
      hoursByProject,
      hoursByType,
      hoursByConsultant,
      completedPct: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
      totalCount,
    };
  }, [reportActivities, consultants, holidays]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", padding: "1rem 2rem" }}>
      
      <PageHeader
        icon="▤"
        title="Registro de Actividades"
        description="Realiza el tracking de tus actividades del día o semana, con alertas integradas de horas extras."
        actions={
          <>
            {/* View Toggle */}
            <div style={{ display: "flex", background: "var(--card-bg)", padding: "0.2rem", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
              <button
                type="button"
                className={view === "week" ? "" : "ghost"}
                onClick={() => setView("week")}
                style={{ fontSize: "0.82rem", padding: "0.3rem 0.6rem", border: "none" }}
              >
                Semana
              </button>
              <button
                type="button"
                className={view === "month" ? "" : "ghost"}
                onClick={() => setView("month")}
                style={{ fontSize: "0.82rem", padding: "0.3rem 0.6rem", border: "none" }}
              >
                Mes
              </button>
              <button
                type="button"
                className={view === "list" ? "" : "ghost"}
                onClick={() => setView("list")}
                style={{ fontSize: "0.82rem", padding: "0.3rem 0.6rem", border: "none" }}
              >
                Lista
              </button>
              {(authUser?.roles.includes("ADMIN") || authUser?.roles.includes("PM")) && (
                <button
                  type="button"
                  className={view === "report" ? "" : "ghost"}
                  onClick={() => setView("report")}
                  style={{ fontSize: "0.82rem", padding: "0.3rem 0.6rem", border: "none" }}
                >
                  📈 Reporte
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleOpenAddModal()}
              style={{
                background: "var(--gradient-accent)",
                color: "#fff",
                border: "none",
                fontSize: "0.85rem",
                padding: "0.5rem 1rem",
                borderRadius: "8px",
                boxShadow: "0 2px 8px rgba(241, 163, 35, 0.2)",
                cursor: "pointer"
              }}
            >
              ➕ Registrar Actividad
            </button>
          </>
        }
      />

      {/* Global Filters Panel */}
      <div className="card glass-card filters-panel" style={{ position: "relative", zIndex: 20, padding: "1rem", borderRadius: "12px", border: "1px solid var(--border-color)", display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        {(authUser?.roles.includes("ADMIN") || authUser?.roles.includes("PM") || authUser?.roles.includes("FINANCE")) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "220px" }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-soft)" }}>Filtrar por Consultor</label>
            <SearchableSelect
              options={consultants.map((c) => ({ value: c.id, label: c.fullName }))}
              value={filterConsultantId}
              onChange={(val) => setFilterConsultantId(val)}
              placeholder="Buscar consultor..."
              emptyLabel="-- Todos los Consultores --"
            />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "180px" }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-soft)" }}>Consultor</label>
            <input
              type="text"
              readOnly
              value={myConsultant ? myConsultant.fullName : authUser?.displayName || ""}
              style={{ padding: "0.6rem 0.75rem", borderRadius: "10px", background: "var(--state-neutral-bg)", border: "1px solid var(--border-color)", color: "var(--text)", fontSize: "0.88rem" }}
            />
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "220px" }}>
          <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-soft)" }}>Filtrar por Proyecto</label>
          <SearchableSelect
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            value={filterProjectId}
            onChange={(val) => setFilterProjectId(val)}
            placeholder="Buscar proyecto..."
            emptyLabel="-- Todos los Proyectos --"
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "150px" }}>
          <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-soft)" }}>Tipo Actividad</label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            style={{ padding: "0.4rem", borderRadius: "6px" }}
          >
            <option value="">-- Todos --</option>
            <option value="project">Proyecto</option>
            <option value="personal">Personal</option>
            <option value="meeting">Reunión</option>
            <option value="training">Capacitación</option>
            <option value="support">Soporte</option>
            <option value="other">Otros</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => { setFilterProjectId(""); setFilterType(""); setFilterConsultantId(myConsultant?.id || ""); setSelectedDate(new Date()); }}
          className="ghost"
          style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}
        >
          Limpiar filtros
        </button>

        <button
          type="button"
          onClick={() => setShiftConfigOpen(!shiftConfigOpen)}
          className="ghost"
          style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}
        >
          ⚙️ Jornada: {shiftStart} - {shiftEnd}
        </button>

        <div style={{ marginLeft: "auto", display: "flex", gap: "0.75rem", alignItems: "center" }} className="flex-right-mobile-full">
          <button
            type="button"
            onClick={() => onDrillTo && onDrillTo("extraHours")}
            style={{
              background: "var(--state-warning-bg)",
              color: "var(--state-warning-text)",
              border: "1px solid var(--state-warning-border)",
              fontSize: "0.85rem",
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem"
            }}
          >
            ⏳ Solicitar Horas Extra
          </button>

          <button
            type="button"
            onClick={() => setTeamsModalOpen(true)}
            style={{
              background: "var(--state-info-bg)",
              color: "var(--state-info-text)",
              border: "1px solid var(--state-info-border)",
              fontSize: "0.85rem",
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "0.45rem",
              transition: "all 0.15s ease",
              boxShadow: "0 2px 4px rgba(79, 89, 201, 0.08)"
            }}
            className="teams-sync-btn"
          >
            <MicrosoftTeamsIcon size={16} /> Sincronizar Teams
          </button>
        </div>
      </div>

      {shiftConfigOpen && (
        <div className="card glass-card" style={{ padding: "0.75rem 1rem", border: "1px solid var(--border-color)", marginTop: "-0.5rem", marginBottom: "0.5rem", display: "flex", gap: "1rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--color-accent)" }}>Configuración de Jornada Normal:</span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <label style={{ fontSize: "0.75rem", color: "var(--text-soft)" }}>Inicio:</label>
            <select
              value={shiftStart}
              onChange={(e) => saveShiftConfig(e.target.value, shiftEnd)}
              style={{ padding: "0.25rem 0.5rem", borderRadius: "6px", fontSize: "0.8rem" }}
            >
              {["06:00", "07:00", "08:00", "09:00", "10:00"].map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <label style={{ fontSize: "0.75rem", color: "var(--text-soft)" }}>Fin:</label>
            <select
              value={shiftEnd}
              onChange={(e) => saveShiftConfig(shiftStart, e.target.value)}
              style={{ padding: "0.25rem 0.5rem", borderRadius: "6px", fontSize: "0.8rem" }}
            >
              {["15:00", "16:00", "17:00", "18:00", "19:00", "20:00"].map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <button
            type="button"
            className="ghost"
            onClick={() => setShiftConfigOpen(false)}
            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", marginLeft: "auto" }}
          >
            Listo
          </button>
        </div>
      )}

      {/* --- WEEK CALENDAR VIEW --- */}
      {view === "week" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          
          {/* Week Selector Controls */}
          <div className="nav-bar-week" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--card-bg)", padding: "0.75rem 1rem", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className="ghost" onClick={() => navigateWeek(-1)} style={{ padding: "0.3rem 0.6rem" }}>◀ Semana anterior</button>
              <button type="button" className="ghost" onClick={() => setSelectedDate(new Date())} style={{ padding: "0.3rem 0.6rem", fontWeight: 700 }}>📅 Hoy</button>
            </div>
            <strong style={{ fontSize: "1rem", color: "var(--text-strong)" }}>
              Semana del {weekDays[0].toLocaleDateString("es-CO", { day: "numeric", month: "short" })} al {(showWeekends ? weekDays[6] : weekDays[4]).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })}
            </strong>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className={`ghost ${showWeekends ? "active" : ""}`}
                onClick={() => setShowWeekends(!showWeekends)}
                style={{ padding: "0.3rem 0.6rem", display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.82rem" }}
              >
                {showWeekends ? "👁️ Ocultar Finde" : "👁️ Mostrar Finde"}
              </button>
              <button type="button" className="ghost" onClick={() => navigateWeek(1)} style={{ padding: "0.3rem 0.6rem" }}>Semana siguiente ▶</button>
            </div>
          </div>

          {loading ? (
            <p className="loading">Cargando actividades...</p>
          ) : (
            <div className={`week-grid ${showWeekends ? "" : "five-days"}`}>
              {weekDays
                .filter((_, idx) => showWeekends || (idx !== 5 && idx !== 6))
                .map((day) => {
                const dateKey = day.toISOString().slice(0, 10);
                const dayCheck = checkIsWeekendOrHoliday(dateKey);
                const isWeekendOrHoli = dayCheck.isWeekendOrHoliday;
                const activeConsultantId = filterConsultantId || myConsultant?.id || "";
                const activeConsultant = consultants.find((c) => c.id === activeConsultantId);
                const isAdminOrPM = authUser?.roles.includes("ADMIN") || authUser?.roles.includes("PM");
                const isDayBlocked = isWeekendOrHoli && !(activeConsultant?.allowWeekendWork || isAdminOrPM);

                const dayActivities = activitiesByDate.get(dateKey) || [];
                const totalActualHours = dayActivities.reduce((sum, a) => sum + Number(a.actualHours), 0);
                const isOvertime = totalActualHours > 8 || isWeekendOrHoli;

                return (
                  <div
                    key={dateKey}
                    className={`week-column-card${isDayBlocked ? " is-blocked" : ""}`}
                  >
                    {/* Day Header */}
                    <div className="week-column-header">
                      <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", color: "var(--text-soft)" }}>
                        {day.toLocaleString("es-CO", { weekday: "short" })}
                      </span>
                      <strong style={{ display: "block", fontSize: "1.3rem", color: "var(--text-strong)" }}>
                        {day.getDate()}
                      </strong>
                      
                      {/* Day Stats */}
                      <div style={{ marginTop: "0.3rem", display: "flex", justifyContent: "center", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                        <span className="week-column-stat-pill">
                          ⏱️ {totalActualHours}h
                        </span>
                        {isOvertime && totalActualHours > 0 && (
                          <span
                            title={dayCheck.isHoliday ? `Festivo: ${dayCheck.label}` : "Supera las 8h o es fin de semana. Aplica a horas extra."}
                            className="pill warn"
                            style={{ cursor: "help", fontSize: "0.62rem", padding: "0.1rem 0.35rem", fontWeight: 700 }}
                          >
                            ⚠️ HE
                          </span>
                        )}
                        {dayCheck.isHoliday && (
                          <span
                            title={dayCheck.label}
                            className="pill error"
                            style={{ cursor: "help", fontSize: "0.62rem", padding: "0.1rem 0.35rem", fontWeight: 700 }}
                          >
                            🎉 Festivo
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Day Activities List */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flexGrow: 1, overflowY: "auto", maxHeight: "250px" }}>
                      {dayActivities.length === 0 ? (
                        <span style={{ color: "var(--text-soft)", fontStyle: "italic", fontSize: "0.72rem", textAlign: "center", marginTop: "2rem", display: "block" }}>
                          Sin actividades
                        </span>
                      ) : (
                        dayActivities.map((act) => {
                          const prio = getPriorityBadge(act.priority);
                          return (
                            <div
                              key={act.id}
                              onClick={() => handleOpenEditModal(act)}
                              className={`day-activity-item ${act.activityType === "personal" ? "personal" : ""}`}
                            >
                              <strong style={{ display: "block", fontSize: "0.75rem", color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {act.title}
                              </strong>
                              <span style={{ fontSize: "0.68rem", color: "var(--text-soft)" }}>
                                {act.project?.name || getTypeLabel(act.activityType)}
                              </span>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.3rem" }}>
                                <span style={{ fontSize: "0.65rem", padding: "0.05rem 0.25rem", borderRadius: "3px", background: prio.bg, color: prio.color }}>
                                  {prio.label}
                                </span>
                                <span style={{ fontSize: "0.7rem", fontWeight: 700 }}>
                                  {Number(act.actualHours).toFixed(1)}h
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Add Activity Button per Day */}
                    {isDayBlocked ? (
                      <div className="day-blocked-label">
                        🔒 Bloqueado
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => handleOpenAddModal(dateKey)}
                        style={{ width: "100%", padding: "0.25rem", fontSize: "0.72rem", marginTop: "0.5rem" }}
                      >
                        + Registrar
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* --- MONTH SUMMARY CALENDAR VIEW --- */}
      {view === "month" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          
          {/* Month Navigator */}
          <div className="nav-bar-week" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--card-bg)", padding: "0.75rem 1rem", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className="ghost" onClick={() => navigateMonth(-1)} style={{ padding: "0.3rem 0.6rem" }}>◀ Mes anterior</button>
              <button type="button" className="ghost" onClick={() => setSelectedDate(new Date())} style={{ padding: "0.3rem 0.6rem", fontWeight: 700 }}>📅 Hoy</button>
            </div>
            <strong style={{ fontSize: "1rem", color: "var(--text-strong)", textTransform: "capitalize" }}>
              {monthLabel}
            </strong>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className={`ghost ${showWeekends ? "active" : ""}`}
                onClick={() => setShowWeekends(!showWeekends)}
                style={{ padding: "0.3rem 0.6rem", display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.82rem" }}
              >
                {showWeekends ? "👁️ Ocultar Finde" : "👁️ Mostrar Finde"}
              </button>
              <button type="button" className="ghost" onClick={() => navigateMonth(1)} style={{ padding: "0.3rem 0.6rem" }}>Mes siguiente ▶</button>
            </div>
          </div>

          {loading ? (
            <p className="loading">Cargando...</p>
          ) : (
            <div className="month-grid-wrapper">
              {/* Day header names */}
              <div className={`month-grid-header ${showWeekends ? "" : "five-days"}`}>
                {["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
                  .filter((_, idx) => showWeekends || (idx !== 5 && idx !== 6))
                  .map((dayName) => (
                    <span key={dayName} style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-soft)" }}>
                      <span className="hide-mobile">{dayName}</span>
                      <span className="show-mobile-only">{dayName.slice(0, dayName.startsWith("Mié") ? 3 : 2)}</span>
                    </span>
                  ))}
              </div>

              {/* Grid of days */}
              <div className={`month-grid-body ${showWeekends ? "" : "five-days"}`}>
                {monthDays
                  .filter(({ date }) => showWeekends || (date.getDay() !== 0 && date.getDay() !== 6))
                  .map(({ date, currentMonth }, idx) => {
                  const dateKey = date.toISOString().slice(0, 10);
                  const dayCheck = checkIsWeekendOrHoliday(dateKey);
                  const activeConsultantId = filterConsultantId || myConsultant?.id || "";
                  const activeConsultant = consultants.find((c) => c.id === activeConsultantId);
                  const isAdminOrPM = authUser?.roles.includes("ADMIN") || authUser?.roles.includes("PM");
                  const isDayBlocked = dayCheck.isWeekendOrHoliday && !(activeConsultant?.allowWeekendWork || isAdminOrPM);

                  const dayActivities = activitiesByDate.get(dateKey) || [];
                  const totalEst = dayActivities.reduce((sum, a) => sum + Number(a.estimatedHours), 0);
                  const totalAct = dayActivities.reduce((sum, a) => sum + Number(a.actualHours), 0);

                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  const isHighWork = totalAct > 8;

                  return (
                    <div
                      key={`${dateKey}-${idx}`}
                      onClick={() => {
                        setSelectedDate(date);
                        setView("week");
                      }}
                      className={`month-day-cell${isDayBlocked ? " is-blocked" : ""}${!currentMonth ? " out-of-month" : ""}${isWeekend ? " is-weekend" : ""}`}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                          <span style={{
                            fontSize: "0.8rem",
                            fontWeight: 700,
                            color: isHighWork ? "var(--state-warning-text)" : "var(--text-strong)",
                            background: isHighWork ? "var(--state-warning-bg)" : "transparent",
                            padding: isHighWork ? "0.1rem 0.25rem" : 0,
                            borderRadius: "4px"
                          }}>
                            {date.getDate()}
                          </span>
                          {isDayBlocked && (
                            <span style={{ fontSize: "0.7rem", color: "#ef4444" }} title={dayCheck.label}>🔒</span>
                          )}
                          {dayCheck.isHoliday && !isDayBlocked && (
                            <span style={{ fontSize: "0.7rem", color: "var(--state-danger-text)" }} title={dayCheck.label}>🎉</span>
                          )}
                        </div>
                        
                        {dayActivities.length > 0 && (
                          <span style={{ fontSize: "0.65rem", padding: "0.05rem 0.2rem", background: "var(--state-neutral-bg)", borderRadius: "3px", color: "var(--text-soft)" }}>
                            {dayActivities.length} {dayActivities.length === 1 ? "act" : "acts"}
                          </span>
                        )}
                      </div>

                      {totalAct > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", fontSize: "0.68rem", textAlign: "right" }}>
                          <span style={{ color: "var(--text-soft)" }}>Est: {totalEst}h</span>
                          <strong style={{ color: isHighWork ? "var(--state-warning-text)" : "var(--state-success-text)" }}>
                            Real: {totalAct}h {isHighWork && "⚠️"}
                          </strong>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- LIST TABLE VIEW --- */}
      {view === "list" && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.05rem", color: "var(--text-strong)", fontFamily: "var(--display)" }}>
            Listado de Actividades Registradas
          </h3>

          {loading ? (
            <p className="loading">Cargando...</p>
          ) : filteredActivities.length === 0 ? (
            <p style={{ fontStyle: "italic", color: "var(--text-soft)", fontSize: "0.85rem" }}>No se encontraron registros con los filtros activos.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Título</th>
                    <th>Tipo</th>
                    <th>Proyecto</th>
                    <th>Consultor</th>
                    <th>Horas</th>
                    <th>Estado</th>
                    <th>Prioridad</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActivities.map((act) => {
                    const status = getStatusLabel(act.status);
                    const prio = getPriorityBadge(act.priority);
                    const isOwn = act.consultantId === myConsultant?.id || authUser?.roles.includes("ADMIN");

                    return (
                      <tr key={act.id} style={{ cursor: "pointer" }} onClick={() => handleOpenEditModal(act)}>
                        <td>{act.scheduledDate.slice(0, 10)}</td>
                        <td>
                          <strong>{act.title}</strong>
                          {act.description && (
                            <span style={{ display: "block", fontSize: "0.7rem", color: "var(--text-soft)", maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {act.description}
                            </span>
                          )}
                        </td>
                        <td>{getTypeLabel(act.activityType)}</td>
                        <td>{act.project?.name || <span style={{ color: "#aaa" }}>—</span>}</td>
                        <td>{act.consultant?.fullName}</td>
                        <td>
                          <div style={{ fontSize: "0.8rem" }}>
                            Est: <strong>{Number(act.estimatedHours).toFixed(1)}h</strong>
                          </div>
                          <div style={{ fontSize: "0.8rem", color: "var(--state-success-text)" }}>
                            Real: <strong>{Number(act.actualHours).toFixed(1)}h</strong>
                          </div>
                        </td>
                        <td>
                          <span className="pill" style={{ background: status.bg, color: status.color, fontSize: "0.7rem", padding: "0.15rem 0.45rem", fontWeight: 700 }}>
                            {status.label}
                          </span>
                        </td>
                        <td>
                          <span className="pill" style={{ background: prio.bg, color: prio.color, fontSize: "0.7rem", padding: "0.15rem 0.45rem", fontWeight: 700 }}>
                            {prio.label}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: "0.4rem" }} onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => handleOpenEditModal(act)}
                              style={{ padding: "0.2rem 0.4rem", fontSize: "0.75rem" }}
                            >
                              Editar
                            </button>
                            {isOwn && (
                              <button
                                type="button"
                                onClick={() => handleDeleteClick(act.id)}
                                style={{ padding: "0.2rem 0.4rem", fontSize: "0.75rem", background: "#ef4444", color: "#fff", border: "none" }}
                              >
                                🗑
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* --- REPORT VIEW --- */}
      {view === "report" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* Header Controls for Report */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--card-bg)", padding: "1rem", borderRadius: "14px", border: "1px solid var(--border-color)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <strong style={{ fontSize: "1rem", color: "var(--text-strong)" }}>
                Reporte de Actividades del Equipo
              </strong>
              <span style={{ fontSize: "0.78rem", color: "var(--text-soft)" }}>
                Rango seleccionado: {
                  reportRange === "week" ? `Semana del ${weekDays[0].toLocaleDateString("es-CO")} al ${weekDays[6].toLocaleDateString("es-CO")}` :
                  reportRange === "month" ? `Mes de ${selectedDate.toLocaleString("es-CO", { month: "long", year: "numeric" })}` :
                  "Historial Completo"
                }
              </span>
            </div>
            
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-accent)" }}>Período:</span>
              <select 
                value={reportRange} 
                onChange={(e) => setReportRange(e.target.value as "week" | "month" | "all")}
                style={{ padding: "0.4rem 0.8rem", borderRadius: "8px", fontSize: "0.82rem", fontWeight: 600 }}
              >
                <option value="week">Esta semana</option>
                <option value="month">Este mes</option>
                <option value="all">Historial completo</option>
              </select>
            </div>
          </div>

          {/* Metric Cards Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
            {/* Card 1 */}
            <div className="card glass-card" style={{ padding: "1.25rem" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-soft)", textTransform: "uppercase", display: "block", marginBottom: "0.4rem" }}>Horas Reales / Estimadas</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
                <strong style={{ fontSize: "1.8rem", color: "var(--color-accent)", fontFamily: "var(--display)" }}>{reportStats.totalActualHours.toFixed(1)}h</strong>
                <span style={{ fontSize: "0.8rem", color: "var(--text-soft)" }}>/ {reportStats.totalEstimatedHours.toFixed(1)}h est.</span>
              </div>
              <div style={{ marginTop: "0.5rem", fontSize: "0.72rem", display: "flex", gap: "0.3rem", color: reportStats.totalActualHours >= reportStats.totalEstimatedHours ? "var(--state-success-text)" : "var(--state-danger-text)" }}>
                <span>{reportStats.totalActualHours >= reportStats.totalEstimatedHours ? "▲" : "▼"}</span>
                <span>{reportStats.totalEstimatedHours > 0 ? Math.round((reportStats.totalActualHours / reportStats.totalEstimatedHours) * 100) : 0}% de ejecución</span>
              </div>
            </div>

            {/* Card 2 */}
            <div className="card glass-card" style={{ padding: "1.25rem" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-soft)", textTransform: "uppercase", display: "block", marginBottom: "0.4rem" }}>Completitud de Tareas</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
                <strong style={{ fontSize: "1.8rem", color: "var(--color-accent)", fontFamily: "var(--display)" }}>{reportStats.completedPct}%</strong>
                <span style={{ fontSize: "0.8rem", color: "var(--text-soft)" }}>({reportStats.totalCount} acts. totales)</span>
              </div>
              <div style={{ marginTop: "0.5rem", fontSize: "0.72rem", color: "var(--text-soft)" }}>
                Porcentaje de actividades en estado Completado
              </div>
            </div>

            {/* Card 3 */}
            <div className="card glass-card" style={{ padding: "1.25rem" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-soft)", textTransform: "uppercase", display: "block", marginBottom: "0.4rem" }}>Promedio por Consultor</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
                <strong style={{ fontSize: "1.8rem", color: "var(--color-accent)", fontFamily: "var(--display)" }}>
                  {(consultants.length > 0 ? reportStats.totalActualHours / consultants.length : 0).toFixed(1)}h
                </strong>
                <span style={{ fontSize: "0.8rem", color: "var(--text-soft)" }}>por consultor activo</span>
              </div>
              <div style={{ marginTop: "0.5rem", fontSize: "0.72rem", color: "var(--text-soft)" }}>
                Horas cargadas en promedio por persona
              </div>
            </div>

            {/* Card 4 */}
            <div className="card glass-card" style={{ padding: "1.25rem" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-soft)", textTransform: "uppercase", display: "block", marginBottom: "0.4rem" }}>Sobrecarga de Reuniones (Teams)</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
                <strong style={{ fontSize: "1.8rem", color: "var(--color-accent)", fontFamily: "var(--display)" }}>
                  {reportStats.totalActualHours > 0 
                    ? Math.round(((reportStats.hoursByType["🤝 Reunión"] || 0) / reportStats.totalActualHours) * 100)
                    : 0}%
                </strong>
                <span style={{ fontSize: "0.8rem", color: "var(--text-soft)" }}>({(reportStats.hoursByType["🤝 Reunión"] || 0).toFixed(1)}h de reunión)</span>
              </div>
              <div style={{ marginTop: "0.5rem", fontSize: "0.72rem", color: ((reportStats.hoursByType["🤝 Reunión"] || 0) / reportStats.totalActualHours) > 0.3 ? "var(--state-danger-text)" : "var(--text-soft)", fontWeight: ((reportStats.hoursByType["🤝 Reunión"] || 0) / reportStats.totalActualHours) > 0.3 ? 700 : 400 }}>
                {((reportStats.hoursByType["🤝 Reunión"] || 0) / reportStats.totalActualHours) > 0.3 ? "⚠️ Sobrecarga administrativa alta" : "✓ Distribución de reuniones normal"}
              </div>
            </div>
          </div>

          {/* Charts Row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }} className="grid-one-col-mobile">
            {/* Chart 1: Projects distribution */}
            <div className="card" style={{ padding: "1.5rem" }}>
              <h4 style={{ margin: "0 0 1.25rem 0", color: "var(--text-strong)", fontSize: "0.95rem" }}>📂 Distribución de Horas por Proyecto</h4>
              {Object.keys(reportStats.hoursByProject).length === 0 ? (
                <p style={{ fontStyle: "italic", color: "var(--text-soft)", fontSize: "0.85rem", textAlign: "center", padding: "2rem" }}>Sin datos de proyectos para este periodo</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {Object.entries(reportStats.hoursByProject).map(([proj, hrs]) => {
                    const pct = reportStats.totalActualHours > 0 ? Math.round((hrs / reportStats.totalActualHours) * 100) : 0;
                    return (
                      <div key={proj} style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-strong)" }}>
                          <strong>{proj}</strong>
                          <span>{hrs.toFixed(1)}h ({pct}% )</span>
                        </div>
                        <div style={{ width: "100%", height: "8px", background: "var(--state-neutral-bg)", borderRadius: "4px", overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "var(--gradient-accent)", borderRadius: "4px" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Chart 2: Activity Type distribution */}
            <div className="card" style={{ padding: "1.5rem" }}>
              <h4 style={{ margin: "0 0 1.25rem 0", color: "var(--text-strong)", fontSize: "0.95rem" }}>📊 Horas por Tipo de Actividad</h4>
              {Object.keys(reportStats.hoursByType).length === 0 ? (
                <p style={{ fontStyle: "italic", color: "var(--text-soft)", fontSize: "0.85rem", textAlign: "center", padding: "2rem" }}>Sin datos de tipo de actividad para este periodo</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {Object.entries(reportStats.hoursByType).map(([type, hrs]) => {
                    const pct = reportStats.totalActualHours > 0 ? Math.round((hrs / reportStats.totalActualHours) * 100) : 0;
                    
                    // Distinct gradients per activity type
                    let gradient = "linear-gradient(90deg, #3b82f6, #1d4ed8)"; // Blue for projects
                    if (type.includes("Personal")) gradient = "linear-gradient(90deg, #a855f7, #7e22ce)"; // Purple
                    if (type.includes("Reunión")) gradient = "linear-gradient(90deg, #6366f1, #4338ca)"; // Indigo
                    if (type.includes("Capacitación")) gradient = "linear-gradient(90deg, #10b981, #047857)"; // Green
                    if (type.includes("Soporte")) gradient = "linear-gradient(90deg, #f59e0b, #b45309)"; // Orange
                    if (type.includes("Otros")) gradient = "linear-gradient(90deg, #6b7280, #374151)"; // Gray

                    return (
                      <div key={type} style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-strong)" }}>
                          <strong>{type}</strong>
                          <span>{hrs.toFixed(1)}h ({pct}% )</span>
                        </div>
                        <div style={{ width: "100%", height: "8px", background: "var(--state-neutral-bg)", borderRadius: "4px", overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: gradient, borderRadius: "4px" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Consultant workload table */}
          <div className="card" style={{ padding: "1.5rem" }}>
            <h4 style={{ margin: "0 0 1rem 0", color: "var(--text-strong)", fontSize: "0.95rem" }}>👥 Carga de Trabajo de Consultores</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th style={{ textAlign: "center" }}>Actividades</th>
                    <th style={{ textAlign: "center" }}>Horas Registradas</th>
                    <th style={{ textAlign: "center" }}>Estado Carga</th>
                    <th style={{ textAlign: "center" }}>Horas Extra</th>
                    <th style={{ textAlign: "center" }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {consultants.map((cons) => {
                    const record = reportStats.hoursByConsultant[cons.id];
                    const hrs = record ? record.hours : 0;
                    const count = record ? record.actsCount : 0;
                    const weekendWork = record ? record.weekendWork : false;

                    // Load status evaluation
                    let statusLabel = "Sin registros";
                    let statusClass = "neutral";
                    
                    const minTarget = reportRange === "week" ? 6 : reportRange === "month" ? 25 : 10;
                    const maxTarget = reportRange === "week" ? 9 : reportRange === "month" ? 45 : 30;

                    if (hrs > 0) {
                      if (hrs < minTarget) {
                        statusLabel = "Sub-asignado";
                        statusClass = "error";
                      } else if (hrs > maxTarget) {
                        statusLabel = "Sobrecargado";
                        statusClass = "error";
                      } else {
                        statusLabel = "Normal";
                        statusClass = "ok";
                      }
                    }

                    return (
                      <tr key={cons.id}>
                        <td><strong>{cons.fullName}</strong></td>
                        <td>{cons.email || "Sin email"}</td>
                        <td style={{ textAlign: "center" }}>{count}</td>
                        <td style={{ textAlign: "center", fontWeight: 700 }}>{hrs.toFixed(1)}h</td>
                        <td style={{ textAlign: "center" }}>
                          <span className={`pill ${statusClass}`} style={{ fontSize: "0.68rem", padding: "0.15rem 0.45rem", fontWeight: 700 }}>
                            {statusLabel}
                          </span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {weekendWork ? (
                            <span className="pill error" style={{ fontSize: "0.68rem", padding: "0.15rem 0.45rem", fontWeight: 700, background: "var(--state-danger-bg)", color: "var(--state-danger-text)" }} title="Ha registrado actividades en fin de semana o festivos">
                              ⚠️ HE Pendiente
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-soft)", fontSize: "0.75rem" }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setFilterConsultantId(cons.id);
                              setView("week");
                            }}
                            className="ghost"
                            style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem", borderColor: "var(--border-color)", color: "var(--color-accent)" }}
                          >
                            Ver Actividades
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}      {/* --- CREATE / EDIT MODAL --- */}
      {/* --- CREATE / EDIT MODAL --- */}
      {modalOpen && createPortal(
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "640px" }}>
            <div className="modal-header" style={{ marginBottom: "1.25rem", borderBottom: "1px solid var(--border-color, var(--border-color))", paddingBottom: "0.75rem" }}>
              <h2 style={{ margin: 0, color: "var(--text-strong, #5f2f00)", fontSize: "1.25rem", fontWeight: 700 }}>
                {editingActivity ? "✍️ Editar Actividad" : "➕ Registrar Nueva Actividad"}
              </h2>
              <button type="button" className="ghost" onClick={() => setModalOpen(false)} style={{ fontSize: "1.1rem", padding: "0.2rem 0.5rem", lineHeight: 1 }}>✕</button>
            </div>

            <div className="form-grid two-col" style={{ gap: "1rem" }}>
              
              <div className="full-width" style={{ gridColumn: "span 2" }}>
                <label className="form-label" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-accent)" }}>Título de la Actividad *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Diseño de base de datos, Reunión con cliente..."
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                />
              </div>

              <div className="full-width" style={{ gridColumn: "span 2" }}>
                <label className="form-label" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-accent)" }}>Descripción</label>
                <textarea
                  rows={2}
                  placeholder="Detalles adicionales del trabajo realizado..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                />
              </div>

              <div>
                <label className="form-label" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-accent)" }}>Tipo de Actividad *</label>
                <select 
                  value={formType} 
                  onChange={(e) => setFormType(e.target.value as ActivityType)} 
                  required
                >
                  <option value="project">Proyecto</option>
                  <option value="personal">Personal / Bench</option>
                  <option value="meeting">Reunión</option>
                  <option value="training">Capacitación / Formación</option>
                  <option value="support">Soporte</option>
                  <option value="other">Otros</option>
                </select>
              </div>

              <div>
                <label className="form-label" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-accent)" }}>Proyecto Vincular (Opcional)</label>
                <SearchableSelect
                  options={projects.map((p) => ({ value: p.id, label: p.name }))}
                  value={formProjectId}
                  onChange={(val) => setFormProjectId(val)}
                  placeholder="Buscar proyecto..."
                  emptyLabel="-- No vincular a proyecto --"
                />
              </div>

              {(authUser?.roles.includes("ADMIN") || authUser?.roles.includes("PM")) ? (
                <div>
                  <label className="form-label" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-accent)" }}>Consultor *</label>
                  <SearchableSelect
                    options={consultants.map((c) => ({ value: c.id, label: c.fullName }))}
                    value={formConsultantId}
                    onChange={(val) => setFormConsultantId(val)}
                    placeholder="Buscar consultor..."
                    emptyLabel=""
                  />
                </div>
              ) : (
                <div>
                  <label className="form-label" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-accent)" }}>Consultor</label>
                  <input
                    type="text"
                    readOnly
                    value={myConsultant ? myConsultant.fullName : authUser?.displayName || ""}
                    style={{ cursor: "not-allowed", opacity: 0.6 }}
                  />
                </div>
              )}

              <div>
                <label className="form-label" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-accent)" }}>Fecha Planificada *</label>
                <input
                  type="date"
                  required
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                />
              </div>

              <div>
                <label className="form-label" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-accent)" }}>Horas Estimadas *</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  required
                  value={formEstimatedHours}
                  onChange={(e) => setFormEstimatedHours(e.target.value)}
                />
              </div>

              <div>
                <label className="form-label" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-accent)" }}>Horas Reales (Ejecutadas) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  required
                  value={formActualHours}
                  onChange={(e) => setFormActualHours(e.target.value)}
                />
              </div>

              <div>
                <label className="form-label" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-accent)" }}>Prioridad *</label>
                <select 
                  value={formPriority} 
                  onChange={(e) => setFormPriority(e.target.value as ActivityPriority)} 
                  required
                >
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>

              <div>
                <label className="form-label" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-accent)" }}>Estado *</label>
                <select 
                  value={formStatus} 
                  onChange={(e) => setFormStatus(e.target.value as ActivityStatus)} 
                  required
                >
                  <option value="pending">Pendiente</option>
                  <option value="in_progress">En Progreso</option>
                  <option value="completed">Completado</option>
                  <option value="blocked">Bloqueado</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>

              <div style={{ gridColumn: "span 2" }}>
                <label className="form-label" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-accent)" }}>Comentarios / Notas internas</label>
                <textarea
                  rows={2}
                  placeholder="Observaciones de avance, impedimentos, etc..."
                  value={formComments}
                  onChange={(e) => setFormComments(e.target.value)}
                />
              </div>

              {/* AUTOMATIC EXTRA HOURS DETECTOR BOX */}
              {isExtraHoursEligible && formProjectId && (
                <div className="extra-hours-suggestion-box">
                  <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                    <span style={{ fontSize: "1.5rem" }}>⏱️</span>
                    <div>
                      <strong style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem" }}>
                        Sugerencia de Horas Extras
                      </strong>
                      <p style={{ margin: 0, fontSize: "0.78rem", lineHeight: "1.3" }}>
                        Esta actividad supera las 8 horas diarias estándar o se ha programado para un fin de semana/festivo. Puedes solicitar la aprobación de horas extras aquí.
                      </p>
                      
                      <button
                        type="button"
                        onClick={() => setApplyForExtraHours(!applyForExtraHours)}
                        style={{
                          background: applyForExtraHours ? "#b45309" : "linear-gradient(135deg, #f59e0b, #d97706)",
                          color: "#fff",
                          border: "none",
                          padding: "0.4rem 0.8rem",
                          fontSize: "0.78rem",
                          borderRadius: "8px",
                          cursor: "pointer",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: "0.4rem",
                          boxShadow: "0 2px 4px rgba(217, 119, 6, 0.15)",
                          transition: "all 0.2s ease",
                          marginTop: "0.75rem"
                        }}
                      >
                        {applyForExtraHours ? "✕ Cancelar Solicitud" : "➕ Solicitar Hora Extra"}
                      </button>
                    </div>
                  </div>

                  {applyForExtraHours && (
                    <div style={{ 
                      display: "grid", 
                      gridTemplateColumns: "1fr 1fr", 
                      gap: "0.75rem", 
                      marginTop: "1rem", 
                      borderTop: "1px solid var(--border-color, #fde68a)", 
                      paddingTop: "1rem",
                      animation: "fadeIn 0.25s ease-out" 
                    }}>
                      <div>
                        <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>Hora Inicio Horas Extras</label>
                        <input
                          type="time"
                          value={extraHoursStartTime}
                          onChange={(e) => setExtraHoursStartTime(e.target.value)}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>Hora Fin Horas Extras</label>
                        <input
                          type="time"
                          value={extraHoursEndTime}
                          onChange={(e) => setExtraHoursEndTime(e.target.value)}
                        />
                      </div>
                      <div style={{ gridColumn: "span 2" }}>
                        <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>Nota de Justificación Horas Extras</label>
                        <input
                          type="text"
                          value={extraHoursNote}
                          onChange={(e) => setExtraHoursNote(e.target.value)}
                          placeholder="Motivo o justificación de las horas extras..."
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ marginTop: "1rem", display: "flex", justifyContent: "space-between", width: "100%" }}>
              <div>
                {editingActivity && (
                  <button
                    type="button"
                    onClick={() => {
                      setModalOpen(false);
                      handleDeleteClick(editingActivity.id);
                    }}
                    style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: "6px", fontSize: "0.85rem", padding: "0.5rem 1rem", cursor: "pointer" }}
                  >
                    🗑 Eliminar Actividad
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="ghost" onClick={() => setModalOpen(false)} style={{ cursor: "pointer" }}>Cancelar</button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ background: "var(--gradient-accent)", border: "none", color: "#fff", cursor: "pointer", borderRadius: "6px", padding: "0.5rem 1rem", fontWeight: 700 }}
                >
                  {submitting ? "Guardando..." : "Guardar Actividad"}
                </button>
              </div>
            </div>
          </form>
        </div>,
        document.body
      )}
      {/* --- TEAMS SYNC MODAL --- */}
      {teamsModalOpen && createPortal(
        <div className="modal-overlay" onClick={() => setTeamsModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "680px", display: "flex", flexDirection: "column", overflow: "hidden", padding: 0 }}>
            {/* Teams branded header */}
            <div className="teams-sync-header">
              <h3 style={{ margin: 0, fontSize: "1.2rem", display: "flex", alignItems: "center", gap: "0.6rem", fontWeight: 700 }}>
                <MicrosoftTeamsIcon size={22} /> Sincronizar Reuniones de Teams
              </h3>
              <button type="button" className="ghost" onClick={() => setTeamsModalOpen(false)} style={{ padding: "0.25rem 0.5rem" }}>✕</button>
            </div>

            <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem", overflowY: "auto", flex: 1 }}>
              
              <div className="teams-sync-info">
                <span>ℹ️</span>
                <span>
                  Mostrando reuniones para la semana del <strong>{weekDays[0].toLocaleDateString("es-CO")}</strong> al <strong>{weekDays[6].toLocaleDateString("es-CO")}</strong>. 
                  {accounts.length > 0 ? " Conectado a Microsoft Graph." : " Usando datos de simulación local (modo demo)."}
                </span>
              </div>

              {/* Grid: Consultant & Project selector */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }} className="grid-one-col-mobile">
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  <label className="teams-sync-label">Consultor a Sincronizar *</label>
                  <SearchableSelect
                    options={consultants.map((c) => ({ value: c.id, label: c.fullName }))}
                    value={syncConsultantId}
                    onChange={(val) => setSyncConsultantId(val)}
                    placeholder="Buscar consultor..."
                    emptyLabel=""
                    disabled={accounts.length > 0}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  <label className="teams-sync-label">Asociar actividades al Proyecto:</label>
                  <SearchableSelect
                    options={projects.map((p) => ({ value: p.id, label: p.name }))}
                    value={syncProjectId}
                    onChange={(val) => setSyncProjectId(val)}
                    placeholder="Buscar proyecto..."
                    emptyLabel="-- No vincular a proyecto --"
                  />
                </div>
              </div>

              {/* List of events */}
              <div className="teams-event-table-container">
                {syncLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem", gap: "0.5rem" }}>
                    <span className="loading" style={{ margin: 0 }}>Cargando eventos de Microsoft...</span>
                  </div>
                ) : syncEvents.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-soft)", fontStyle: "italic", fontSize: "0.85rem" }}>
                    No se encontraron eventos en tu calendario para esta semana.
                  </div>
                ) : (
                  <table>
                    <thead>
                      <tr className="teams-header-row">
                        <th style={{ width: "40px", textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={syncSelectedIds.length === syncEvents.filter(ev => !ev.isImported).length && syncEvents.filter(ev => !ev.isImported).length > 0}
                            onChange={(e) => {
                              if (e.target.checked) {
                                  setSyncSelectedIds(syncEvents.filter(ev => !ev.isImported).map(ev => ev.id));
                              } else {
                                setSyncSelectedIds([]);
                              }
                            }}
                            disabled={syncEvents.filter(ev => !ev.isImported).length === 0}
                            style={{ width: "16px", height: "16px", cursor: "pointer" }}
                          />
                        </th>
                        <th style={{ textAlign: "left" }}>Reunión / Evento</th>
                        <th style={{ width: "85px", textAlign: "center" }}>Duración</th>
                        <th style={{ width: "120px", textAlign: "center" }}>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncEvents.map((ev) => (
                        <tr 
                          key={ev.id} 
                          className={ev.isImported ? "imported" : ""}
                        >
                          <td style={{ textAlign: "center", padding: "0.75rem 0.5rem" }}>
                            <input
                              type="checkbox"
                              checked={syncSelectedIds.includes(ev.id)}
                              disabled={ev.isImported}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSyncSelectedIds(prev => [...prev, ev.id]);
                                } else {
                                  setSyncSelectedIds(prev => prev.filter(id => id !== ev.id));
                                }
                              }}
                              style={{ width: "16px", height: "16px", cursor: ev.isImported ? "not-allowed" : "pointer" }}
                            />
                          </td>
                          <td style={{ padding: "0.75rem 0.5rem" }}>
                            <strong style={{ display: "block", fontSize: "0.82rem" }}>
                              {ev.subject}
                            </strong>
                            <span style={{ fontSize: "0.72rem", color: "var(--text-soft, #6b7280)" }}>
                              {formatMeetingTime(ev.start, ev.end)}
                            </span>
                          </td>
                          <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontWeight: 700, fontSize: "0.82rem" }}>
                            {ev.duration.toFixed(1)}h
                          </td>
                          <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                            {ev.isImported ? (
                              <span className="pill ok" style={{ fontSize: "0.65rem", padding: "0.15rem 0.45rem", fontWeight: 700 }}>✓ Importado</span>
                            ) : (
                              <span className="pill neutral" style={{ fontSize: "0.65rem", padding: "0.15rem 0.45rem", fontWeight: 700 }}>Pendiente</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="teams-sync-footer">
              <span style={{ fontSize: "0.78rem", color: "var(--text-soft)", fontWeight: 600 }}>
                {syncSelectedIds.length} seleccionados para importar
              </span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="ghost" onClick={() => setTeamsModalOpen(false)} style={{ cursor: "pointer" }}>Cancelar</button>
                <button 
                  type="button" 
                  disabled={syncSelectedIds.length === 0 || syncingInProgress}
                  onClick={handleImportMeetings}
                  style={{ background: "linear-gradient(135deg, #4f46e5, #3730a3)", border: "none", color: "#fff", cursor: "pointer", borderRadius: "6px", padding: "0.5rem 1rem", fontWeight: 700 }}
                >
                  {syncingInProgress ? "Importando..." : "Importar seleccionados"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Toast de Éxito */}
      {successMessage && (
        <div style={{
          position: "fixed",
          top: "20px",
          right: "20px",
          backgroundColor: "var(--state-success-bg)",
          border: "1px solid var(--state-success-border)",
          borderRadius: "8px",
          padding: "1rem 1.5rem",
          color: "var(--state-success-text)",
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          animation: "slideIn 0.3s ease-out"
        }}>
          <span style={{ fontSize: "1.2rem" }}>✅</span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <strong style={{ fontSize: "0.9rem" }}>Éxito</strong>
            <span style={{ fontSize: "0.80rem" }}>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            style={{
              background: "none",
              border: "none",
              color: "var(--state-success-text)",
              cursor: "pointer",
              fontSize: "1.1rem",
              padding: "0 0 0 0.5rem"
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Confirmar Eliminación */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Eliminar Actividad"
        message="¿Está seguro de que desea eliminar esta actividad? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        danger={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setDeleteConfirmOpen(false);
          setActivityToDelete(null);
        }}
      />
    </div>
  );
}
