const baseUrl = process.env.API_BASE_URL || "http://localhost:4000";
const bearerToken = process.env.SMOKE_BEARER_TOKEN || "";

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

async function http(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(`Request ${path} failed with status ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function main() {
  console.log(`Running smoke test against ${baseUrl}`);

  const health = await http("/health");
  if (!health.ok) {
    throw new Error(`Health check returned not ok: ${JSON.stringify(health)}`);
  }

  const suffix = randomSuffix();

  const company = (
    await http("/api/companies", {
      method: "POST",
      body: JSON.stringify({ name: `Empresa smoke ${suffix}` }),
    })
  ).data;

  const project = (
    await http("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: `Proyecto ${suffix}`,
        companyId: company.id,
        country: "Colombia",
        currency: "USD",
        budget: 25000,
        startDate: "2026-04-01",
        endDate: "2026-08-30",
        description: "Proyecto de validacion automatica",
      }),
    })
  ).data;

  const consultant = (
    await http("/api/consultants", {
      method: "POST",
      body: JSON.stringify({
        fullName: `Consultor ${suffix}`,
        role: "Developer",
        hourlyRate: 45,
        active: true,
      }),
    })
  ).data;

  const timeEntry = (
    await http("/api/time-entries", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        consultantId: consultant.id,
        workDate: "2026-04-09",
        hours: 4,
        note: "Smoke entry",
      }),
    })
  ).data;

  await http(`/api/time-entries/${timeEntry.id}/approve`, {
    method: "PATCH",
    body: JSON.stringify({ approvedBy: "smoke-test" }),
  });

  await http("/api/expenses", {
    method: "POST",
    body: JSON.stringify({
      projectId: project.id,
      expenseDate: "2026-04-09",
      category: "Viaticos",
      amount: 120,
      currency: "USD",
      description: "Smoke expense",
    }),
  });

  await http("/api/forecasts", {
    method: "POST",
    body: JSON.stringify({
      projectId: project.id,
      consultantId: consultant.id,
      startDate: "2026-04-01",
      endDate: "2026-06-30",
      hoursProjected: 20,
      hourlyRate: 45,
      note: "Smoke forecast",
    }),
  });

  const overview = await http("/api/stats/overview");
  if (!overview?.data?.totals) {
    throw new Error("Stats overview returned invalid shape");
  }

  console.log("Smoke test completed successfully");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
