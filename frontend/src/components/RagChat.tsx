import React, { useState, useEffect, useRef } from "react";
import { type Project, type FxConfig, type Consultant, type StatsProjectRowEnriched } from "../services/api";

type Message = {
  id: string;
  sender: "user" | "bot";
  text: string;
  sources?: string[];
  timestamp: Date;
};

type RagChatProps = {
  projects: Project[];
  statsProjects?: StatsProjectRowEnriched[];
  fxConfigs: FxConfig[];
  consultants?: Consultant[];
  isOpen: boolean;
  onClose: () => void;
};

export function RagChat({ projects, statsProjects = [], fxConfigs, consultants = [], isOpen, onClose }: RagChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "initial",
      sender: "bot",
      text: "¡Hola! Soy el asistente inteligente de Synaptica. Puedo responder tus preguntas sobre los proyectos, presupuestos, consultores o tasas de cambio de esta demo. Intenta preguntar por 'proyectos en riesgo', el nombre de algún proyecto o un consultor.",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userText = input.trim();
    const userMsg: Message = {
      id: `${Date.now()}-${Math.random()}`,
      sender: "user",
      text: userText,
      timestamp: new Date()
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Simulate RAG retrieval and generation
    timeoutRef.current = setTimeout(() => {
      let botText = "";
      let sources: string[] = [];

      const query = userText.toLowerCase();

      // 1. Check if user is asking about a specific project
      let matchedProject: Project | null = null;
      for (const p of projects) {
        if (query.includes(p.name.toLowerCase())) {
          matchedProject = p;
          break;
        }
      }

      // 2. Check if user is asking about a specific consultant
      let matchedConsultant: Consultant | null = null;
      if (consultants && consultants.length > 0) {
        for (const c of consultants) {
          const nameLower = c.fullName.toLowerCase();
          const first = nameLower.split(" ")[0];
          if (query.includes(nameLower) || (first && first.length > 2 && query.includes(first))) {
            matchedConsultant = c;
            break;
          }
        }
      }

      if (matchedProject) {
        // Enrich from statsProjects if available
        const statsRow = statsProjects.find(s => s.projectId === matchedProject!.id);
        const dc = statsRow?.displayCurrency || matchedProject.currency || "USD";
        const budgetVal = Number(statsRow?.budget ?? matchedProject.budget ?? 0).toLocaleString("es-CO");
        const spentVal = Number(statsRow?.spent ?? 0).toLocaleString("es-CO");
        const remVal = Number(statsRow?.remainingBudget ?? (Number(matchedProject.budget || 0))).toLocaleString("es-CO");
        const statusText = matchedProject.status === "ACTIVE" ? "Activo 🟢" : "Completado 🔵";

        botText = `Encontré información del proyecto **${matchedProject.name}**:\n\n` +
          `• **ID**: ${matchedProject.id}\n` +
          `• **Cliente**: ${matchedProject.company || "—"}\n` +
          `• **Estado**: ${statusText}\n` +
          `• **Presupuesto**: $${budgetVal} ${dc}\n` +
          `• **Gastado**: $${spentVal} ${dc}\n` +
          `• **Disponible**: $${remVal} ${dc}\n\n` +
          `${(statsRow?.remainingBudget ?? 0) < 0 ? "⚠️ ¡Atención! El proyecto ha superado su presupuesto." : "El presupuesto se encuentra dentro de los límites normales."}`;
        
        sources = [`Base de datos: Tabla Project (ID: ${matchedProject.id})`, `Cálculo en Tiempo Real: Módulo de Estadísticas`];

      } else if (matchedConsultant) {
        // La tarifa puede no venir: el backend la omite para los roles que no
        // pueden verla (DEP-38). En ese caso hay que decirlo, no responder "$0",
        // que se leería como "este consultor no cuesta nada".
        const tarifaTexto = matchedConsultant.hourlyRate === undefined
          ? "No disponible para tu rol"
          : matchedConsultant.hourlyRate === null
            ? "Sin tarifa registrada"
            : `$${Number(matchedConsultant.hourlyRate).toLocaleString("es-CO")} COP/hora`;
        const emailText = matchedConsultant.email || "Sin correo registrado";
        const specText = matchedConsultant.skills && matchedConsultant.skills.length > 0
          ? matchedConsultant.skills.join(", ")
          : (matchedConsultant.role || "General");
        botText = `Aquí tienes los detalles del consultor **${matchedConsultant.fullName}**:\n\n` +
          `• **Rol/Nivel**: ${matchedConsultant.role || "Consultor"}\n` +
          `• **Especialidad/Habilidades**: ${specText}\n` +
          `• **Correo**: ${emailText}\n` +
          `• **Tarifa Estándar**: ${tarifaTexto}\n` +
          `• **Estado**: Activo en plataforma`;
        
        sources = [`Base de datos: Tabla Consultant (ID: ${matchedConsultant.id})`, `Campos: fullName, role, hourlyRate`];

      } else if (query.includes("alerta") || query.includes("riesgo") || query.includes("excedido") || query.includes("limite")) {
        const projectsInRisk = statsProjects.length > 0 
          ? statsProjects.filter(p => p.alertLevel === "warning" || p.alertLevel === "exceeded" || p.remainingBudget < 0)
          : [];
        if (projectsInRisk.length === 0) {
          botText = "¡Excelentes noticias! Actualmente no hay proyectos registrados con nivel de alerta crítica o presupuesto excedido.";
        } else {
          botText = `Se detectaron **${projectsInRisk.length} proyectos en riesgo**:\n\n` +
            projectsInRisk.map(p => {
              const statusSymbol = p.alertLevel === "exceeded" || p.remainingBudget < 0 ? "🔴 EXCEDIDO" : "🟡 ADVERTENCIA";
              const pctText = p.projectedPct ? `(${p.projectedPct.toFixed(1)}% del presupuesto)` : "";
              return `• **${p.projectName}**: ${statusSymbol} ${pctText}`;
            }).join("\n");
        }
        sources = ["Motor de Reglas Financieras", "Cálculo de Proyecciones de Costo"];

      } else if (query.includes("proyecto") || query.includes("cuántos") || query.includes("lista")) {
        const count = projects.length;
        const activeCount = projects.filter(p => p.status === "ACTIVE").length;
        botText = `Actualmente hay **${count} proyectos** registrados en total, de los cuales **${activeCount}** se encuentran en estado activo.\n\n` +
          `Algunos proyectos en curso:\n` +
          projects.slice(0, 4).map(p => `• ${p.name} (Cliente: ${p.company || "—"})`).join("\n");
        sources = ["Base de datos: Tabla Project", "Controlador: listProjects"];

      } else if (query.includes("presupuesto") || query.includes("costo") || query.includes("budget")) {
        const totalBudget = projects.reduce((acc, p) => acc + Number(p.budget || 0), 0);
        const totalSpent = statsProjects.length > 0
          ? statsProjects.reduce((acc, p) => acc + p.spent, 0)
          : 0;
        botText = `El resumen financiero consolidado de todo el portafolio es:\n\n` +
          `• **Presupuesto Total**: $${totalBudget.toLocaleString("es-CO")} USD\n` +
          `• **Gasto Real Acumulado**: $${totalSpent.toLocaleString("es-CO")} USD\n` +
          `• **Eficiencia General**: ${totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0}% ejecutado.`;
        sources = ["Agregación de Presupuestos BAC/spent", "Módulo Financiero"];

      } else if (query.includes("tasa") || query.includes("dolar") || query.includes("divisa") || query.includes("cambio") || query.includes("fx")) {
        if (fxConfigs.length === 0) {
          botText = "No hay tasas de cambio (FX) configuradas actualmente en el sistema.";
        } else {
          botText = `Las tasas de cambio (FX) configuradas son:\n\n` +
            fxConfigs.map(fx => `• **1 ${fx.baseCode}** = ${Number(fx.rate).toLocaleString("es-CO", { maximumFractionDigits: 4 })} ${fx.quoteCode}`).join("\n");
        }
        sources = ["Base de datos: Tabla FxConfig", "Módulo de Conversión Multimoneda"];

      } else if (query.includes("ayuda") || query.includes("hola") || query.includes("qué haces") || query.includes("buenos dias")) {
        botText = "¡Hola! Soy el asistente inteligente de Synaptica. Puedo consultar en tiempo real los datos del portafolio. Intenta preguntarme cosas como:\n\n" +
          "• *'¿Qué proyectos están en riesgo?'*\n" +
          "• *'Presupuesto de [nombre del proyecto]'*\n" +
          "• *'¿Cuánto es el presupuesto total consolidado?'*\n" +
          "• *'Información sobre el consultor [nombre]'*\n" +
          "• *'Ver tasas de cambio (FX) configuradas'*";
        sources = ["Documentación del Asistente RAG"];

      } else {
        botText = "Lo siento, no encontré registros específicos para esa consulta en la base de datos de esta demo.\n\n" +
          "Intenta preguntar sobre 'proyectos en riesgo', el nombre de un proyecto (ej. 'Portal Clientes'), o un consultor (ej. 'Sandra' o 'Carlos').";
        sources = ["Búsqueda Semántica Vacía"];
      }

      const botMsg: Message = {
        id: `${Date.now()}-${Math.random()}`,
        sender: "bot",
        text: botText,
        sources,
        timestamp: new Date()
      };

      setMessages((prev) => [...prev, botMsg]);
      setIsTyping(false);
    }, 1000);
  };


  return (
    <div className="rag-chat">
      {/* Header */}
      <div className="rag-chat__head">
        <div className="rag-chat__head-title">
          <span className="rag-chat__head-icon">🤖</span>
          <div>
            <h4>Asistente RAG</h4>
            <span className="rag-chat__head-sub">Búsqueda Semántica Demo</span>
          </div>
        </div>
        <div className="rag-chat__head-actions">
          <button
            type="button"
            onClick={() => {
              setMessages([
                {
                  id: "initial",
                  sender: "bot",
                  text: "Conversación reiniciada. ¿En qué puedo ayudarte hoy?",
                  timestamp: new Date()
                }
              ]);
            }}
            title="Limpiar conversación"
            className="rag-chat__head-btn"
          >
            🗑️
          </button>
          <button type="button" onClick={onClose} className="rag-chat__head-btn">
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="rag-chat__messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`rag-chat__msg rag-chat__msg--${msg.sender}`}>
            <div className="rag-chat__bubble">{msg.text}</div>

            {msg.sources && msg.sources.length > 0 && (
              <div className="rag-chat__sources">Fuentes: {msg.sources.join(" | ")}</div>
            )}
          </div>
        ))}

        {isTyping && <div className="rag-chat__typing">Generando respuesta... ⏳</div>}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSend} className="rag-chat__form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe una pregunta (Ctrl+K)..."
          className="rag-chat__input"
        />
        <button type="submit" className="rag-chat__send">
          <span className="rag-chat__send-icon">➔</span>
        </button>
      </form>
    </div>
  );
}
