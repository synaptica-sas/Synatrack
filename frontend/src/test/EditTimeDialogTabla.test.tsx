import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditTimeDialog } from "../features/timesheet/EditTimeDialog";
import { ApiError, type DaySummary, type TimeEntry, type TimeEntryType } from "../services/api";

/**
 * La ventana "Editar tiempo" es ahora una tabla editable (R14): renglón vacío
 * al final, teclado tipo hoja de cálculo, pie con el consumo en vivo y errores
 * del servidor marcados en su fila.
 */

const type = (id: string, category: TimeEntryType["category"], name: string, sortOrder: number): TimeEntryType => ({
  id,
  code: id.toUpperCase(),
  name,
  category,
  blockType: null,
  active: true,
  sortOrder,
});
const TYPES = [
  type("reg", "REGULAR", "Horas Regulares", 1),
  type("ext", "EXTRA", "Horas Extras", 2),
];

const summary = (extraApproved: number): DaySummary => ({
  date: "2026-11-03",
  isWeekend: false,
  isHoliday: false,
  holidayName: null,
  allowWeekendWork: false,
  hoursPerDay: 8,
  isNonWorkingDay: false,
  regularAllowed: true,
  usedRegular: 6,
  usedAbsence: 0,
  usedAgainstCap: 6,
  remaining: 2,
  overBy: 0,
  projects: [{ projectId: "p1", extraApproved, extraUsed: 0, extraExcess: 0, extraRemaining: extraApproved }],
});

function setup(props: Partial<ComponentProps<typeof EditTimeDialog>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <EditTimeDialog
      day="2026-11-03"
      projectId="p1"
      projectName="Proyecto Uno"
      isAbsenceProject={false}
      entries={[] as TimeEntry[]}
      types={TYPES}
      summary={summary(0)}
      readOnly={false}
      onSave={onSave}
      onClose={onClose}
      {...props}
    />,
  );
  return { onSave, onClose };
}

describe("EditTimeDialog como tabla", () => {
  it("empieza con un renglón vacío y crea otro al escribir en él", async () => {
    setup();
    expect(screen.getAllByLabelText("Duración")).toHaveLength(1);
    await userEvent.type(screen.getAllByLabelText("Duración")[0], "1:00");
    expect(screen.getAllByLabelText("Duración")).toHaveLength(2);
  });

  it("solo ofrece Extra cuando hay saldo aprobado ese día", () => {
    setup({ summary: summary(0) });
    expect(within(screen.getByLabelText("Tipo de hora")).queryByText("Horas Extras")).toBeNull();
  });

  it("ofrece Extra con saldo aprobado y marca inicio/fin como obligatorios", async () => {
    setup({ summary: summary(2) });
    const select = screen.getByLabelText("Tipo de hora");
    expect(within(select).getByText("Horas Extras")).toBeTruthy();
    await userEvent.selectOptions(select, "ext");
    expect(screen.getAllByLabelText("Hora de inicio")[0].getAttribute("aria-required")).toBe("true");
  });

  it("el pie se actualiza en vivo con el borrador", async () => {
    setup();
    expect(screen.getByText(/restante 02:00:00/)).toBeTruthy();
    await userEvent.type(screen.getAllByLabelText("Duración")[0], "3:00");
    expect(screen.getByText(/se pasa por 01:00:00/)).toBeTruthy();
  });

  it("Ctrl+Enter guarda con una sola llamada y el payload correcto", async () => {
    const { onSave } = setup();
    const dur = screen.getAllByLabelText("Duración")[0];
    await userEvent.type(dur, "1:30");
    await userEvent.type(screen.getAllByLabelText("Descripción")[0], "Reunión");
    fireEvent.keyDown(screen.getAllByLabelText("Descripción")[0], { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual([
      { typeId: "reg", hours: 1.5, startedAt: null, endedAt: null, description: "Reunión" },
    ]);
  });

  it("Enter pasa a la misma columna del renglón siguiente", async () => {
    setup();
    const dur = screen.getAllByLabelText("Duración")[0];
    await userEvent.type(dur, "1:00");
    fireEvent.keyDown(dur, { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByLabelText("Duración")[1]));
  });

  it("Ctrl+Supr elimina el renglón", async () => {
    setup();
    await userEvent.type(screen.getAllByLabelText("Duración")[0], "1:00");
    expect(screen.getAllByLabelText("Duración")).toHaveLength(2);
    fireEvent.keyDown(screen.getAllByLabelText("Duración")[0], { key: "Delete", ctrlKey: true });
    expect(screen.getAllByLabelText("Duración")).toHaveLength(1);
  });

  it("marca en su fila el error con índice y arriba el que no lo trae", async () => {
    const onSave = vi.fn().mockRejectedValue(
      new ApiError("Supera la jornada", 400, "DAY_CAP", [
        { index: 0, code: "DAY_CAP", message: "Con esto superas la jornada de 8 h." },
        { index: null, code: "X", message: "El mes está cerrado." },
      ]),
    );
    setup({ onSave });
    await userEvent.type(screen.getAllByLabelText("Duración")[0], "1:00");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Con esto superas la jornada de 8 h.")).toBeTruthy();
    expect(screen.getByText("El mes está cerrado.")).toBeTruthy();
  });

  it("calcula la duración en vivo y normaliza la hora al salir del campo", async () => {
    setup();
    await userEvent.type(screen.getAllByLabelText("Hora de inicio")[0], "9");
    await userEvent.tab();
    expect((screen.getAllByLabelText("Hora de inicio")[0] as HTMLInputElement).value).toBe("09:00");
    await userEvent.type(screen.getAllByLabelText("Hora de fin")[0], "1030");
    expect((screen.getAllByLabelText("Duración")[0] as HTMLInputElement).value).toBe("01:30:00");
    await userEvent.tab();
    expect((screen.getAllByLabelText("Hora de fin")[0] as HTMLInputElement).value).toBe("10:30");
  });

  it("inicio + duración calculan el fin y 6pm se lee como 18:00", async () => {
    setup();
    await userEvent.type(screen.getAllByLabelText("Hora de inicio")[0], "6pm");
    await userEvent.type(screen.getAllByLabelText("Duración")[0], "2");
    expect((screen.getAllByLabelText("Hora de fin")[0] as HTMLInputElement).value).toBe("20:00");
  });

  it("una hora inválida se marca en la celda y no se guarda", async () => {
    const { onSave } = setup();
    await userEvent.type(screen.getAllByLabelText("Hora de inicio")[0], "25");
    await userEvent.type(screen.getAllByLabelText("Duración")[0], "1");
    fireEvent.keyDown(screen.getAllByLabelText("Duración")[0], { key: "Enter", ctrlKey: true });
    expect(await screen.findByText("Hora inválida — usa HH:MM, p.ej. 18:30")).toBeTruthy();
    expect(screen.getAllByLabelText("Hora de inicio")[0].getAttribute("aria-invalid")).toBe("true");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("fin anterior al inicio muestra el error de fila", async () => {
    setup();
    await userEvent.type(screen.getAllByLabelText("Hora de inicio")[0], "18");
    await userEvent.type(screen.getAllByLabelText("Hora de fin")[0], "0800");
    expect(screen.getByText("El fin debe ser posterior al inicio")).toBeTruthy();
  });

  it("Ctrl+Enter normaliza lo escrito sin haber salido del campo", async () => {
    const { onSave } = setup();
    await userEvent.type(screen.getAllByLabelText("Hora de inicio")[0], "9");
    await userEvent.type(screen.getAllByLabelText("Hora de fin")[0], "1030");
    fireEvent.keyDown(screen.getAllByLabelText("Hora de fin")[0], { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [entry] = onSave.mock.calls[0][0];
    expect(entry.hours).toBe(1.5);
  });

  it("al elegir Extra precarga la primera franja aprobada y la muestra", async () => {
    const conFranjas = summary(4);
    conFranjas.projects[0].approvedRequests = [
      { id: "r1", startTime: "18:00", endTime: "20:00", totalHours: 2 },
      { id: "r2", startTime: "21:00", endTime: "23:00", totalHours: 2 },
    ];
    setup({ summary: conFranjas });
    await userEvent.selectOptions(screen.getByLabelText("Tipo de hora"), "ext");
    expect((screen.getAllByLabelText("Hora de inicio")[0] as HTMLInputElement).value).toBe("18:00");
    expect((screen.getAllByLabelText("Hora de fin")[0] as HTMLInputElement).value).toBe("20:00");
    expect((screen.getAllByLabelText("Duración")[0] as HTMLInputElement).value).toBe("02:00:00");
    expect(screen.getByText("Aprobado: 18:00–20:00, 21:00–23:00")).toBeTruthy();

    // Un segundo renglón Extra toma la franja que queda libre.
    await userEvent.selectOptions(screen.getAllByLabelText("Tipo de hora")[1], "ext");
    expect((screen.getAllByLabelText("Hora de inicio")[1] as HTMLInputElement).value).toBe("21:00");
  });

  it("un renglón que nace Extra se precarga al empezar a escribir, no antes", async () => {
    const dia = summary(2);
    dia.regularAllowed = false;
    dia.projects[0].approvedRequests = [{ id: "r1", startTime: "18:00", endTime: "20:00", totalHours: 2 }];
    setup({ summary: dia });
    // Sin escribir nada, el renglón vacío sigue vacío y no se crea otro.
    expect(screen.getAllByLabelText("Hora de inicio")).toHaveLength(1);
    expect((screen.getAllByLabelText("Hora de inicio")[0] as HTMLInputElement).value).toBe("");
    await userEvent.type(screen.getAllByLabelText("Descripción")[0], "x");
    expect((screen.getAllByLabelText("Hora de inicio")[0] as HTMLInputElement).value).toBe("18:00");
    expect((screen.getAllByLabelText("Duración")[0] as HTMLInputElement).value).toBe("02:00:00");
  });

  it("avisa sin bloquear si la franja Extra queda fuera de la aprobada", async () => {
    const dia = summary(2);
    dia.projects[0].approvedRequests = [{ id: "r1", startTime: "18:00", endTime: "20:00", totalHours: 2 }];
    const { onSave } = setup({ summary: dia });
    await userEvent.selectOptions(screen.getByLabelText("Tipo de hora"), "ext");
    await userEvent.clear(screen.getAllByLabelText("Hora de inicio")[0]);
    await userEvent.type(screen.getAllByLabelText("Hora de inicio")[0], "06");
    await userEvent.clear(screen.getAllByLabelText("Hora de fin")[0]);
    await userEvent.type(screen.getAllByLabelText("Hora de fin")[0], "08");
    const aviso = await screen.findByText("06:00–08:00 está fuera de la franja aprobada 18:00–20:00");
    expect(aviso.getAttribute("role")).toBe("status");
    expect(screen.getAllByLabelText("Hora de inicio")[0].getAttribute("aria-invalid")).toBe("false");
    fireEvent.keyDown(screen.getAllByLabelText("Hora de fin")[0], { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("sin approvedRequests (servidor viejo) no precarga nada", async () => {
    setup({ summary: summary(2) });
    await userEvent.selectOptions(screen.getByLabelText("Tipo de hora"), "ext");
    expect((screen.getAllByLabelText("Hora de inicio")[0] as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/^Aprobado:/)).toBeNull();
  });

  it("un registro ya aprobado queda de solo lectura con su estado", () => {
    const aprobado = {
      id: "e1",
      projectId: "p1",
      hours: "2",
      status: "APPROVED",
      startedAt: null,
      endedAt: null,
      description: "hecho",
      type: { id: "reg", code: "REGULAR", name: "Horas Regulares", category: "REGULAR" },
      typeId: "reg",
    } as unknown as TimeEntry;
    setup({ entries: [aprobado] });
    const duraciones = screen.getAllByLabelText("Duración") as HTMLInputElement[];
    expect(duraciones[0].disabled).toBe(true);
    expect(screen.getByText("Aprobado")).toBeTruthy();
  });

  it("etiqueta el excedente pendiente del PM", () => {
    const excedente = {
      id: "e2",
      projectId: "p1",
      hours: "1",
      status: "PENDING",
      isExcess: true,
      startedAt: "2026-11-03T23:00:00.000Z",
      endedAt: "2026-11-04T00:00:00.000Z",
      description: null,
      type: { id: "ext", code: "EXTRA", name: "Horas Extras", category: "EXTRA" },
      typeId: "ext",
    } as unknown as TimeEntry;
    setup({ entries: [excedente], summary: summary(2) });
    expect(screen.getByText("Excedente — pendiente PM")).toBeTruthy();
  });
});
