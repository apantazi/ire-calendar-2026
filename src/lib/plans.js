export function addSavedPlan(plans = [], input = {}) {
  const createdAt = input.createdAt || new Date().toISOString();
  const sessionIds = uniqueSessionIds(input.sessionIds);
  const name = String(input.name || "").trim() || defaultPlanName(input.source, createdAt);
  const plan = {
    id: input.id || createPlanId(),
    name,
    sessionIds,
    source: input.source || "manual",
    createdAt,
    updatedAt: createdAt,
  };

  return [plan, ...normalizeSavedPlans(plans)];
}

export function normalizeSavedPlans(plans = []) {
  if (!Array.isArray(plans)) return [];
  return plans
    .filter((plan) => plan && plan.id && Array.isArray(plan.sessionIds))
    .map((plan) => ({
      id: String(plan.id),
      name: String(plan.name || "Untitled plan"),
      sessionIds: uniqueSessionIds(plan.sessionIds),
      source: String(plan.source || "manual"),
      createdAt: plan.createdAt || "",
      updatedAt: plan.updatedAt || plan.createdAt || "",
    }));
}

export function uniqueSessionIds(sessionIds = []) {
  return [...new Set((Array.isArray(sessionIds) ? sessionIds : []).map(String).filter(Boolean))];
}

function createPlanId() {
  return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultPlanName(source = "manual", createdAt = "") {
  const label = source === "auto-relevance" ? "Generated relevance plan" : source === "auto-proximity" ? "Generated close-rooms plan" : "Personal plan";
  const date = createdAt ? new Date(createdAt) : new Date();
  return `${label} ${date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}
